import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  chaseFeatures,
  createMatchState,
  firstInningsFeatures,
  foldEvents,
  type InningsState,
  type MatchEvent,
  MatchEventSchema,
  type MatchState,
  WinProbModelSchema,
  winProbability,
} from "../src/index.ts";
import { loadMatch, loadWinProbModel, MATCH_IDS } from "./helpers/data.ts";

const model = loadWinProbModel();

/** Folds a demo match through the last innings-2 delivery labelled `label` (extras repeat labels). */
function chaseThrough(id: (typeof MATCH_IDS)[number], label: string): MatchState {
  const events = buildTimeline(loadMatch(id));
  const last = events
    .filter((event) => event.kind === "delivery" && event.innings === 2 && event.label === label)
    .at(-1);
  if (!last) throw new Error(`no innings-2 delivery labelled ${label} in ${id}`);
  return foldEvents(id, events, last.seq);
}

type SyntheticBall = "dot" | "single" | "wicket";

/** A real event stream folded by the real reducer: an empty first innings, then this chase. */
function syntheticChase(target: { runs: number; balls: number }, balls: SyntheticBall[]) {
  const matchId = "1234567";
  const events: MatchEvent[] = [];
  const push = (event: Record<string, unknown>) => {
    const seq = events.length;
    events.push(
      MatchEventSchema.parse({
        ...event,
        id: `${matchId}:${String(seq).padStart(4, "0")}`,
        seq,
        t: seq,
      }),
    );
  };
  push({ kind: "coverage_start", matchId });
  push({ kind: "innings_start", innings: 1, battingTeam: "AAA", bowlingTeam: "BBB", target: null });
  push({
    kind: "innings_end",
    innings: 1,
    runs: 0,
    wickets: 0,
    legalBalls: 120,
    reason: "overs_complete",
  });
  push({ kind: "innings_start", innings: 2, battingTeam: "BBB", bowlingTeam: "AAA", target });
  let wickets = 0;
  balls.forEach((ball, index) => {
    const over = Math.floor(index / 6);
    const ballInOver = (index % 6) + 1;
    const batter = `0000b${String(wickets).padStart(3, "0")}`;
    const runs = ball === "single" ? 1 : 0;
    push({
      kind: "delivery",
      innings: 2,
      over,
      ballInOver,
      deliveryInOver: ballInOver,
      label: `${over}.${ballInOver}`,
      batter,
      nonStriker: "0000c000",
      bowler: `0000a${String(over).padStart(3, "0")}`,
      runs: { batter: runs, extras: 0, total: runs },
      extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0, penalty: 0 },
      isLegal: true,
      isFreeHit: false,
      boundary: 0,
      wickets:
        ball === "wicket"
          ? [{ kind: "bowled", playerOut: batter, fielders: [], creditedToBowler: true }]
          : [],
    });
    if (ball === "wicket") wickets += 1;
  });
  return foldEvents(matchId, events);
}

const repeat = (ball: SyntheticBall, count: number): SyntheticBall[] =>
  Array.from({ length: count }, () => ball);

function inningsState(
  innings: 1 | 2,
  battingTeam: string,
  bowlingTeam: string,
  score: Pick<InningsState, "runs" | "wickets" | "legalBalls" | "target" | "status">,
): InningsState {
  return {
    innings,
    battingTeam,
    bowlingTeam,
    ...score,
    extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0, penalty: 0, total: 0 },
    batters: [],
    bowlers: [],
    fallOfWickets: [],
    overs: [],
    partnership: null,
    endReason: score.status === "complete" ? "overs_complete" : null,
  };
}

/** P(chasing team wins) for a mid-chase situation, through the public winProbability. */
function pChase(runsNeeded: number, ballsLeft: number, wicketsLeft: number): number {
  const target = { runs: 301, balls: 120 };
  const state = createMatchState("1234567");
  state.phase = "innings_2";
  state.innings = [
    inningsState(1, "AAA", "BBB", {
      runs: 300,
      wickets: 5,
      legalBalls: 120,
      target: null,
      status: "complete",
    }),
    inningsState(2, "BBB", "AAA", {
      runs: target.runs - runsNeeded,
      wickets: 10 - wicketsLeft,
      legalBalls: target.balls - ballsLeft,
      target,
      status: "in_progress",
    }),
  ];
  const result = winProbability(state, model);
  if (!result) throw new Error("expected a chase probability");
  return result.pBattingTeamWins;
}

