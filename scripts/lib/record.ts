/**
 * The replay recorder behind `pnpm ai:record` (PLAN Task 7, D-054, D-066): it walks every persona
 * of every match through the moments a reviewer reaches in the room, on the server's own sessions,
 * so the gateway asks for exactly the keys a live server would; the validated answers become
 * replay rows (data/ai-replay/<matchId>.jsonl) that a server with no key serves to everyone
 * (Constraint 2).
 *
 * Callers: scripts/ai-record.ts (the CLI) and scripts/test/ai-record.test.ts (scripted provider).
 * Each persona plays from its join point to the end (its catch-up reel and every teaser after it),
 * then, from its join point again, makes each one-click jump the room offers (the phase rail and
 * the jump control's default), whose catch-ups are keyed by window and lens. Calls go one at a
 * time on a hand-moved clock, so the only wall time is the provider's, and the sessions run at 1x
 * with the longest stream delay so that every teaser gets the skill's full timeout (at 32x it
 * would get the 9 s minimum, and the endpoint of D-033 takes up to 8.5 s). Rows already recorded
 * in the replay directory answer before any call (D-054), so a second run only fills the gaps.
 * Explainer answers are personal (keyed by the fan's question) and are never recorded.
 */
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ZodType } from "zod";
import type { GatewayCounters } from "../../apps/server/src/ai/gateway.ts";
import type { Script } from "../../apps/server/src/ai/providers/scripted.ts";
import type { LlmProvider } from "../../apps/server/src/ai/providers/types.ts";
import { catchUpSkill } from "../../apps/server/src/ai/skills/catchUp.ts";
import { teaserSkill } from "../../apps/server/src/ai/skills/spoilerNudge.ts";
import type { AppConfig } from "../../apps/server/src/config.ts";
import { buildRuntime } from "../../apps/server/src/runtime.ts";
import { ControlError } from "../../apps/server/src/sessions/session.ts";
import { type JumpTarget, MAX_DELAY_MS, type Persona } from "../../packages/engine/src/index.ts";

/**
 * The jumps a reviewer makes in one click (apps/web: broadcast/PhaseRail.tsx, each innings' phase
 * starts; broadcast/PlaybackControls.tsx, the jump control's default). Only those past a persona's
 * join point by twelve unseen legal balls earn a catch-up; the rest record nothing.
 */
export const RECORDED_JUMPS: readonly JumpTarget[] = [
  ...([1, 2] as const).flatMap((innings) =>
    ([0, 6, 15] as const).map((afterOvers): JumpTarget => ({ kind: "over", innings, afterOvers })),
  ),
  { kind: "over", innings: 2, afterOvers: 18 },
];

/** The skills whose answers are shared by every fan and so are worth recording, by prompt version. */
const RECORDED_SKILLS: ReadonlyMap<string, { name: string; schema: ZodType }> = new Map([
  [teaserSkill.promptVersion, { name: teaserSkill.name, schema: teaserSkill.outputSchema }],
  [catchUpSkill.promptVersion, { name: catchUpSkill.name, schema: catchUpSkill.outputSchema }],
]);

/** Fake wall time per tick: 5 s at 1x, a full match in about 2,000 ticks. */
const STEP_MS = 5_000;
const MAX_TICKS = 100_000;

/** The scripted provider's model name; its rows are test output and say so. */
export const SCRIPTED_MODELS = { fast: "scripted", smart: "scripted" } as const;

/** Answers for `--provider scripted` (tests and dry runs): schema-valid, labelled as test output. */
export const scriptedAnswer: Script = (req) => {
  if (req.skill === teaserSkill.name) return { nudge: "Scripted test teaser, not model output." };
  if (req.skill === catchUpSkill.name) {
    const slide = (kind: string) => ({
      kind,
      headline: "Scripted test slide",
      body: "Not model output: written by the recorder's test provider.",
      citedEventIds: [],
    });
    return { slides: [slide("turning_point"), slide("watch_next")] };
  }
  throw new Error(`the recorder never asks for ${req.skill}`);
};

