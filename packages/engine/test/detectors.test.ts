import { describe, expect, it } from "vitest";
import {
  enumerateSwaps,
  foldEvents,
  joinSeq,
  lineupDetector,
  type MomentTrigger,
  type PlayingXIEvent,
  validateSquad,
} from "../src/index.ts";
import { loadMatch, loadPriors } from "./helpers/data.ts";
import { contextFor, firings, personaOf, replay, timelineOf } from "./helpers/replay.ts";

/** Narrows a trigger to one kind, failing the test if it is another. */
function triggerOf<K extends MomentTrigger["kind"]>(
  verdict: { outcome: string; trigger?: MomentTrigger },
  kind: K,
): Extract<MomentTrigger, { kind: K }> {
  const trigger = verdict.trigger;
  if (verdict.outcome !== "ai_trigger" || trigger?.kind !== kind) {
    throw new Error(`expected a ${kind} trigger, got ${JSON.stringify(verdict).slice(0, 200)}`);
  }
  return trigger as Extract<MomentTrigger, { kind: K }>;
}

describe("join points (where a late fan's session starts)", () => {
  // DOMAIN §4: the scoreboard each persona opens the app to.
  it.each([
    ["1298150", "late-from-work", 2, "90/4", 84],
    ["1298150", "f1-convert", 2, "106/4", 96],
    ["1415755", "proteas-late", 2, "147/4", 90],
    ["1415755", "football-fan", 2, "155/5", 102],
  ] as const)("%s %s joins innings %i at %s", (id, personaId, innings, score, legalBalls) => {
    const events = timelineOf(id);
    const seq = joinSeq(events, personaOf(id, personaId).joinAt);
    const state = foldEvents(id, events, seq);
    const current = state.innings.at(-1);
    expect(current?.innings).toBe(innings);
    expect(`${current?.runs}/${current?.wickets}`).toBe(score);
    expect(current?.legalBalls).toBe(legalBalls);
    // The join point is the over's last legal ball, not an extra after it.
    expect(events[seq]).toMatchObject({ kind: "delivery", isLegal: true, ballInOver: 6 });
  });

  it("starts a pre-match fan before the first event", () => {
    expect(joinSeq(timelineOf("1298150"), { kind: "pre_match" })).toBe(-1);
  });

  it("starts at the innings_start event when joining after 0 overs", () => {
    const events = timelineOf("1298150");
    const seq = joinSeq(events, { kind: "over", innings: 2, afterOvers: 0 });
    expect(events[seq]).toMatchObject({ kind: "innings_start", innings: 2 });
  });
});

