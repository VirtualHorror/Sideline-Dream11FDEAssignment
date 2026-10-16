import { describe, expect, it } from "vitest";
import {
  type BatterLine,
  buildTimeline,
  createMatchState,
  type FantasyRules,
  fantasyPoints,
  foldEvents,
  type MatchState,
  type Player,
  type Role,
  squadPoints,
} from "../src/index.ts";
import { loadMatch, MATCH_IDS } from "./helpers/data.ts";

function scoresThrough(id: (typeof MATCH_IDS)[number], seq?: number) {
  const fixture = loadMatch(id);
  const events = buildTimeline(fixture);
  const state = foldEvents(id, events, seq);
  return { fixture, state, points: fantasyPoints(state, fixture.players.players, fixture.rules) };
}

describe.each(MATCH_IDS)("fantasy scoring for match %s", (id) => {
  it("matches the oracle totals and non-zero breakdowns for every playing XI player", () => {
    const { fixture, points } = scoresThrough(id);
    expect([...points.keys()].sort()).toEqual(Object.keys(fixture.golden.fantasy).sort());
    for (const [playerId, expected] of Object.entries(fixture.golden.fantasy)) {
      expect(points.get(playerId)).toEqual({
        playerId,
        total: expected.total,
        breakdown: expected.breakdown,
      });
    }
  });
});

describe("fantasy scoring examples", () => {
  it("matches the specified batting, fielding, and rate breakdowns", () => {
    const { points } = scoresThrough("1298150");
    expect(points.get("ba607b88")).toEqual({
      playerId: "ba607b88",
      total: 150,
      breakdown: {
        playingXI: 4,
        runs: 82,
        boundaryBonus: 24,
        sixBonus: 24,
        milestone: 12,
        strikeRate: 4,
      },
    });
    expect(points.get("2f26ac1a")?.total).toBe(32);
    expect(points.get("2f26ac1a")?.breakdown).toMatchObject({
      stumping: 12,
      runOutIndirect: 6,
      strikeRate: -6,
    });
    expect(points.get("8a75e999")?.total).toBe(16);
    expect(points.get("8a75e999")?.breakdown.duck).toBe(-2);
  });

  it("scores the announced XI from a live state", () => {
    const fixture = loadMatch("1298150");
    const events = buildTimeline(fixture);
    const firstDelivery = events.find(
      (event) => event.kind === "delivery" && event.innings === 1 && event.label === "1.1",
    );
    if (!firstDelivery) throw new Error("missing innings one 1.1 delivery");
    const points = fantasyPoints(
      foldEvents("1298150", events, firstDelivery.seq),
      fixture.players.players,
      fixture.rules,
    );
    expect(points.get("8a75e999")?.total).toBe(2);
    expect(points.get("244048f6")?.total).toBe(43);
  });

  it.each([
    { matchId: "1298150", personaId: "babar-believer", total: 755 },
    { matchId: "1298150", personaId: "late-from-work", total: 926 },
    { matchId: "1415755", personaId: "captain-rohit", total: 685 },
    { matchId: "1415755", personaId: "proteas-late", total: 924.5 },
  ] as const)("applies squad multipliers for $personaId", ({ matchId, personaId, total }) => {
    const { fixture, points } = scoresThrough(matchId);
    const persona = fixture.personas.personas.find((candidate) => candidate.id === personaId);
    if (!persona?.squad) throw new Error(`missing fantasy squad for ${personaId}`);
    expect(squadPoints(points, persona.squad, fixture.rules).total).toBe(total);
  });
});

// A one-batter state, so a rule's effect on one line is visible without any other scorer.
const SYNTHETIC_BATTER = "0000000b";

function syntheticBattingState(line: Omit<BatterLine, "playerId">): MatchState {
  const state = createMatchState("1234567");
  state.playingXI = { AAA: [SYNTHETIC_BATTER] };
  state.innings = [
    {
      innings: 1,
      battingTeam: "AAA",
      bowlingTeam: "BBB",
      runs: line.runs,
      wickets: line.out ? 1 : 0,
      legalBalls: line.balls,
      extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0, penalty: 0, total: 0 },
      target: null,
      batters: [{ playerId: SYNTHETIC_BATTER, ...line }],
      bowlers: [],
      fallOfWickets: [],
      overs: [],
      partnership: null,
      status: "complete",
      endReason: "overs_complete",
    },
  ];
  return state;
}

function syntheticPlayer(role: Role): Player {
  return {
    id: SYNTHETIC_BATTER,
    cricsheetName: "Synthetic Batter",
    displayName: "Synthetic Batter",
    shortName: "Synthetic",
    team: "AAA",
    role,
    credits: 8,
  };
}

describe("fantasy scoring rules on synthetic lines", () => {
  it.each([
    { role: "BOWL", breakdown: { playingXI: 4 } },
    { role: "BAT", breakdown: { playingXI: 4, duck: -2 } },
  ] as const)("charges a duck only to duck roles: $role out for 0", ({ role, breakdown }) => {
    const { rules } = loadMatch("1298150");
    const state = syntheticBattingState({
      runs: 0,
      balls: 1,
      fours: 0,
      sixes: 0,
      dots: 1,
      strikeRate: 0,
      out: {
        kind: "bowled",
        bowlerId: "0000000c",
        fielderIds: [],
        label: "0.1",
        eventId: "1234567:0002",
      },
    });
    expect(
      fantasyPoints(state, [syntheticPlayer(role)], rules).get(SYNTHETIC_BATTER)?.breakdown,
    ).toEqual(breakdown);
  });

  it("rounds the strike rate to 2 decimals before the slab lookup", () => {
    const { rules } = loadMatch("1298150");
    const slabRules: FantasyRules = structuredClone(rules);
    slabRules.points.strikeRate.slabs = [{ min: 133.33, max: 133.33, points: 7 }];
    // 40 off 30 balls is 133.333..., inside the slab only once rounded to 133.33.
    const state = syntheticBattingState({
      runs: 40,
      balls: 30,
      fours: 0,
      sixes: 0,
      dots: 10,
      strikeRate: 133.33,
      out: null,
    });
    expect(fantasyPoints(state, [syntheticPlayer("BAT")], slabRules).get(SYNTHETIC_BATTER)).toEqual(
      {
        playerId: SYNTHETIC_BATTER,
        total: 55,
        breakdown: { playingXI: 4, runs: 40, milestone: 4, strikeRate: 7 },
      },
    );
  });
});
