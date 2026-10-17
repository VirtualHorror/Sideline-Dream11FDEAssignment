/**
 * PLAN 7.2: `pnpm ai:record` against the scripted provider writes JSONL the replay loader reads,
 * covering the moments a reviewer reaches, and a server with no key then serves it as replayed AI.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCache } from "../../apps/server/src/ai/cache.ts";
import { loadReplayRows } from "../../apps/server/src/ai/providers/replay.ts";
import { createScriptedProvider } from "../../apps/server/src/ai/providers/scripted.ts";
import type { LlmProvider } from "../../apps/server/src/ai/providers/types.ts";
import { loadConfig } from "../../apps/server/src/config.ts";
import { loadMatchBundles } from "../../apps/server/src/data/bundle.ts";
import { openDatabase } from "../../apps/server/src/db/database.ts";
import { buildRuntime } from "../../apps/server/src/runtime.ts";
import {
  applyEvent,
  createMatchState,
  type Detector,
  type MatchEvent,
  nudgeDetector,
  roomDetector,
} from "../../packages/engine/src/index.ts";
import {
  handClock,
  type RecordRun,
  recordMoments,
  SCRIPTED_MODELS,
  scriptedAnswer,
  writeReplayFiles,
} from "../lib/record.ts";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const config = loadConfig({ SIDELINE_AI_PROVIDER: "none" }, repoRoot);
const bundles = loadMatchBundles(join(repoRoot, "data"));

/** Every key one detector asks for on a full replay, straight from the engine (not the recorder). */
function detectorKeys(matchId: string, detector: Detector): string[] {
  const bundle = bundles.get(matchId);
  const persona = bundle?.personas[0];
  if (!bundle || !persona) throw new Error(`no bundle for ${matchId}`);
  const ctx = {
    matchId,
    players: bundle.players,
    rules: bundle.rules,
    persona,
    winprob: bundle.winprob,
    priors: bundle.priors,
  };
  const state = createMatchState(matchId);
  const keys: string[] = [];
  for (const event of bundle.events) {
    const before = structuredClone(state);
    applyEvent(state, event);
    const verdict = detector.evaluate({
      before,
      after: state,
      event,
      events: bundle.events,
      ctx,
      chat: bundle.crowd,
    });
    if (verdict.outcome === "ai_trigger") keys.push(verdict.trigger.key);
  }
  // The gate asks once per key: a room read's over-end repeats a spike's key in the same over.
  return [...new Set(keys)];
}
const teaserKeys = (matchId: string) => detectorKeys(matchId, nudgeDetector);

