/**
 * Whole sessions over a holdout match (TEST_CHECKLIST §2C, Tasks 8-9 audits): every persona of the match
 * plays to the end through the server's own modules, once with the scripted provider's legal answers and
 * once keyless, and every moment is checked by rules written here rather than imported from the skills:
 * lineup swaps take a benched pick out for a new XI player and leave a valid squad with two different XI
 * armbands; bailout rules parse, are yes-or-no and settle by the end; room reads cite real crowd lines
 * with shares of 95-105%; keyless, everything is a labelled fallback. Then the inspector's own SQL counts
 * the deliveries and runs (compare with the raw file) and the story plan prints its beats.
 *
 * Usage (from the repo root): node scripts/oracle/audit/holdout_sessions.ts <scratch-dir>/data <match-id>
 * after holdout_data.py built the directory. Prints "AUDIT OK" or each problem; exit 1 on a problem.
 */
import { createScriptedProvider } from "../../../apps/server/src/ai/providers/scripted.ts";
import { loadConfig } from "../../../apps/server/src/config.ts";
import { buildRuntime } from "../../../apps/server/src/runtime.ts";
import { validScript } from "../../../apps/server/test/runtime.ts";
import {
  buildStoryPlan,
  MomentSchema,
  QuestRuleSchema,
  resolveQuestRule,
  validateSquad,
} from "../../../packages/engine/src/index.ts";

const [dataDir, matchId] = process.argv.slice(2);
if (!dataDir || !matchId) {
  console.error("usage: node scripts/oracle/audit/holdout_sessions.ts <data-dir> <match-id>");
  process.exit(2);
}

let wall = Date.parse("2026-10-17T12:00:00Z");
const config = loadConfig(
  {
    SIDELINE_DATA_DIR: dataDir,
    OPENAI_API_KEY: "sk-audit",
    OPENAI_BASE_URL: "https://audit.example.test/v1",
    SIDELINE_MODEL_FAST: "audit-fast",
    SIDELINE_MODEL_SMART: "audit-smart",
  },
  "/srv/audit",
);
const problems = new Set<string>();
const check = (ok: boolean, what: string) => {
  if (!ok) problems.add(what);
};

async function run(label: string, keyless: boolean) {
  const rt = buildRuntime(config, {
    now: () => wall,
    dbPath: ":memory:",
    provider: keyless ? null : createScriptedProvider(validScript),
    replayDir: null,
  });
  const b = rt.bundles.get(matchId as string);
  if (!b) throw new Error(`no match ${matchId} in ${dataDir}`);
  const crowdIds = new Set(b.crowd.map((m) => m.id));
  const xi = new Set(
    b.events.flatMap((e) => (e.kind === "playing_xi" ? e.playerIds : ([] as string[]))),
  );
  const kinds: Record<string, number> = {};
  for (const persona of b.personas) {
    if (persona.squad) {
      check(
        validateSquad(persona.squad, b.players, b.rules.team).valid,
        `${persona.id}: legal squad`,
      );
    }
    const session = rt.manager.create({ matchId: b.summary.id, personaId: persona.id });
    const stop = session.connect(() => {});
    session.control({ action: "speed", value: 32 });
    for (let i = 0; i < 200_000 && session.clock().playing; i += 1) {
      wall += 1000;
      rt.manager.tick();
      if (i % 50 === 0) await rt.manager.settle();
    }
    await rt.manager.settle();
    stop();
    for (const m of session.moments()) {
      const tag = `${label} ${persona.id} ${m.key}`;
      kinds[`${persona.id}:${m.kind}:${m.provenance}`] =
        (kinds[`${persona.id}:${m.kind}:${m.provenance}`] ?? 0) + 1;
      check(MomentSchema.safeParse(m).success, `${tag}: validates`);
      if (keyless) check(m.provenance === "fallback", `${tag}: keyless is a fallback`);
      if (m.kind === "lineup_patch" && persona.squad) {
        let ids = [...persona.squad.playerIds];
        for (const swap of m.payload.swaps) {
          check(
            ids.includes(swap.outId) && !xi.has(swap.outId),
            `${tag}: swaps out a benched pick`,
          );
          check(xi.has(swap.inId) && !ids.includes(swap.inId), `${tag}: swaps in a new XI player`);
          ids = ids.map((id) => (id === swap.outId ? swap.inId : id));
        }
        const captain = m.payload.captain?.playerId ?? "";
        const vice = m.payload.viceCaptain?.playerId ?? "";
        const valid = validateSquad(
          { playerIds: ids, captainId: captain, viceCaptainId: vice },
          b.players,
          b.rules.team,
        ).valid;
        check(valid && m.payload.squadValid, `${tag}: squad valid after the swaps`);
        check(xi.has(captain) && xi.has(vice) && captain !== vice, `${tag}: two XI armbands`);
      }
      if (m.kind === "bailout") {
        check(m.payload.trigger.runs <= 10, `${tag}: out cheaply`);
        for (const prediction of m.payload.quest.predictions) {
          check(QuestRuleSchema.safeParse(prediction.rule).success, `${tag}: rule parses`);
          check(prediction.options.length === 2, `${tag}: yes or no`);
          check(resolveQuestRule(prediction.rule, b.events) !== "pending", `${tag}: settles`);
        }
      }
      if (m.kind === "room_read") {
        const total = m.payload.pods.reduce((sum, pod) => sum + pod.sharePct, 0);
        check(total >= 95 && total <= 105, `${tag}: shares ${total}`);
        for (const pod of m.payload.pods) {
          for (const id of pod.sampleMessageIds) check(crowdIds.has(id), `${tag}: real line ${id}`);
        }
      }
    }
  }
  console.log(label, JSON.stringify(kinds));
  // The inspector over the whole match: compare with the raw file's deliveries and runs.
  const late = rt.manager.create({ matchId: b.summary.id, personaId: b.personas[0]?.id ?? "" });
  late.control({ action: "seek", t: b.events.at(-1)?.t ?? 0 });
  wall += 120_000;
  rt.manager.tick();
  const counted = await late.inspect({
    sql: "SELECT count(*) AS deliveries, sum(runs_total) AS runs FROM visible_deliveries",
  });
  console.log(label, "inspector:", counted.status, JSON.stringify(counted.rows));
  rt.db.close();
  return b;
}

await run("scripted", false);
const b = await run("keyless", true);
const plan = buildStoryPlan({
  matchId: b.summary.id,
  events: b.events,
  players: b.players,
  rules: b.rules,
  personas: b.personas,
  winprob: b.winprob,
  priors: b.priors,
  chat: b.crowd,
});
const where = (id: string) => {
  const e = b.events.find((x) => x.id === id);
  return e?.kind === "delivery" ? `${e.innings}:${e.label}` : (e?.kind ?? id);
};
console.log(
  "story:",
  plan?.personaId,
  plan?.beats.map((beat) => `${beat.kind}${"eventId" in beat ? `@${where(beat.eventId)}` : ""}`),
);
console.log(problems.size === 0 ? "AUDIT OK" : `PROBLEMS:\n${[...problems].join("\n")}`);
process.exit(problems.size === 0 ? 0 : 1);