export interface Clock {
  now(): number;
  advance(ms: number): void;
}

/** A wall clock that moves only when told to. */
export function handClock(start = Date.now()): Clock {
  let wall = start;
  return {
    now: () => wall,
    advance(ms) {
      wall += ms;
    },
  };
}

/** One line of data/ai-replay/<matchId>.jsonl (apps/server/src/ai/providers/replay.ts). */
export interface ReplayRow {
  key: string;
  promptVersion: string;
  model: string;
  output: unknown;
}

export interface RecordRun {
  /** Replayable rows after the walk: this run's live answers and the rows recorded before it. */
  rows: ReplayRow[];
  /** Asked-for keys that ended without a replayable row, with the reason from the trace. */
  missing: { skill: string; key: string; outcome: string; detail: string | null }[];
  /** Asked-for keys answered by a row recorded before this run. */
  reused: number;
  /** Rows recorded before this run that no longer validate, or belong to no recorded skill. */
  dropped: number;
  counters: GatewayCounters;
  /** The outcomes of the provider calls made (ok, timeout, error, refused, fallback). */
  outcomes: Record<string, number>;
  /** Why the walk stopped early, if it did; the rows recorded until then are still returned. */
  error: string | null;
}

type Runtime = ReturnType<typeof buildRuntime>;

/** Ticks every session and waits for the AI work it started: one call at a time. */
async function step(rt: Runtime, clock: Clock): Promise<void> {
  clock.advance(STEP_MS);
  rt.manager.tick();
  await rt.manager.settle();
}

async function walk(rt: Runtime, clock: Clock, log: (line: string) => void): Promise<void> {
  for (const [matchId, bundle] of rt.bundles) {
    for (const persona of bundle.personas) {
      log(`${matchId} ${persona.id}: play from the join point to the end, then the jumps`);
      await play(rt, clock, matchId, persona);
      for (const target of RECORDED_JUMPS) await jump(rt, clock, matchId, persona, target);
    }
  }
}

function open(rt: Runtime, matchId: string, persona: Persona) {
  const session = rt.manager.create({ matchId, personaId: persona.id, delayMs: MAX_DELAY_MS });
  // An open stream keeps the session from being evicted as idle on the hand-moved clock.
  const close = session.connect(() => {});
  return { session, close };
}

async function play(rt: Runtime, clock: Clock, matchId: string, persona: Persona): Promise<void> {
  const { session, close } = open(rt, matchId, persona);
  try {
    await rt.manager.settle();
    // The clock stops by itself once the fan's TV has shown the end (D-063).
    for (let ticks = 0; session.clock().playing; ticks += 1) {
      if (ticks > MAX_TICKS) throw new Error(`${matchId} ${persona.id}: the match never ended`);
      await step(rt, clock);
    }
  } finally {
    close();
  }
}

async function jump(
  rt: Runtime,
  clock: Clock,
  matchId: string,
  persona: Persona,
  target: JumpTarget,
): Promise<void> {
  const { session, close } = open(rt, matchId, persona);
  try {
    await rt.manager.settle();
    // Paused, so the session records only the jump's catch-up and plays nothing after it.
    session.control({ action: "pause" });
    try {
      session.control({ action: "jump", target });
    } catch (error) {
      if (error instanceof ControlError) return; // the innings never got that far
      throw error;
    }
    await step(rt, clock);
  } finally {
    close();
  }
}