describe("lineup detector (phase 1: toss to lock)", () => {
  it("fires once, at the second playing XI, for babar-believer's two benched picks", () => {
    const steps = replay("1298150", personaOf("1298150", "babar-believer"), [lineupDetector]);
    const fired = firings(steps, "lineup");
    expect(fired).toHaveLength(1);
    const [only] = fired;
    if (!only) throw new Error("no lineup trigger");
    const xiEvents = steps.map((s) => s.input.event).filter((e) => e.kind === "playing_xi");
    expect(only.event.id).toBe(xiEvents[1]?.id);
    const trigger = triggerOf(only.verdict, "lineup_patch");
    expect(trigger.scope).toBe("session");
    expect(trigger.key).toMatch(/^lineup:1298150:[0-9a-f]{8}:none$/);
    expect(trigger.facts.notPlaying.map((p) => p.playerId)).toEqual(["1777c020", "919a3be2"]);
    expect(trigger.facts.notPlaying.map((p) => p.displayName)).toEqual([
      "Fakhar Zaman",
      "Rishabh Pant",
    ]);
    expect(trigger.facts.toss).toEqual({ winner: "IND", decision: "field" });
    expect(trigger.facts.notes).toHaveLength(5);
    expect(trigger.facts.playingXI.map((xi) => [xi.team, xi.players.length])).toEqual([
      ["PAK", 11],
      ["IND", 11],
    ]);
  });

  it("offers only legal single swaps, best projection first, for every benched pick", () => {
    const { players, rules } = loadMatch("1298150");
    const steps = replay("1298150", personaOf("1298150", "babar-believer"), [lineupDetector]);
    const [only] = firings(steps, "lineup");
    if (!only) throw new Error("no lineup trigger");
    const trigger = triggerOf(only.verdict, "lineup_patch");
    const squad = personaOf("1298150", "babar-believer").squad;
    if (!squad) throw new Error("no squad");
    const priors = loadPriors("1298150");
    for (const benched of trigger.facts.notPlaying) {
      expect(benched.swaps.length).toBeGreaterThan(0);
      expect(benched.swaps.length).toBeLessThanOrEqual(5);
      for (const swap of benched.swaps) {
        const playerIds = squad.playerIds.map((id) =>
          id === benched.playerId ? swap.playerId : id,
        );
        const result = validateSquad(
          { playerIds, captainId: squad.captainId, viceCaptainId: squad.viceCaptainId },
          players.players,
          rules.team,
        );
        expect(result.valid).toBe(true);
        expect(result.credits).toBe(swap.creditsAfter);
        expect(swap.projected).toBe(priors.players[swap.playerId]?.projected);
      }
      const projections = benched.swaps.map((swap) => swap.projected);
      expect(projections).toEqual([...projections].sort((a, b) => b - a));
    }
  });

  // Fakhar (BAT, 8.5) out of a 99.5-credit squad with three BATs: the replacement must be a BAT
  // costing at most 9. India's spare BATs cost 9.5 and 10, so only Pakistan's four remain.
  it("enumerates exactly the legal replacements for a benched batter", () => {
    const { players, rules } = loadMatch("1298150");
    const squad = personaOf("1298150", "babar-believer").squad;
    if (!squad) throw new Error("no squad");
    const state = foldEvents("1298150", timelineOf("1298150"), 9);
    const xiIds = Object.values(state.playingXI).flatMap((ids) => ids ?? []);
    const swaps = enumerateSwaps(
      squad,
      "1777c020",
      players.players,
      xiIds,
      rules,
      loadPriors("1298150"),
    );
    expect(swaps.map((swap) => swap.inId).sort()).toEqual([
      "0a4736eb",
      "29e253dd",
      "6843a783",
      "c13e34f4",
    ]);
    expect(Object.fromEntries(swaps.map((swap) => [swap.inId, swap.creditsAfter]))).toEqual({
      "0a4736eb": 98.5,
      "29e253dd": 99,
      "6843a783": 99,
      c13e34f4: 98.5,
    });
  });

  it("hands a benched captain's armband to the replacement", () => {
    const { players, rules } = loadMatch("1298150");
    const base = personaOf("1298150", "babar-believer");
    const squad = base.squad;
    if (!squad) throw new Error("no squad");
    const benchedCaptain = { ...squad, captainId: "919a3be2" };
    const state = foldEvents("1298150", timelineOf("1298150"), 9);
    const xiIds = Object.values(state.playingXI).flatMap((ids) => ids ?? []);
    const swaps = enumerateSwaps(
      benchedCaptain,
      "919a3be2",
      players.players,
      xiIds,
      rules,
      loadPriors("1298150"),
    );
    expect(swaps).toHaveLength(5);
    for (const swap of swaps) {
      const playerIds = squad.playerIds.map((id) => (id === "919a3be2" ? swap.inId : id));
      const draft = { playerIds, captainId: swap.inId, viceCaptainId: squad.viceCaptainId };
      expect(validateSquad(draft, players.players, rules.team).valid).toBe(true);
    }
    const steps = replay("1298150", { ...base, squad: benchedCaptain }, [lineupDetector]);
    const [only] = firings(steps, "lineup");
    if (!only) throw new Error("no lineup trigger");
    const facts = triggerOf(only.verdict, "lineup_patch").facts;
    expect(facts.notPlaying.map((p) => [p.playerId, p.armband])).toEqual([
      ["1777c020", null],
      ["919a3be2", "C"],
    ]);
  });

  it("keys the patch by squad and captaincy, not by pick order", () => {
    const base = personaOf("1298150", "babar-believer");
    const squad = base.squad;
    if (!squad) throw new Error("no squad");
    const keyFor = (persona: typeof base) => {
      const [only] = firings(replay("1298150", persona, [lineupDetector]), "lineup");
      return only ? triggerOf(only.verdict, "lineup_patch").key : "none";
    };
    const original = keyFor(base);
    const reordered = { ...squad, playerIds: [...squad.playerIds].reverse() };
    expect(keyFor({ ...base, squad: reordered })).toBe(original);
    const swappedArmbands = {
      ...squad,
      captainId: squad.viceCaptainId,
      viceCaptainId: squad.captainId,
    };
    expect(keyFor({ ...base, squad: swappedArmbands })).not.toBe(original);
  });

  it("finds Jaiswal benched for captain-rohit in the 2024 final", () => {
    const steps = replay("1415755", personaOf("1415755", "captain-rohit"), [lineupDetector]);
    const fired = firings(steps, "lineup");
    expect(fired).toHaveLength(1);
    const facts = triggerOf(fired[0]?.verdict ?? { outcome: "none" }, "lineup_patch").facts;
    expect(facts.notPlaying.map((p) => p.playerId)).toEqual(["6c19c6e5"]);
    expect(facts.notPlaying[0]?.swaps.length).toBe(5);
  });

  it("stays deterministic when every pick plays, or when the fan has no squad", () => {
    const events = timelineOf("1298150");
    const secondXi = events.filter((e): e is PlayingXIEvent => e.kind === "playing_xi")[1];
    if (!secondXi) throw new Error("no second XI");
    const verdictFor = (personaId: string) =>
      lineupDetector.evaluate({
        before: foldEvents("1298150", events, secondXi.seq - 1),
        after: foldEvents("1298150", events, secondXi.seq),
        event: secondXi,
        events,
        ctx: contextFor("1298150", personaOf("1298150", personaId)),
      });
    expect(verdictFor("late-from-work")).toEqual({
      outcome: "deterministic",
      reason: "squad_all_playing",
    });
    expect(verdictFor("f1-convert")).toEqual({ outcome: "deterministic", reason: "no_squad" });
  });
});
