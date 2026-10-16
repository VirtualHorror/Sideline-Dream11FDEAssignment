import { describe, expect, it } from "vitest";
import {
  collapseDetector,
  type DeliveryEvent,
  enumerateSwaps,
  foldEvents,
  joinSeq,
  lineupDetector,
  type MatchEvent,
  type MomentTrigger,
  nudgeDetector,
  type Persona,
  type PlayingXIEvent,
  validateSquad,
  type Wicket,
} from "../src/index.ts";
import { loadMatch, loadPriors, loadWinProbModel } from "./helpers/data.ts";
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

/** A copy of the timeline with `wicket` added to the delivery at `seq` (the reducer accepts it). */
function withWicket(events: readonly MatchEvent[], seq: number, wicket: Wicket): MatchEvent[] {
  return events.map((event) =>
    event.seq === seq && event.kind === "delivery" ? { ...event, wickets: [wicket] } : event,
  );
}

/** A pre-match persona with the given squad and armbands (the collapse detector reads only these). */
function armbandPersona(
  id: "1298150" | "1415755",
  playerIds: string[],
  captainId: string,
  viceCaptainId: string,
): Persona {
  return {
    ...personaOf(id, id === "1298150" ? "babar-believer" : "captain-rohit"),
    joinAt: { kind: "pre_match" },
    squad: { playerIds, captainId, viceCaptainId },
  };
}

const BABAR_SQUAD = ["8a75e999", "2f26ac1a", "1777c020", "9c9af282", "24bb1c2f", "9de62878"].concat(
  ["ba607b88", "dbe50b21", "244048f6", "2e81a32d", "919a3be2"],
);
/** babar-believer's squad with Iftikhar (29e253dd) in place of the benched Fakhar (1777c020). */
const IFTIKHAR_SQUAD = BABAR_SQUAD.map((id) => (id === "1777c020" ? "29e253dd" : id));

