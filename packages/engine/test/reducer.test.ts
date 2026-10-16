import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildTimeline,
  createMatchState,
  foldEvents,
  MatchEventSchema,
  oversText,
  requiredRate,
  runRate,
} from "../src/index.ts";
import { type GoldenInnings, loadMatch, MATCH_IDS } from "./helpers/data.ts";

function matchState(id: (typeof MATCH_IDS)[number]) {
  const fixture = loadMatch(id);
  const events = buildTimeline(fixture);
  return { fixture, events, state: foldEvents(id, events) };
}

function deliveryEvents(events: ReturnType<typeof buildTimeline>) {
  return events.filter((event) => event.kind === "delivery");
}

function expectedInnings(golden: GoldenInnings, nameToId: Record<string, string>) {
  const batters = Object.fromEntries(
    Object.entries(golden.batters).map(([playerId, line]) => [
      playerId,
      {
        runs: line.runs,
        balls: line.balls,
        fours: line.fours,
        sixes: line.sixes,
        dots: line.dots,
        strikeRate: line.strike_rate,
        out: line.out,
      },
    ]),
  );
  const bowlers = Object.fromEntries(
    Object.entries(golden.bowlers).map(([playerId, line]) => [
      playerId,
      {
        legalBalls: line.legal_balls,
        runsConceded: line.conceded,
        wickets: line.wickets,
        maidens: line.maidens,
        dots: line.dots,
        wides: line.wides,
        noballs: line.noballs,
        economy: line.economy,
        oversText: line.overs,
      },
    ]),
  );
  return {
    runs: golden.totals.runs,
    wickets: golden.totals.wickets,
    legalBalls: golden.totals.legal_balls,
    extras: {
      ...golden.totals.extras,
      total: Object.values(golden.totals.extras).reduce((sum, n) => sum + n, 0),
    },
    batters,
    bowlers,
    fallOfWickets: golden.fall_of_wickets.map((fall) => ({
      wicket: fall.wicket,
      runs: fall.runs,
      label: fall.label,
      playerOut: nameToId[fall.player] ?? "missing-player",
    })),
  };
}

function actualInnings(innings: ReturnType<typeof foldEvents>["innings"][number]) {
  return {
    runs: innings.runs,
    wickets: innings.wickets,
    legalBalls: innings.legalBalls,
    extras: innings.extras,
    batters: Object.fromEntries(
      innings.batters.map((line) => [
        line.playerId,
        {
          runs: line.runs,
          balls: line.balls,
          fours: line.fours,
          sixes: line.sixes,
          dots: line.dots,
          strikeRate: line.strikeRate,
          out: line.out?.kind ?? null,
        },
      ]),
    ),
    bowlers: Object.fromEntries(
      innings.bowlers.map((line) => [
        line.playerId,
        {
          legalBalls: line.legalBalls,
          runsConceded: line.runsConceded,
          wickets: line.wickets,
          maidens: line.maidens,
          dots: line.dots,
          wides: line.wides,
          noballs: line.noballs,
          economy: line.economy,
          oversText: line.oversText,
        },
      ]),
    ),
    fallOfWickets: innings.fallOfWickets.map(({ wicket, runs, label, playerOut }) => ({
      wicket,
      runs,
      label,
      playerOut,
    })),
  };
}

describe.each(MATCH_IDS)("reducer for match %s", (id) => {
  it("matches the oracle scorecard for both innings", () => {
    const { fixture, state } = matchState(id);
    const nameToId = Object.fromEntries(
      Object.entries(fixture.raw.info.registry.people).map(([name, playerId]) => [name, playerId]),
    );
    expect(state.innings).toHaveLength(fixture.golden.innings.length);
    for (const golden of fixture.golden.innings) {
      const actual = state.innings.find((innings) => innings.innings === golden.innings);
      if (!actual) throw new Error(`missing innings ${golden.innings}`);
      expect(actualInnings(actual)).toEqual(expectedInnings(golden, nameToId));
    }
  });

  it("records the match result and complete phase", () => {
    const { state } = matchState(id);
    if (id === "1298150") {
      expect(state.result).toEqual({
        winner: "IND",
        text: "India won by 4 wickets",
        playerOfMatch: ["ba607b88"],
      });
    } else {
      expect(state.result?.text).toBe("India won by 7 runs");
    }
    expect(state.phase).toBe("complete");
  });
});

it("rotates strike correctly for all 470 eligible deliveries in both matches", () => {
  let comparisons = 0;
  for (const id of MATCH_IDS) {
    const { events } = matchState(id);
    const deliveries = deliveryEvents(events);
    for (const [index, delivery] of deliveries.entries()) {
      const next = deliveries[index + 1];
      if (!next || next.innings !== delivery.innings || delivery.wickets.length > 0) continue;
      expect(foldEvents(id, events, delivery.seq).live?.strikerId).toBe(next.batter);
      comparisons += 1;
    }
  }
  expect(comparisons).toBe(470);
});