/** The cache's replayable rows for the recorded skills: one per key, a live answer first. */
function replayable(db: DatabaseSync): { rows: ReplayRow[]; dropped: number } {
  const found = db
    .prepare(
      `SELECT key, prompt_version, model, payload_json, source FROM ai_cache
       ORDER BY key, prompt_version, CASE source WHEN 'live' THEN 0 ELSE 1 END, created_at DESC`,
    )
    .all() as { key: string; prompt_version: string; model: string; payload_json: string }[];
  const rows: ReplayRow[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const row of found) {
    const id = `${row.prompt_version}\u0000${row.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const skill = RECORDED_SKILLS.get(row.prompt_version);
    const output: unknown = JSON.parse(row.payload_json);
    if (!skill?.schema.safeParse(output).success) {
      dropped += 1;
      continue;
    }
    rows.push({ key: row.key, promptVersion: row.prompt_version, model: row.model, output });
  }
  return { rows, dropped };
}

/**
 * Walks every persona with the given provider (null: the planning pass, which spends nothing) and
 * returns the rows to write and what happened. `replayDir` holds the rows already recorded; null
 * starts from none.
 */
export async function recordMoments(
  config: AppConfig,
  opts: {
    provider: LlmProvider | null;
    models?: { fast: string; smart: string };
    replayDir: string | null;
    log?: (line: string) => void;
  },
): Promise<RecordRun> {
  const clock = handClock();
  const models = opts.models ?? config.ai.models;
  const rt = buildRuntime(
    { ...config, ai: { ...config.ai, models } },
    { now: clock.now, dbPath: ":memory:", provider: opts.provider, replayDir: opts.replayDir },
  );
  try {
    let error: string | null = null;
    try {
      await walk(rt, clock, opts.log ?? (() => {}));
    } catch (thrown) {
      // Answers already recorded were paid for: return them with the reason, never drop them.
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
    const { rows, dropped } = replayable(rt.db);
    const have = new Set(rows.map((r) => r.key));
    const traces = rt.db
      .prepare(
        `SELECT skill, moment_key, provider, cache, outcome, detail FROM ai_calls
         ORDER BY started_at_wall, rowid`,
      )
      .all() as {
      skill: string;
      moment_key: string;
      provider: string;
      cache: string;
      outcome: string;
      detail: string | null;
    }[];
    const recordedSkills = new Set([...RECORDED_SKILLS.values()].map((s) => s.name));
    const missing = new Map<string, RecordRun["missing"][number]>();
    const reused = new Set<string>();
    const outcomes: Record<string, number> = {};
    for (const t of traces) {
      if (!recordedSkills.has(t.skill)) continue;
      if (t.provider === "replay") reused.add(t.moment_key);
      // A provider call: not served from a row, not stopped before calling, not a run that only
      // shared another run's in-flight result.
      if (
        t.cache === "miss" &&
        t.provider !== "none" &&
        t.outcome !== "budget" &&
        !t.detail?.startsWith("shared result:")
      ) {
        outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
      }
      if (!have.has(t.moment_key)) {
        missing.set(t.moment_key, {
          skill: t.skill,
          key: t.moment_key,
          outcome: t.outcome,
          detail: t.detail,
        });
      }
    }
    return {
      rows,
      missing: [...missing.values()].sort((a, b) => a.key.localeCompare(b.key)),
      reused: reused.size,
      dropped,
      counters: rt.gateway.counters(),
      outcomes,
      error,
    };
  } finally {
    rt.db.close();
  }
}

/** Writes one sorted JSONL file per match (the key's second field); returns what it wrote. */
export function writeReplayFiles(
  dir: string,
  rows: readonly ReplayRow[],
): { file: string; rows: number }[] {
  const byMatch = new Map<string, ReplayRow[]>();
  for (const row of rows) {
    const matchId = row.key.split(":")[1];
    if (!matchId) throw new Error(`no match id in the key ${row.key}`);
    byMatch.set(matchId, [...(byMatch.get(matchId) ?? []), row]);
  }
  const written: { file: string; rows: number }[] = [];
  for (const [matchId, matchRows] of [...byMatch].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...matchRows].sort(
      (a, b) => a.key.localeCompare(b.key) || a.promptVersion.localeCompare(b.promptVersion),
    );
    const file = join(dir, `${matchId}.jsonl`);
    const text = sorted
      .map(({ key, promptVersion, model, output }) =>
        JSON.stringify({ key, promptVersion, model, output }),
      )
      .join("\n");
    // Through a temporary file, so a server booting meanwhile never reads half a file.
    writeFileSync(`${file}.tmp`, `${text}\n`);
    renameSync(`${file}.tmp`, file);
    written.push({ file, rows: sorted.length });
  }
  return written;
}