describe("collapse detector (phase 2: early collapse)", () => {
  it("babar-believer: one bailout at innings-1 1.1 (Babar, C, 0 off 1), then quest_active at 3.6", () => {
    const steps = replay("1298150", personaOf("1298150", "babar-believer"), [collapseDetector]);
    const fired = firings(steps, "collapse");
    expect(
      fired.map((f) => [
        f.event.kind === "delivery" && f.event.innings,
        f.event.kind === "delivery" && f.event.label,
        f.verdict.outcome,
        f.verdict.reason,
      ]),
    ).toEqual([
      [1, "1.1", "ai_trigger", "armband_out_cheaply"],
      [1, "3.6", "suppressed", "quest_active"],
    ]);
    const trigger = triggerOf(fired[0]?.verdict ?? { outcome: "none" }, "bailout");
    expect(trigger.key).toBe("bailout:1298150:1298150:0018:C");
    expect(trigger.scope).toBe("shared");
    const facts = trigger.facts;
    expect(facts.armband).toBe("C");
    expect(facts.dismissal).toMatchObject({
      runs: 0,
      balls: 1,
      kind: "lbw",
      scorecard: "Babar Azam lbw b Arshdeep Singh 0 (1)",
      description: "1.1 Arshdeep to Babar, OUT, lbw",
    });
    expect(facts.dismissal.batter.playerId).toBe("8a75e999");
    expect(facts.dismissal.bowler?.playerId).toBe("244048f6");
    // Babar fell to the 7th legal ball: the quest covers the next 18, balls 8 to 25.
    expect(facts.questWindow).toEqual({
      innings: 1,
      fromLegalBall: 8,
      toLegalBall: 25,
      fromLabel: "1.2",
      toLabel: "4.1",
    });
    expect(facts.atCrease.map((b) => [b.playerId, b.runs, b.balls])).toEqual([["2f26ac1a", 0, 6]]);
    expect(facts.bowler).toMatchObject({
      playerId: "244048f6",
      overs: "0.1",
      runsConceded: 0,
      wickets: 1,
    });
    expect(facts.situation).toMatchObject({ score: "1/1", overs: "1.1", target: null });
    expect(facts.grounded).toEqual([
      { id: "dismissal", text: "Babar Azam lbw b Arshdeep Singh 0 (1)" },
      { id: "bowler_figures", text: "Arshdeep Singh has 1 wicket for 0 runs in 0.1 overs" },
      { id: "partnership", text: "Mohammad Rizwan and Babar Azam added 1 run off 7 balls" },
      { id: "situation", text: "PAK are 1/1 after 1.1 overs" },
    ]);
    // The suppressed dismissal is Rizwan, the vice-captain, for 4 off 12.
    const suppressed = fired[1];
    const event = suppressed?.event as DeliveryEvent;
    expect(event.wickets.map((w) => w.playerOut)).toEqual(["2f26ac1a"]);
    const state = foldEvents("1298150", timelineOf("1298150"), event.seq);
    const line = state.innings[0]?.batters.find((b) => b.playerId === "2f26ac1a");
    expect([line?.runs, line?.balls]).toEqual([4, 12]);
  });

  it("projects the squad before and after the captain's duck", () => {
    const steps = replay("1298150", personaOf("1298150", "babar-believer"), [collapseDetector]);
    const facts = triggerOf(
      firings(steps, "collapse")[0]?.verdict ?? { outcome: "none" },
      "bailout",
    ).facts;
    const priors = loadPriors("1298150");
    const projected = (id: string) => priors.players[id]?.projected ?? Number.NaN;
    // Hand sum: every pick's projection, Babar (C) twice and Rizwan (VC) one and a half times.
    const before = BABAR_SQUAD.reduce(
      (sum, id) => sum + projected(id) * (id === "8a75e999" ? 2 : id === "2f26ac1a" ? 1.5 : 1),
      0,
    );
    // PLAN 2.7: Babar has 2 points after his golden duck (4 for the XI, -2 for the duck).
    expect(facts.projection.dismissedPoints).toBe(2);
    expect(facts.projection.dismissedProjected).toBe(projected("8a75e999"));
    expect(facts.projection.multiplier).toBe(2);
    expect(facts.projection.before).toBeCloseTo(before, 2);
    expect(facts.projection.after).toBeCloseTo(before - 2 * projected("8a75e999") + 2 * 2, 2);
  });

  it("captain-rohit: bailout at innings-1 1.4 (Rohit, C, 9 off 5), quest_active for Pant at 1.6", () => {
    const steps = replay("1415755", personaOf("1415755", "captain-rohit"), [collapseDetector]);
    const fired = firings(steps, "collapse");
    expect(
      fired.map((f) => [f.event.kind === "delivery" && f.event.label, f.verdict.reason]),
    ).toEqual([
      ["1.4", "armband_out_cheaply"],
      ["1.6", "quest_active"],
    ]);
    const facts = triggerOf(fired[0]?.verdict ?? { outcome: "none" }, "bailout").facts;
    expect(facts.dismissal.batter.playerId).toBe("740742ef");
    expect([facts.armband, facts.dismissal.runs, facts.dismissal.balls]).toEqual(["C", 9, 5]);
    expect(facts.questWindow).toMatchObject({ fromLegalBall: 11, toLegalBall: 28 });
    expect(facts.atCrease.map((b) => [b.shortName, b.runs, b.balls])).toEqual([["Kohli", 14, 5]]);
    const pant = fired[1]?.event as DeliveryEvent;
    expect(pant.wickets.map((w) => w.playerOut)).toEqual(["919a3be2"]);
  });

  it.each([
    ["1298150", "late-from-work"],
    ["1415755", "proteas-late"],
  ] as const)("%s %s: no bailout after a late join (or for Klaasen's 52)", (id, personaId) => {
    const steps = replay(id, personaOf(id, personaId), [collapseDetector]);
    expect(firings(steps, "collapse")).toEqual([]);
  });

  // Babar (C) falls to ball 7, so the quest runs to ball 25. A vice-captain run out at the
  // non-striker's end on ball 25 is inside it; on ball 26 it opens a second quest.
  it.each([
    [37, 25, "suppressed", "quest_active"],
    [38, 26, "ai_trigger", "armband_out_cheaply"],
  ] as const)("a VC run out at seq %i (ball %i) is %s", (seq, position, outcome, reason) => {
    const events = timelineOf("1298150");
    const at = events[seq] as DeliveryEvent;
    expect(at.nonStriker).toBe("29e253dd");
    const injected = withWicket(events, seq, {
      kind: "run out",
      playerOut: "29e253dd",
      fielders: [at.bowler],
      creditedToBowler: false,
    });
    const persona = armbandPersona("1298150", IFTIKHAR_SQUAD, "8a75e999", "29e253dd");
    const fired = firings(
      replay("1298150", persona, [collapseDetector], { events: injected }),
      "collapse",
    );
    const verdict = fired.find((f) => f.event.seq === seq)?.verdict;
    expect(verdict).toMatchObject({ outcome, reason });
    const before = foldEvents("1298150", injected, seq - 1);
    expect((before.innings[0]?.legalBalls ?? 0) + 1).toBe(position);
  });

  it.each([
    [48, "ai_trigger", "armband_out_cheaply"],
    [49, "deterministic", "not_early"],
  ] as const)("a captain bowled at seq %i (balls 36 and 37) is %s", (seq, outcome, reason) => {
    const events = timelineOf("1298150");
    const at = events[seq] as DeliveryEvent;
    expect(at.batter).toBe("29e253dd");
    const injected = withWicket(events, seq, {
      kind: "bowled",
      playerOut: "29e253dd",
      fielders: [],
      creditedToBowler: true,
    });
    const persona = armbandPersona("1298150", IFTIKHAR_SQUAD, "29e253dd", "9de62878");
    const steps = replay("1298150", persona, [collapseDetector], { events: injected });
    const step = steps.find((s) => s.input.event.seq === seq);
    expect(step?.verdicts[0]?.verdict).toMatchObject({ outcome, reason });
  });

  // Suryakumar is on exactly 10 after the chase's 4.5 and on 11 after 4.6.
  it.each([
    [167, "ai_trigger", "armband_out_cheaply"],
    [168, "deterministic", "not_cheap"],
  ] as const)("a captain out at seq %i (10 or 11 runs) is %s", (seq, outcome, reason) => {
    const squad = personaOf("1298150", "late-from-work").squad?.playerIds ?? [];
    const persona = armbandPersona("1298150", squad, "271f83cd", "ba607b88");
    const events = timelineOf("1298150");
    expect((events[seq] as DeliveryEvent).batter).toBe("271f83cd");
    const injected = withWicket(events, seq, {
      kind: "bowled",
      playerOut: "271f83cd",
      fielders: [],
      creditedToBowler: true,
    });
    const steps = replay("1298150", persona, [collapseDetector], { events: injected });
    const step = steps.find((s) => s.input.event.seq === seq);
    expect(step?.verdicts[0]?.verdict).toMatchObject({ outcome, reason });
  });

  it("explains every deterministic verdict", () => {
    const reasons = (persona: Persona) =>
      new Set(
        replay("1298150", persona, [collapseDetector]).flatMap((s) =>
          s.verdicts.map((v) => v.verdict.reason),
        ),
      );
    expect(reasons(personaOf("1298150", "f1-convert"))).toEqual(
      new Set(["not_delivery", "no_squad"]),
    );
    // babar-believer sees Rizwan's dismissal suppressed, everyone else's ignored, and nothing
    // else of note: Shadab (no armband) and the rest are "not_armband".
    expect(reasons(personaOf("1298150", "babar-believer"))).toEqual(
      new Set(["not_delivery", "no_wicket", "not_armband", "armband_out_cheaply", "quest_active"]),
    );
  });
});

