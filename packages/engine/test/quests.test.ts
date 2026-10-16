import { describe, expect, it } from "vitest";
import {
  type DeliveryEvent,
  type MatchEvent,
  type QuestRule,
  QuestRuleSchema,
  resolveQuestRule,
} from "../src/index.ts";
import { timelineOf } from "./helpers/replay.ts";

const events = timelineOf("1298150");

/** The timeline up to and including the `n`-th legal ball of `innings` (n = 0: before it starts). */
function through(innings: 1 | 2, n: number): MatchEvent[] {
  let legal = 0;
  const cut = events.findIndex((event) => {
    if (event.kind !== "delivery" || event.innings !== innings || !event.isLegal) return false;
    legal += 1;
    return legal === n;
  });
  if (n === 0) {
    const start = events.findIndex((e) => e.kind === "innings_start" && e.innings === innings);
    return events.slice(0, start + 1);
  }
  if (cut === -1) throw new Error(`innings ${innings} has no legal ball ${n}`);
  return events.slice(0, cut + 1);
}

const rule = (r: QuestRule) => QuestRuleSchema.parse(r);
const KOHLI = "ba607b88";
const ROHIT = "740742ef";

// Expected values come from the raw Cricsheet file, re-derived independently in Python (F04 log):
// chase wickets fall on legal balls 11, 20, 33, 37, 115 and 119; sixes on 113, 114 and the 19.4
// no-ball (position 118); over 18 goes 1, 1, 0, 1, 6, 6; Kohli has 46, 57, 62, 68 and 74 by balls
// 100, 106, 112, 113 and 114, and is the 50 at ball 103; Rohit is out for 4 at ball 20.
describe("resolveQuestRule on 1298150 (PLAN 4.8)", () => {
  it("wins a six-in-window bet on the two Rauf sixes", () => {
    const bet = rule({
      type: "boundary_in_window",
      innings: 2,
      fromLegalBall: 113,
      toLegalBall: 114,
      boundary: 6,
    });
    expect(resolveQuestRule(bet, events)).toBe("won");
  });

  it("wins 15 or more off the 19th over of the chase", () => {
    const bet = rule({ type: "runs_in_over", innings: 2, over: 18, op: "gte", value: 15 });
    expect(resolveQuestRule(bet, events)).toBe("won");
  });

  it("keeps a wicket bet pending mid-window and loses it when the window closes empty", () => {
    const bet = rule({ type: "wicket_in_window", innings: 1, fromLegalBall: 8, toLegalBall: 23 });
    expect(resolveQuestRule(bet, through(1, 20))).toBe("pending");
    expect(resolveQuestRule(bet, events)).toBe("lost");
  });

  it("settles a batter's runs by a ball: Kohli has exactly 74 by ball 114", () => {
    const at = (value: number) =>
      rule({
        type: "batter_runs_by",
        innings: 2,
        playerId: KOHLI,
        byLegalBall: 114,
        op: "gte",
        value,
      });
    expect(resolveQuestRule(at(75), events)).toBe("lost");
    expect(resolveQuestRule(at(74), events)).toBe("won");
  });
});