let dir: string;
let run: RecordRun;
let lines: { key: string; promptVersion: string; model: string; output: unknown }[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sideline-record-"));
  run = await recordMoments(config, {
    provider: createScriptedProvider(scriptedAnswer),
    models: SCRIPTED_MODELS,
    replayDir: null,
  });
  writeReplayFiles(dir, run.rows);
  lines = readdirSync(dir)
    .sort()
    .flatMap((file) => readFileSync(join(dir, file), "utf8").trim().split("\n"))
    .map((line) => JSON.parse(line));
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("pnpm ai:record (PLAN 7.2)", () => {
  it("writes one JSONL file per match, every line of which the replay loader takes", () => {
    expect(readdirSync(dir).sort()).toEqual(["1298150.jsonl", "1415755.jsonl"]);
    const db = openDatabase(":memory:");
    expect(loadReplayRows(dir, createCache(db, Date.now))).toBe(lines.length);
    expect(lines.length).toBe(run.rows.length);
    for (const line of lines) {
      expect(Object.keys(line)).toEqual(["key", "promptVersion", "model", "output"]);
      expect(line.model).toBe("scripted");
    }
    db.close();
  });

  it("records every teaser of both matches, 23 and 25, and never a fan's own question", () => {
    const recorded = (prefix: string) =>
      lines
        .filter((l) => l.key.startsWith(prefix))
        .map((l) => l.key)
        .sort();
    expect(recorded("nudge:1298150:")).toEqual(teaserKeys("1298150").sort());
    expect(recorded("nudge:1415755:")).toEqual(teaserKeys("1415755").sort());
    expect(recorded("nudge:1298150:")).toHaveLength(23);
    expect(recorded("nudge:1415755:")).toHaveLength(25);
    expect(lines.filter((l) => l.key.startsWith("explain:"))).toEqual([]);
    // Task 8 added the shared bailouts and room reads; personal moments (lineup patches, questions,
    // stat-backs) are never recorded.
    expect(lines.every((l) => /^(nudge|catchup|bailout|room):/.test(l.key))).toBe(true);
  });

  it("records each cohort's bailout and every room read, and never asks for a personal lineup patch", () => {
    const keys = lines.map((l) => l.key);
    // PLAN 4.4: Babar at 1.1 of 1298150 and Rohit at 1.4 of 1415755, both captains.
    expect(keys.filter((k) => k.startsWith("bailout:")).sort()).toEqual([
      "bailout:1298150:1298150:0018:C",
      "bailout:1415755:1415755:0017:C",
    ]);
    const rooms = (id: string) => keys.filter((k) => k.startsWith(`room:${id}:`)).sort();
    expect(rooms("1298150")).toEqual(detectorKeys("1298150", roomDetector).sort());
    expect(rooms("1415755")).toEqual(detectorKeys("1415755", roomDetector).sort());
    expect([rooms("1298150").length, rooms("1415755").length]).toEqual([12, 10]);
    expect(keys.filter((k) => k.startsWith("lineup:"))).toEqual([]);
  });

  it("records each late joiner's catch-up and the room's jumps, in the persona's own lens", () => {
    const keys = lines.map((l) => l.key);
    for (const key of [
      "catchup:1298150:2:0-14:casual",
      "catchup:1298150:2:0-16:f1",
      "catchup:1415755:2:0-15:analyst",
      "catchup:1415755:2:0-17:football",
      // The E2E's jump: late-from-work from 14 to 18 overs of the chase (Task 6).
      "catchup:1298150:2:14-18:casual",
      // Story mode (Task 9): captain-rohit, casual, jumps to where the analyst joins; the phase
      // rail's jump to 15 overs of the chase records the same reel, so the story needs no walk of
      // its own (its other jump, to 2:18.5 in 2022, is late-from-work's 14-18 reel above).
      "catchup:1415755:2:0-15:casual",
    ]) {
      expect(keys).toContain(key);
    }
    const lenses = new Set(
      [...bundles.values()].flatMap((b) => b.personas.map((p) => `${b.summary.id}:${p.lens}`)),
    );
    for (const key of keys.filter((k) => k.startsWith("catchup:"))) {
      const [, match, , , lens] = key.split(":");
      expect(lenses).toContain(`${match}:${lens}`);
    }
    expect(run.missing).toEqual([]);
  });

  // D-079: a chain answers with whichever link served; the recording says which model wrote each row.
  it("records the model that answered each moment, not the configured one", async () => {
    const scripted = createScriptedProvider(scriptedAnswer);
    const servedByALink: LlmProvider = {
      name: "scripted",
      complete: async (req) => ({ ...(await scripted.complete(req)), model: "served-by-a-link" }),
    };
    const other = await recordMoments(config, {
      provider: servedByALink,
      models: SCRIPTED_MODELS,
      replayDir: null,
    });
    expect(other.rows).toHaveLength(lines.length);
    expect(new Set(other.rows.map((row) => row.model))).toEqual(new Set(["served-by-a-link"]));
  }, 120_000);

  it("calls the provider once per key, and not at all when every key is already recorded", async () => {
    expect(run.counters.aiCallsLive).toBe(lines.length);
    const again = await recordMoments(config, {
      provider: createScriptedProvider(scriptedAnswer),
      models: SCRIPTED_MODELS,
      replayDir: dir,
    });
    expect(again.counters.aiCallsLive).toBe(0);
    expect(again.reused).toBe(lines.length);
    expect(again.rows).toEqual(run.rows);
  }, 120_000);

  it("is served as replayed AI by a server with no key: the 18.6 teaser of the chase", async () => {
    const clock = handClock(Date.parse("2026-10-17T12:00:00Z"));
    const rt = buildRuntime(config, { now: clock.now, dbPath: ":memory:", replayDir: dir });
    expect(rt.gateway.mode()).toBe("replay");
    expect(rt.replayRows).toBe(lines.length);
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const stop = session.connect(() => {});
    const climax = bundles
      .get("1298150")
      ?.events.find(
        (e): e is Extract<MatchEvent, { kind: "delivery" }> =>
          e.kind === "delivery" && e.innings === 2 && e.label === "18.6" && e.isLegal,
      );
    if (!climax) throw new Error("no 18.6 in the chase");
    session.control({ action: "speed", value: 32 });
    while (session.stadiumNow() < climax.t) {
      clock.advance(1_000);
      rt.manager.tick();
    }
    await rt.manager.settle();
    const teaser = session.moments().find((m) => m.key === `nudge:1298150:${climax.id}`);
    expect(teaser?.provenance).toBe("replay");
    expect(teaser?.payload).toMatchObject({ nudge: "Scripted test teaser, not model output." });
    const reel = session.moments().find((m) => m.key === "catchup:1298150:2:0-14:casual");
    expect(reel?.provenance).toBe("replay");
    stop();
    rt.db.close();
  }, 60_000);

  it("refuses to put scripted rows into data/ai-replay, and to spend without --yes", () => {
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [join(repoRoot, "scripts", "ai-record.ts"), ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, SIDELINE_AI_PROVIDER: "none" },
        timeout: 60_000,
      });
    const scripted = cli("--provider", "scripted", "--out", join(repoRoot, "data", "ai-replay"));
    expect(scripted.status).toBe(1);
    expect(scripted.stderr).toContain("ai-record: scripted rows never go to");
    const keyless = cli("--yes");
    expect(keyless.status).toBe(1);
    expect(keyless.stderr).toContain("ai-record: no AI provider is configured");
  });
});
