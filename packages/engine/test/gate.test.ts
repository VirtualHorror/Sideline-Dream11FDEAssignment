import { describe, expect, it } from "vitest";
import {
  applyEvent,
  type ChatMessage,
  collapseDetector,
  createGate,
  createMatchState,
  type Detector,
  type GateDecision,
  GateDecisionSchema,
  joinSeq,
  lineupDetector,
  type MomentTrigger,
  nudgeDetector,
  roomDetector,
  simulateCrowd,
} from "../src/index.ts";
import { loadCorpus, loadMatch } from "./helpers/data.ts";
import { contextFor, personaOf, timelineOf } from "./helpers/replay.ts";

const DETECTORS = [lineupDetector, collapseDetector, nudgeDetector, roomDetector];

/** A clock that advances `step` microseconds every time the gate reads it. */
function fakeClock(step: number) {
  let now = 1_000_000;
  return () => {
    now += step;
    return now;
  };
}

/** Runs a whole session for a persona through one gate, the way the server's tick loop will. */
function runSession(
  personaId: string,
  opts: { seed?: string; detectors?: readonly Detector[]; step?: number } = {},
) {
  const id = "1298150";
  const events = timelineOf(id);
  const persona = personaOf(id, personaId);
  const ctx = contextFor(id, persona);
  const chat: ChatMessage[] = simulateCrowd({
    events,
    players: loadMatch(id).players.players,
    corpus: loadCorpus(),
    seed: opts.seed ?? "session-a",
  });
  const gate = createGate(opts.detectors ?? DETECTORS, { nowMicros: fakeClock(opts.step ?? 7) });
  const joined = joinSeq(events, persona.joinAt);
  const state = createMatchState(id);
  const decisions: GateDecision[] = [];
  const triggers: { trigger: MomentTrigger; json: string }[] = [];
  let processed = 0;
  for (const event of events) {
    if (event.seq <= joined) {
      applyEvent(state, event);
      continue;
    }
    const before = structuredClone(state);
    applyEvent(state, event);
    const result = gate.process({ before, after: state, event, events, ctx, chat });
    processed += 1;
    decisions.push(...result.decisions);
    for (const trigger of result.triggers)
      triggers.push({ trigger, json: JSON.stringify(trigger) });
  }
  return { gate, decisions, triggers, processed };
}

describe("entropy gate on the full 1298150 replay (babar-believer)", () => {
  it("handles at least 0.80 of its events deterministically", () => {
    const { gate, processed } = runSession("babar-believer");
    const counters = gate.counters();
    expect(counters.eventsTotal).toBe(processed);
    expect(counters.eventsTotal).toBe(timelineOf("1298150").length);
    expect(counters.eventsDeterministic / counters.eventsTotal).toBeGreaterThanOrEqual(0.8);
  });

  it.each(["session-b", "seed-3", "seed-4", "seed-5"])(
    "keeps the share at 0.80 or more with crowd seed %s",
    (seed) => {
      const counters = runSession("babar-believer", { seed }).gate.counters();
      expect(counters.eventsDeterministic / counters.eventsTotal).toBeGreaterThanOrEqual(0.8);
    },
  );

  it("records one schema-valid decision per detector per event, each with a reason", () => {
    const { decisions, processed } = runSession("babar-believer");
    expect(decisions).toHaveLength(processed * DETECTORS.length);
    for (const decision of decisions) {
      expect(GateDecisionSchema.safeParse(decision).success).toBe(true);
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(DETECTORS.map((d) => d.name)).toContain(decision.detector);
      expect(decision.momentKey !== null).toBe(
        decision.outcome === "ai_trigger" || decision.reason === "duplicate_key",
      );
    }
  });

  it("keeps counters that add up", () => {
    const { gate, decisions, triggers } = runSession("babar-believer");
    const counters = gate.counters();
    const byOutcome = (outcome: GateDecision["outcome"]) =>
      decisions.filter((d) => d.outcome === outcome).length;
    expect(counters.triggers).toBe(byOutcome("ai_trigger"));
    expect(counters.triggers).toBe(triggers.length);
    expect(counters.suppressed).toBe(byOutcome("suppressed"));
    expect(byOutcome("deterministic") + counters.triggers + counters.suppressed).toBe(
      decisions.length,
    );
    const eventsWithTrigger = new Set(
      decisions.filter((d) => d.outcome === "ai_trigger").map((d) => d.eventId),
    ).size;
    expect(counters.eventsDeterministic + eventsWithTrigger).toBe(counters.eventsTotal);
    // Phase triggers seen on this replay: Babar's golden duck, the benched picks, the room, teasers.
    const kinds = new Set(triggers.map((t) => t.trigger.kind));
    expect(kinds).toEqual(new Set(["lineup_patch", "bailout", "spoiler_nudge", "room_read"]));
  });

  it("measures every decision's cost with the injected clock", () => {
    for (const step of [7, 13]) {
      const { decisions } = runSession("babar-believer", { step });
      expect(new Set(decisions.map((d) => d.costMicros))).toEqual(new Set([step]));
    }
  });

  it("asks for each moment key once per session", () => {
    const { triggers, decisions } = runSession("babar-believer");
    const keys = triggers.map((t) => t.trigger.key);
    expect(new Set(keys).size).toBe(keys.length);
    // The chase's last over reads the room at the 19.4 spike; its later reads are duplicates.
    const duplicates = decisions.filter((d) => d.reason === "duplicate_key");
    expect(duplicates.length).toBeGreaterThan(0);
    for (const duplicate of duplicates) {
      expect(duplicate.outcome).toBe("suppressed");
      expect(keys).toContain(duplicate.momentKey);
    }
  });

  it("hands out facts that later events cannot change", () => {
    const { triggers } = runSession("babar-believer");
    for (const { trigger, json } of triggers) expect(JSON.stringify(trigger)).toBe(json);
  });
});

describe("entropy gate mechanics", () => {
  const echo = (name: string, key: string): Detector => ({
    name,
    evaluate: ({ event }) =>
      event.kind === "delivery"
        ? {
            outcome: "ai_trigger",
            reason: "test",
            trigger: {
              kind: "room_read",
              key,
              scope: "shared",
              facts: {} as Extract<MomentTrigger, { kind: "room_read" }>["facts"],
            },
          }
        : { outcome: "deterministic", reason: "not_delivery" },
  });

  it("suppresses a repeated key, even from another detector, and counts each event once", () => {
    const { gate, decisions } = runSession("babar-believer", {
      detectors: [echo("first", "room:test:1"), echo("second", "room:test:1")],
    });
    const counters = gate.counters();
    expect(counters.triggers).toBe(1);
    const deliveries = timelineOf("1298150").filter((e) => e.kind === "delivery").length;
    expect(counters.suppressed).toBe(2 * deliveries - 1);
    expect(counters.eventsTotal - counters.eventsDeterministic).toBe(1);
    expect(decisions.find((d) => d.outcome === "ai_trigger")?.detector).toBe("first");
  });

  it("counts every event as deterministic when there is nothing to detect", () => {
    const { gate } = runSession("babar-believer", { detectors: [] });
    const counters = gate.counters();
    expect(counters).toEqual({
      eventsTotal: counters.eventsTotal,
      eventsDeterministic: counters.eventsTotal,
      triggers: 0,
      suppressed: 0,
    });
  });
});