function expectVector(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 14);
  });
}

describe("feature vectors (PLAN Task 3 formulas, worked by hand)", () => {
  it("builds the chase features, capping the required rate at six runs a ball", () => {
    // 70 off 36 with 6 wickets in hand: rpb = (70 / 36) / 6, log term = ln 71 / ln 250
    expectVector(
      chaseFeatures(70, 36, 6),
      [1, 0.32407407407407407, 0.6, 0.3, 0.19444444444444445, 0.7720202932617524],
    );
    // 50 off 5 is 10 a ball, capped at 6, so rpb = 1
    expectVector(
      chaseFeatures(50, 5, 3),
      [1, 1, 0.3, 0.041666666666666664, 0.3, 0.7120987889282422],
    );
  });

  it("builds the first-innings features", () => {
    // Inputs where runs/160 and balls/120 differ, so each interaction term is distinguishable.
    expectVector(firstInningsFeatures(40, 2, 96), [1, 0.25, 0.2, 0.8, 0.2, 0.16]);
    expectVector(firstInningsFeatures(150, 7, 120), [1, 0.9375, 0.7, 1, 0.9375, 0.7]);
  });

  it("rejects a model file whose features are not the code's, in the code's order", () => {
    expect(WinProbModelSchema.safeParse(model).success).toBe(true);
    const reordered = structuredClone(model);
    reordered.chase.features = [...model.chase.features].reverse();
    expect(WinProbModelSchema.safeParse(reordered).success).toBe(false);
    const renamed = structuredClone(model);
    renamed.firstInnings.features = ["bias", "runs", "wl", "bb", "r*bb", "wl*bb"];
    expect(WinProbModelSchema.safeParse(renamed).success).toBe(false);
  });
});

describe("committed win-probability model (data/models/winprob-v1.json)", () => {
  it("records its training data and excludes both demo matches", () => {
    expect(model.trainedOn.nMatches).toBeGreaterThanOrEqual(1000);
    expect(model.trainedOn.excludedMatchIds).toEqual(
      expect.arrayContaining(["1298150", "1415755"]),
    );
    expect(model.chase.weights).toHaveLength(model.chase.features.length);
    expect(model.firstInnings.weights).toHaveLength(model.firstInnings.features.length);
  });

  it("is accurate and calibrated on the held-out test split", () => {
    expect(model.metrics.chase.brierTest).toBeLessThan(0.2);
    // A constant 0.5 forecast scores a Brier of 0.25, so the first-innings model must beat a coin.
    expect(model.metrics.firstInnings.brierTest).toBeLessThan(0.25);
    const wellPopulated = model.metrics.chase.calibration.filter((bin) => bin.n > 500);
    expect(wellPopulated.length).toBeGreaterThan(0);
    for (const bin of wellPopulated) {
      expect(Math.abs(bin.predicted - bin.observed)).toBeLessThan(0.1);
    }
  });
});