/** The delivery `pick` selects, with the extras-repeat rule of the leverage tests. */
const chaseBall =
  (label: string, extra?: "noballs" | "wides") =>
  (event: MatchEvent): event is DeliveryEvent =>
    event.kind === "delivery" &&
    event.innings === 2 &&
    event.label === label &&
    (extra ? event.extras[extra] > 0 : event.isLegal);

describe("nudge detector (phase 4: hold the spoiler)", () => {
  const nudges = (id: "1298150" | "1415755") => {
    const persona = personaOf(id, id === "1298150" ? "babar-believer" : "captain-rohit");
    return firings(replay(id, persona, [nudgeDetector]), "nudge");
  };

  it.each(["1298150", "1415755"] as const)(
    "fires on 5 to 50 deliveries of %s, keyed by event",
    (id) => {
      const fired = nudges(id);
      expect(fired.length).toBeGreaterThanOrEqual(5);
      expect(fired.length).toBeLessThanOrEqual(50);
      for (const { event, verdict } of fired) {
        const trigger = triggerOf(verdict, "spoiler_nudge");
        expect(trigger.key).toBe(`nudge:${id}:${event.id}`);
        expect(trigger.scope).toBe("shared");
      }
    },
  );

  it("includes the five 1298150 climax balls of PLAN 3.4 (as amended by D-043)", () => {
    const events = timelineOf("1298150");
    const fired = new Set(nudges("1298150").map((f) => f.event.id));
    for (const pick of [
      chaseBall("18.6"),
      chaseBall("19.1"),
      chaseBall("19.4", "noballs"),
      chaseBall("19.5"),
      chaseBall("19.6", "wides"),
    ]) {
      const event = events.filter(pick).at(-1);
      expect(fired.has(event?.id ?? "missing")).toBe(true);
    }
  });

  // The big balls (22 and 24) are the independent Python re-derivation's count; the ball that
  // ended each match adds one (D-046, Nabhanyu's request): 1298150's winning single scores 0.019
  // and 1415755's last ball 0.0003, far below the threshold, yet each ends the match.
  it.each([
    ["1298150", 23, "1298150:0263", "19.6 Nawaz to Ashwin, 1 run"],
    ["1415755", 25, "1415755:0260", "19.6 Hardik to Nortje, 1 run"],
  ] as const)(
    "%s: %i teasers, the last on the ball that ends the match",
    (id, count, lastId, text) => {
      const fired = nudges(id);
      expect(fired).toHaveLength(count);
      const model = loadWinProbModel();
      const big = fired.filter(
        (f) =>
          triggerOf(f.verdict, "spoiler_nudge").facts.leverage.value >=
          model.leverage.nudgeThreshold,
      );
      expect(big).toHaveLength(count - 1);
      const last = fired.at(-1);
      expect(last?.event.id).toBe(lastId);
      expect(last?.verdict.reason).toBe("match_decided");
      const facts = triggerOf(last?.verdict ?? { outcome: "none" }, "spoiler_nudge").facts;
      expect(facts.why).toBe("match_decided");
      expect(facts.leverage.value).toBeLessThan(model.leverage.nudgeThreshold);
      expect(facts.outcome).toMatchObject({ description: text, matchOver: true });
    },
  );

  it("does not treat the end of the first innings as deciding anything", () => {
    const events = timelineOf("1298150");
    const lastOfFirst = events
      .filter((e): e is DeliveryEvent => e.kind === "delivery" && e.innings === 1)
      .at(-1);
    if (!lastOfFirst) throw new Error("no first innings");
    const steps = replay("1298150", personaOf("1298150", "babar-believer"), [nudgeDetector]);
    const step = steps.find((s) => s.input.event.id === lastOfFirst.id);
    expect(step?.verdicts[0]?.verdict).toEqual({
      outcome: "deterministic",
      reason: "below_threshold",
    });
  });

  it("an all-out chase is decided by its tenth wicket, not by a later ball", () => {
    // 1415755's chase is 161/6 before the last over; Miller (19.1) and Rabada (19.5) fall in it.
    // Two injected wickets (19.3, 19.4) make Rabada's the tenth, with a ball still to come.
    const events = timelineOf("1415755");
    const at = (label: string) => events.filter(chaseBall(label)).at(-1) as DeliveryEvent;
    const out = (event: DeliveryEvent): Wicket => ({
      kind: "bowled",
      playerOut: event.batter,
      fielders: [],
      creditedToBowler: true,
    });
    const eighth = at("19.3");
    const ninth = at("19.4");
    const injected = withWicket(withWicket(events, eighth.seq, out(eighth)), ninth.seq, out(ninth));
    const persona = personaOf("1415755", "captain-rohit");
    const steps = replay("1415755", persona, [nudgeDetector], { events: injected });
    const decided = steps.filter((s) => s.verdicts[0]?.verdict.reason === "match_decided");
    expect(decided.map((s) => s.input.event.id)).toEqual([at("19.5").id]);
    expect(
      steps.find((s) => s.input.event.id === at("19.5").id)?.input.after.innings[1]?.wickets,
    ).toBe(10);
  });

  it("gives the teaser only what was known before the ball, and the outcome apart (18.6 six)", () => {
    const events = timelineOf("1298150");
    const ball = events.filter(chaseBall("18.6")).at(-1);
    const fired = nudges("1298150").find((f) => f.event.id === ball?.id);
    const facts = triggerOf(fired?.verdict ?? { outcome: "none" }, "spoiler_nudge").facts;
    expect(facts.why).toBe("big_ball");
    // DOMAIN §4: 144/4 and 16 off 6 after the second six, so 138/4 needing 22 off 7 before it.
    expect(facts.before.situation).toMatchObject({
      score: "138/4",
      runsRequired: 22,
      ballsRemaining: 7,
    });
    // Kohli has 74 off 50 by legal ball 114 (PLAN 4.8), so 68 off 49 before it.
    expect(facts.before.striker).toMatchObject({ shortName: "Kohli", runs: 68, balls: 49 });
    expect(facts.before.bowler.shortName).toBe("Rauf");
    expect(facts.before.freeHit).toBe(false);
    expect(facts.outcome).toMatchObject({
      description: "18.6 Rauf to Kohli, six",
      tags: ["six"],
      runs: 6,
      dismissed: [],
      matchOver: false,
    });
    expect(facts.outcome.situation).toMatchObject({
      score: "144/4",
      runsRequired: 16,
      ballsRemaining: 6,
    });
    expect(facts.leverage.value).toBeCloseTo(0.41, 2);
    expect(facts.leverage.threshold).toBe(loadWinProbModel().leverage.nudgeThreshold);
    expect(facts.leverage.wpAfter).toBeGreaterThan(facts.leverage.wpBefore);
  });

  it("is deterministic below the threshold and on anything that is not a delivery", () => {
    const steps = replay("1298150", personaOf("1298150", "babar-believer"), [nudgeDetector]);
    const reasons = new Set(steps.map((s) => s.verdicts[0]?.verdict.reason));
    expect(reasons).toEqual(
      new Set(["not_delivery", "below_threshold", "big_ball", "match_decided"]),
    );
  });
});
