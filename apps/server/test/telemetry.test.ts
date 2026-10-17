import {
  applyEvent,
  createGate,
  createMatchState,
  type DetectorContext,
  type TelemetrySnapshot,
  TelemetrySnapshotSchema,
} from "@sideline/engine";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Skill } from "../src/ai/skills/types.ts";
import { DEFAULT_DETECTORS } from "../src/sessions/manager.ts";
import { scaleProjection } from "../src/telemetry/projection.ts";
import { bundle } from "./helpers.ts";
import { playUntil, testRuntime } from "./runtime.ts";

const b = bundle("1298150");

/** The engine's own gate over the whole match for babar-believer, with the match's shared crowd. */
function referenceGate() {
  const persona = b.personas.find((p) => p.id === "babar-believer");
  if (!persona) throw new Error("no babar-believer");
  const ctx: DetectorContext = {
    matchId: "1298150",
    players: b.players,
    rules: b.rules,
    persona,
    winprob: b.winprob,
    priors: b.priors,
  };
  let micros = 0;
  const gate = createGate(DEFAULT_DETECTORS, { nowMicros: () => (micros += 1) });
  const state = createMatchState("1298150");
  for (const event of b.events) {
    const before = structuredClone(state);
    applyEvent(state, event);
    gate.process({ before, after: state, event, events: b.events, ctx, chat: b.crowd });
  }
  return gate.counters();
}

describe("telemetry after a full scripted replay (PLAN 5.8)", () => {
  const rt = testRuntime();
  let snap: TelemetrySnapshot;
  let global: TelemetrySnapshot;
  beforeAll(async () => {
    const session = rt.manager.create({ matchId: "1298150", personaId: "babar-believer" });
    session.control({ action: "speed", value: 32 });
    await playUntil(rt, session, b.events.at(-1)?.t ?? 0, 10_000);
    snap = TelemetrySnapshotSchema.parse(rt.telemetry.snapshot("session", session.id));
    global = TelemetrySnapshotSchema.parse(rt.telemetry.snapshot("global"));
  });

  it("counts exactly what the gate and the gateway counted", () => {
    const gate = referenceGate();
    const gateway = rt.gateway.counters();
    expect(snap.counters).toEqual({
      eventsTotal: gate.eventsTotal,
      eventsDeterministic: gate.eventsDeterministic,
      gateTriggers: gate.triggers,
      aiCallsLive: gateway.aiCallsLive,
      aiCacheHits: gateway.aiCacheHits,
      aiFallbacks: gateway.aiFallbacks,
      tokensIn: gateway.tokensIn,
      tokensOut: gateway.tokensOut,
      costUsd: gateway.costUsd,
    });
    // F04: 266 events, at least 0.80 deterministic; 23 teasers, each a live call of 1000 + 100 tokens.
    expect(snap.counters.eventsTotal).toBe(266);
    expect(snap.counters.eventsDeterministic / snap.counters.eventsTotal).toBeGreaterThanOrEqual(
      0.8,
    );
    expect(snap.counters).toMatchObject({ aiCallsLive: 23, tokensIn: 23_000, tokensOut: 2_300 });
    expect(snap.counters.costUsd).toBeCloseTo(23 * 0.007, 10);
    expect(global.counters).toEqual(snap.counters);
  });

  it("keeps the most recent decisions and calls, newest last", () => {
    expect(snap.recentDecisions).toHaveLength(200);
    expect(snap.recentDecisions.at(-1)?.eventId).toBe(b.events.at(-1)?.id);
    expect(snap.recentCalls).toHaveLength(23);
  });

  it("projects the saving at 10,000,000 viewers with the numbers in the formula", () => {
    const p = snap.projection;
    expect(p.concurrentViewers).toBe(10_000_000);
    expect(p.eventsPerMatch).toBe(266);
    expect(p.naiveLlmCalls).toBe(2_660_000_000);
    // babar-believer's lineup patch is personal (keyed by squad): assumed for every viewer.
    const shared = snap.counters.gateTriggers - 1;
    expect(p.sidelineLlmCalls).toBe(shared + 10_000_000);
    expect(p.savedPct).toBeGreaterThan(99);
    expect(p.formula).toContain("266 events × 10,000,000 viewers = 2,660,000,000 calls");
    expect(p.formula).toContain(
      `${shared} shared moment keys + 1.00 personal moments per viewer × 10,000,000 viewers = ${(shared + 10_000_000).toLocaleString("en-US")} calls`,
    );
    expect(p.formula).toContain(`= ${p.savedPct.toFixed(4)}%`);
  });

  it("keeps an evicted session's numbers in the global scope only", () => {
    const evicting = testRuntime({ ttlMs: 1 });
    const gone = evicting.manager.create({ matchId: "1298150", personaId: "f1-convert" });
    // Watched for two minutes (an open stream keeps it alive; the next ball after an over's end is
    // about 89 s away), then left alone past the TTL.
    const stop = gone.connect(() => {});
    evicting.clock.advance(120_000);
    evicting.manager.tick();
    stop();
    evicting.clock.advance(10);
    evicting.manager.tick();
    expect(evicting.manager.get(gone.id)).toBeUndefined();
    expect(() => evicting.telemetry.snapshot("session", gone.id)).toThrow(/no telemetry/);
    expect(evicting.telemetry.snapshot("global").counters.eventsTotal).toBeGreaterThan(0);
  });
});

describe("scaleProjection", () => {
  it("substitutes every number into the formula", () => {
    const p = scaleProjection({
      viewers: 10_000_000,
      eventsPerMatch: 266,
      sharedKeys: 24,
      personalPerViewer: 0,
    });
    expect(p).toMatchObject({ naiveLlmCalls: 2_660_000_000, sidelineLlmCalls: 24 });
    expect(p.savedPct).toBeGreaterThan(99.9999);
    // 1 − 24 / 2,660,000,000 = 99.9999991%: shown with enough decimals never to read as 100%.
    expect(p.formula).toBe(
      "naive = 266 events × 10,000,000 viewers = 2,660,000,000 calls; Sideline = 24 shared moment keys + 0.00 personal moments per viewer × 10,000,000 viewers = 24 calls; saved = 1 − 24 / 2,660,000,000 = 99.999999%",
    );
  });

  it("never reports a saving it cannot compute", () => {
    expect(
      scaleProjection({ viewers: 1, eventsPerMatch: 0, sharedKeys: 0, personalPerViewer: 0 })
        .savedPct,
    ).toBe(0);
  });
});

describe("latency percentiles", () => {
  it("are nearest-rank over the provider calls' latencies", async () => {
    const step = { ms: 0 };
    const rt = testRuntime({
      script: () => {
        rt.clock.advance(step.ms);
        return { text: "ok" };
      },
    });
    const echo: Skill<{ n: number }, { text: string }, string> = {
      name: "echo",
      promptVersion: "echo-v1",
      tier: "fast",
      effort: "low",
      maxTokens: 100,
      timeoutMs: () => 1000,
      outputSchema: z.strictObject({ text: z.string() }),
      buildPrompt: (f) => ({ system: "s", user: `${f.n}` }),
      guard: () => ({ ok: true }),
      toPayload: (out) => out.text,
      fallback: () => "fallback",
    };
    for (let n = 1; n <= 20; n += 1) {
      step.ms = n;
      await rt.gateway.run(echo, `echo:${n}`, { n });
    }
    // Latencies 1..20 ms: the 50th percentile is the 10th value, the 95th the 19th.
    expect(rt.telemetry.snapshot("global").latencyMs).toEqual({ p50: 10, p95: 19 });
  });
});