describe("winProbability terminal and pre-match states", () => {
  it.each(MATCH_IDS)("is null before the first innings starts (%s)", (id) => {
    const events = buildTimeline(loadMatch(id));
    const inningsStart = events.find((event) => event.kind === "innings_start");
    if (!inningsStart) throw new Error("no innings_start");
    expect(winProbability(foldEvents(id, events, inningsStart.seq - 1), model)).toBeNull();
    expect(winProbability(foldEvents(id, events, inningsStart.seq), model)).not.toBeNull();
  });

  it("is 1 once the target is reached and 0 when the balls run out short (real finals)", () => {
    const reached = foldEvents("1298150", buildTimeline(loadMatch("1298150")));
    expect(winProbability(reached, model)).toEqual({
      battingTeam: "IND",
      bowlingTeam: "PAK",
      pBattingTeamWins: 1,
    });
    const short = foldEvents("1415755", buildTimeline(loadMatch("1415755")));
    expect(winProbability(short, model)).toEqual({
      battingTeam: "SA",
      bowlingTeam: "IND",
      pBattingTeamWins: 0,
    });
  });

  it("is 0 when the chasing side is all out short, and 0.5 for a tie at the end", () => {
    const p = (state: MatchState) => winProbability(state, model)?.pBattingTeamWins;
    expect(p(syntheticChase({ runs: 50, balls: 120 }, repeat("wicket", 10)))).toBe(0);
    expect(p(syntheticChase({ runs: 7, balls: 6 }, repeat("single", 6)))).toBe(0.5);
    expect(
      p(syntheticChase({ runs: 3, balls: 120 }, ["single", "single", ...repeat("wicket", 10)])),
    ).toBe(0.5);
    expect(p(syntheticChase({ runs: 2, balls: 120 }, ["single", "single"]))).toBe(1);
    const live = p(syntheticChase({ runs: 50, balls: 120 }, ["dot"]));
    expect(live).toBeGreaterThan(0);
    expect(live).toBeLessThan(1);
  });
});

describe("chase probability shape (fast-check over runs needed 1-300, balls 1-120, wickets 1-10)", () => {
  const runsNeeded = fc.integer({ min: 1, max: 300 });
  const ballsLeft = fc.integer({ min: 1, max: 120 });
  const wicketsLeft = fc.integer({ min: 1, max: 10 });

  it("never rises as the runs needed rise", () => {
    fc.assert(
      fc.property(runsNeeded, runsNeeded, ballsLeft, wicketsLeft, (a, b, balls, wickets) => {
        const [fewer, more] = a <= b ? [a, b] : [b, a];
        expect(pChase(fewer, balls, wickets)).toBeGreaterThanOrEqual(pChase(more, balls, wickets));
      }),
      { numRuns: 500 },
    );
  });

  it("never falls as wickets in hand rise", () => {
    fc.assert(
      fc.property(runsNeeded, ballsLeft, wicketsLeft, wicketsLeft, (runs, balls, a, b) => {
        const [fewer, more] = a <= b ? [a, b] : [b, a];
        expect(pChase(runs, balls, fewer)).toBeLessThanOrEqual(pChase(runs, balls, more));
      }),
      { numRuns: 500 },
    );
  });

  it("stays a probability", () => {
    fc.assert(
      fc.property(runsNeeded, ballsLeft, wicketsLeft, (runs, balls, wickets) => {
        const p = pChase(runs, balls, wickets);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});

describe("win probability on the demo chases", () => {
  it("1298150: India are long odds at 14 overs and climb with the two sixes off Rauf", () => {
    const at14 = winProbability(chaseThrough("1298150", "13.6"), model);
    expect(at14?.battingTeam).toBe("IND");
    expect(at14?.pBattingTeamWins).toBeLessThan(0.35);
    const before = winProbability(chaseThrough("1298150", "18.4"), model)?.pBattingTeamWins ?? 1;
    const after = winProbability(chaseThrough("1298150", "18.6"), model)?.pBattingTeamWins ?? 0;
    expect(after).toBeGreaterThan(before + 0.05);
  });

  it("1415755: South Africa are favourites needing 30 off 30", () => {
    const at15 = winProbability(chaseThrough("1415755", "14.6"), model);
    expect(at15?.battingTeam).toBe("SA");
    expect(at15?.pBattingTeamWins).toBeGreaterThan(0.65);
  });

  it.each(MATCH_IDS)("gives the winner probability 1 at full time (%s)", (id) => {
    const final = foldEvents(id, buildTimeline(loadMatch(id)));
    const wp = winProbability(final, model);
    if (!wp || !final.result?.winner) throw new Error("expected a decided match");
    const pWinner =
      wp.battingTeam === final.result.winner ? wp.pBattingTeamWins : 1 - wp.pBattingTeamWins;
    expect(pWinner).toBe(1);
  });
});