describe("resolveQuestRule semantics", () => {
  it.each([
    [
      "a four where a six came",
      { type: "boundary_in_window", innings: 2, fromLegalBall: 113, toLegalBall: 113, boundary: 4 },
      "lost",
    ],
    [
      "the no-ball six (position 118)",
      { type: "boundary_in_window", innings: 2, fromLegalBall: 118, toLegalBall: 118, boundary: 6 },
      "won",
    ],
    [
      "any boundary on balls 115-117",
      {
        type: "boundary_in_window",
        innings: 2,
        fromLegalBall: 115,
        toLegalBall: 117,
        boundary: "any",
      },
      "lost",
    ],
    [
      "at most 15 off over 18",
      { type: "runs_in_over", innings: 2, over: 18, op: "lte", value: 15 },
      "won",
    ],
    [
      "at most 14 off over 18",
      { type: "runs_in_over", innings: 2, over: 18, op: "lte", value: 14 },
      "lost",
    ],
    [
      "16 or more off over 18",
      { type: "runs_in_over", innings: 2, over: 18, op: "gte", value: 16 },
      "lost",
    ],
    [
      "16 off the last over, extras included",
      { type: "runs_in_over", innings: 2, over: 19, op: "gte", value: 16 },
      "won",
    ],
    [
      "Babar's wicket on ball 7",
      { type: "wicket_in_window", innings: 1, fromLegalBall: 7, toLegalBall: 7 },
      "won",
    ],
    [
      "Karthik's stumping on ball 119",
      { type: "wicket_in_window", innings: 2, fromLegalBall: 119, toLegalBall: 120 },
      "won",
    ],
    [
      "a wicket on balls 116-118",
      { type: "wicket_in_window", innings: 2, fromLegalBall: 116, toLegalBall: 118 },
      "lost",
    ],
    [
      "two dots in the chase's first over",
      { type: "dots_in_window", innings: 2, fromLegalBall: 1, toLegalBall: 6, op: "gte", value: 2 },
      "won",
    ],
    [
      "three dots in the chase's first over",
      { type: "dots_in_window", innings: 2, fromLegalBall: 1, toLegalBall: 6, op: "gte", value: 3 },
      "lost",
    ],
    [
      "at most two dots in it",
      { type: "dots_in_window", innings: 2, fromLegalBall: 1, toLegalBall: 6, op: "lte", value: 2 },
      "won",
    ],
    [
      "at most six dots in two overs (there are 7)",
      {
        type: "dots_in_window",
        innings: 2,
        fromLegalBall: 1,
        toLegalBall: 12,
        op: "lte",
        value: 6,
      },
      "lost",
    ],
    [
      "six dots in innings 1's first over",
      { type: "dots_in_window", innings: 1, fromLegalBall: 1, toLegalBall: 6, op: "gte", value: 6 },
      "won",
    ],
    [
      "Kohli 47 by ball 100 (he had 46)",
      {
        type: "batter_runs_by",
        innings: 2,
        playerId: KOHLI,
        byLegalBall: 100,
        op: "gte",
        value: 47,
      },
      "lost",
    ],
    [
      "Kohli at most 46 by ball 100",
      {
        type: "batter_runs_by",
        innings: 2,
        playerId: KOHLI,
        byLegalBall: 100,
        op: "lte",
        value: 46,
      },
      "won",
    ],
  ] as const)("on the full match: %s is %s", (_name, r, outcome) => {
    expect(resolveQuestRule(rule(r as QuestRule), events)).toBe(outcome);
  });

  it.each([
    [
      "six bet before ball 113",
      112,
      { type: "boundary_in_window", innings: 2, fromLegalBall: 113, toLegalBall: 114, boundary: 6 },
      "pending",
    ],
    [
      "2+ off over 18 after two singles",
      110,
      { type: "runs_in_over", innings: 2, over: 18, op: "gte", value: 2 },
      "won",
    ],
    [
      "at most 1 off over 18 after two singles",
      110,
      { type: "runs_in_over", innings: 2, over: 18, op: "lte", value: 1 },
      "lost",
    ],
    [
      "15+ off over 18 after two balls",
      110,
      { type: "runs_in_over", innings: 2, over: 18, op: "gte", value: 15 },
      "pending",
    ],
    [
      "Kohli 74 by ball 114, at ball 106 (57)",
      106,
      {
        type: "batter_runs_by",
        innings: 2,
        playerId: KOHLI,
        byLegalBall: 114,
        op: "gte",
        value: 74,
      },
      "pending",
    ],
    [
      "Kohli 57 by ball 114, at ball 106",
      106,
      {
        type: "batter_runs_by",
        innings: 2,
        playerId: KOHLI,
        byLegalBall: 114,
        op: "gte",
        value: 57,
      },
      "won",
    ],
    [
      "Kohli at most 56 by ball 114, at ball 106",
      106,
      {
        type: "batter_runs_by",
        innings: 2,
        playerId: KOHLI,
        byLegalBall: 114,
        op: "lte",
        value: 56,
      },
      "lost",
    ],
    [
      "Rohit 5 by ball 30, after his dismissal on ball 20",
      22,
      { type: "batter_runs_by", innings: 2, playerId: ROHIT, byLegalBall: 30, op: "gte", value: 5 },
      "lost",
    ],
    [
      "Rohit at most 4 by ball 30, after it",
      22,
      { type: "batter_runs_by", innings: 2, playerId: ROHIT, byLegalBall: 30, op: "lte", value: 4 },
      "won",
    ],
    [
      "any chase rule before the chase starts",
      0,
      { type: "wicket_in_window", innings: 2, fromLegalBall: 1, toLegalBall: 6 },
      "pending",
    ],
  ] as const)("part-way: %s is %s", (_name, ball, r, outcome) => {
    expect(resolveQuestRule(rule(r as QuestRule), through(2, ball))).toBe(outcome);
  });

  it("closes every window when the innings ends early", () => {
    // The chase cut at ball 100, then an innings_end (as if the target had been reached).
    const cut = through(2, 100);
    const last = cut.at(-1) as DeliveryEvent;
    const end: MatchEvent = {
      id: `1298150:${String(last.seq + 1).padStart(4, "0")}`,
      seq: last.seq + 1,
      t: last.t + 30_000,
      kind: "innings_end",
      innings: 2,
      runs: 160,
      wickets: 4,
      legalBalls: 100,
      reason: "target_reached",
    };
    const wicket = rule({
      type: "wicket_in_window",
      innings: 2,
      fromLegalBall: 110,
      toLegalBall: 115,
    });
    expect(resolveQuestRule(wicket, cut)).toBe("pending");
    expect(resolveQuestRule(wicket, [...cut, end])).toBe("lost");
    const dots = rule({
      type: "dots_in_window",
      innings: 2,
      fromLegalBall: 110,
      toLegalBall: 115,
      op: "lte",
      value: 3,
    });
    expect(resolveQuestRule(dots, [...cut, end])).toBe("won");
  });
});