describe("live reducer values", () => {
  const snapshots = [
    {
      matchId: "1298150",
      label: "13.6",
      runsRequired: 70,
      ballsRemaining: 36,
      requiredRunRate: 11.67,
      currentRunRate: 6.43,
    },
    {
      matchId: "1298150",
      label: "17.6",
      runsRequired: 31,
      ballsRemaining: 12,
      requiredRunRate: 15.5,
    },
    {
      matchId: "1298150",
      label: "18.6",
      runsRequired: 16,
      ballsRemaining: 6,
      strikerId: "dbe50b21",
    },
    { matchId: "1415755", label: "14.6", runsRequired: 30, ballsRemaining: 30, requiredRunRate: 6 },
    {
      matchId: "1415755",
      label: "17.6",
      runsRequired: 20,
      ballsRemaining: 12,
      requiredRunRate: 10,
    },
  ] as const;

  it.each(snapshots)("tracks match $matchId through the last $label delivery", (snapshot) => {
    const { matchId, ...expected } = snapshot;
    const { events } = matchState(matchId);
    const deliveries = deliveryEvents(events).filter(
      (event) => event.innings === 2 && event.label === expected.label,
    );
    const last = deliveries.at(-1);
    if (!last) throw new Error(`missing delivery ${expected.label}`);
    const state = foldEvents(matchId, events, last.seq);
    expect(state.live).toMatchObject(expected);
  });

  it("tracks the final partnership until a wicket falls", () => {
    const { events } = matchState("1298150");
    const chase = deliveryEvents(events).filter((event) => event.innings === 2);
    const afterClimax = chase.filter((event) => event.label === "18.6").at(-1);
    const afterWicket = chase.find((event) => event.label === "19.1");
    if (!afterClimax || !afterWicket) throw new Error("missing final-over deliveries");
    const partnership = foldEvents("1298150", events, afterClimax.seq).innings[1]?.partnership;
    expect(partnership).toMatchObject({ runs: 113, legalBalls: 77 });
    expect(partnership?.batterIds.slice().sort()).toEqual(["ba607b88", "dbe50b21"]);
    expect(foldEvents("1298150", events, afterWicket.seq).innings[1]?.partnership).toBeNull();
  });
});

function syntheticInnings(deliveryExtras: readonly ("none" | "legbye" | "wide" | "penalty")[]) {
  const matchId = "1234567";
  const events = [
    MatchEventSchema.parse({
      id: `${matchId}:0000`,
      seq: 0,
      t: 0,
      kind: "coverage_start",
      matchId,
    }),
    MatchEventSchema.parse({
      id: `${matchId}:0001`,
      seq: 1,
      t: 1,
      kind: "innings_start",
      innings: 1,
      battingTeam: "AAA",
      bowlingTeam: "BBB",
      target: null,
    }),
  ];
  let legalBall = 0;
  for (const [index, extra] of deliveryExtras.entries()) {
    const isWide = extra === "wide";
    const isLegal = !isWide;
    const batterRuns = extra === "penalty" ? 4 : 0;
    const ballInOver = legalBall + 1;
    if (isLegal) legalBall += 1;
    const extras = {
      wides: isWide ? 1 : 0,
      noballs: 0,
      byes: 0,
      legbyes: extra === "legbye" ? 1 : 0,
      penalty: extra === "penalty" ? 1 : 0,
    };
    const runs = {
      batter: batterRuns,
      extras: extras.wides + extras.legbyes + extras.penalty,
      total: batterRuns + extras.wides + extras.legbyes + extras.penalty,
    };
    events.push(
      MatchEventSchema.parse({
        id: `${matchId}:${String(index + 2).padStart(4, "0")}`,
        seq: index + 2,
        t: index + 2,
        kind: "delivery",
        innings: 1,
        over: 0,
        ballInOver,
        deliveryInOver: index + 1,
        label: `0.${ballInOver}`,
        batter: "00000001",
        nonStriker: "00000002",
        bowler: "00000003",
        runs,
        extras,
        isLegal,
        isFreeHit: false,
        boundary: batterRuns === 4 ? 4 : 0,
        wickets: [],
      }),
    );
  }
  return foldEvents(matchId, events);
}

const dotBalls = (count: number): "none"[] => Array.from({ length: count }, () => "none");

describe("reducer invariants", () => {
  it("counts maidens for six dots or a leg-bye, but not a wide or charged penalty", () => {
    expect(syntheticInnings(dotBalls(6)).innings[0]?.bowlers[0]?.maidens).toBe(1);
    expect(syntheticInnings(["legbye", ...dotBalls(5)]).innings[0]?.bowlers[0]?.maidens).toBe(1);
    expect(syntheticInnings(["wide", ...dotBalls(6)]).innings[0]?.bowlers[0]?.maidens).toBe(0);
    expect(syntheticInnings(["penalty", ...dotBalls(5)]).innings[0]?.bowlers[0]?.maidens).toBe(0);
  });

  it("rejects non-consecutive event sequences", () => {
    const state = createMatchState("1298150");
    const event = MatchEventSchema.parse({
      id: "1298150:0005",
      seq: 5,
      t: 0,
      kind: "coverage_start",
      matchId: "1298150",
    });
    expect(() => applyEvent(state, event)).toThrow(/sequence/);
  });

  it("formats overs and computes rates with scorecard precision", () => {
    expect(oversText(119)).toBe("19.5");
    expect(runRate(90, 84)).toBe(6.43);
    expect(requiredRate(70, 36)).toBe(11.67);
    expect(requiredRate(1, 0)).toBeNull();
  });
});
