import { describe, expect, it } from "vitest";
import {
  ControlRequestSchema,
  DeliveryEventSchema,
  MatchEventSchema,
  MomentSchema,
  PersonaSchema,
  PlayerIdSchema,
  QuestRuleSchema,
  StreamMessageSchema,
} from "../src/index.ts";

// A legal, ordinary delivery: hand-written from Cricsheet 1298150, chase over 19 (index 18),
// fifth legal ball: Kohli hits Haris Rauf for six. Ids are Cricsheet registry ids.
const kohliSix = {
  id: "1298150:0414",
  seq: 414,
  t: 11_500_000,
  kind: "delivery",
  innings: 2,
  over: 18,
  ballInOver: 5,
  deliveryInOver: 5,
  label: "18.5",
  batter: "ba607b88",
  nonStriker: "dbe50b21",
  bowler: "24bb1c2f",
  runs: { batter: 6, extras: 0, total: 6 },
  extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0, penalty: 0 },
  isLegal: true,
  isFreeHit: false,
  boundary: 6,
  wickets: [],
} as const;

describe("DeliveryEventSchema invariants", () => {
  it("accepts a well-formed legal delivery", () => {
    expect(DeliveryEventSchema.safeParse(kohliSix).success).toBe(true);
  });

  it("rejects a wide that claims to be a legal ball (would corrupt over/ball counting)", () => {
    const wideMarkedLegal = {
      ...kohliSix,
      runs: { batter: 0, extras: 1, total: 1 },
      extras: { ...kohliSix.extras, wides: 1 },
      boundary: 0,
      isLegal: true,
    };
    expect(DeliveryEventSchema.safeParse(wideMarkedLegal).success).toBe(false);
  });

  it("rejects runs whose total is not batter + extras (would corrupt the score)", () => {
    const badTotal = { ...kohliSix, runs: { batter: 6, extras: 0, total: 7 } };
    expect(DeliveryEventSchema.safeParse(badTotal).success).toBe(false);
  });

  it("rejects a label that disagrees with over and ballInOver", () => {
    expect(DeliveryEventSchema.safeParse({ ...kohliSix, label: "18.4" }).success).toBe(false);
  });

  it("rejects a boundary flag that disagrees with the batter's runs", () => {
    const fourButSixRuns = { ...kohliSix, boundary: 4 };
    expect(DeliveryEventSchema.safeParse(fourButSixRuns).success).toBe(false);
  });

  it("rejects player names in id fields (ids must be Cricsheet registry ids)", () => {
    expect(DeliveryEventSchema.safeParse({ ...kohliSix, batter: "V Kohli" }).success).toBe(false);
    expect(PlayerIdSchema.safeParse("ba607b88").success).toBe(true);
  });
});

describe("MatchEventSchema union", () => {
  it("routes by kind and rejects unknown kinds", () => {
    expect(MatchEventSchema.safeParse(kohliSix).success).toBe(true);
    const toss = {
      id: "1298150:0003",
      seq: 3,
      t: 600_000,
      kind: "toss",
      winner: "IND",
      decision: "field",
    };
    expect(MatchEventSchema.safeParse(toss).success).toBe(true);
    expect(MatchEventSchema.safeParse({ ...toss, kind: "rain_delay" }).success).toBe(false);
  });
});

describe("PersonaSchema squad shape", () => {
  const eleven = [
    "8a75e999",
    "2f26ac1a",
    "1777c020",
    "9c9af282",
    "24bb1c2f",
    "9de62878",
    "ba607b88",
    "dbe50b21",
    "244048f6",
    "2e81a32d",
    "919a3be2",
  ];
  const persona = {
    id: "babar-believer",
    label: "Captain Babar",
    blurb: "Test persona",
    affinity: "PAK",
    lens: "casual",
    delayMs: 25_000,
    joinAt: { kind: "pre_match" },
    squad: { playerIds: eleven, captainId: "8a75e999", viceCaptainId: "2f26ac1a" },
  };

  it("accepts eleven distinct players with captain and vice-captain inside the squad", () => {
    expect(PersonaSchema.safeParse(persona).success).toBe(true);
  });

  it("rejects a squad with a duplicated player", () => {
    const dup = {
      ...persona,
      squad: { ...persona.squad, playerIds: [...eleven.slice(0, 10), eleven[0]] },
    };
    expect(PersonaSchema.safeParse(dup).success).toBe(false);
  });

  it("rejects a captain who is not in the squad", () => {
    const outsider = { ...persona, squad: { ...persona.squad, captainId: "c13e34f4" } };
    expect(PersonaSchema.safeParse(outsider).success).toBe(false);
  });

  it("rejects the same player as captain and vice-captain", () => {
    const same = { ...persona, squad: { ...persona.squad, viceCaptainId: "8a75e999" } };
    expect(PersonaSchema.safeParse(same).success).toBe(false);
  });

  it("allows a fan with no fantasy team", () => {
    expect(PersonaSchema.safeParse({ ...persona, squad: null }).success).toBe(true);
  });
});

describe("QuestRuleSchema", () => {
  it("rejects a window whose end is before its start (unresolvable prediction)", () => {
    const backwards = {
      type: "wicket_in_window",
      innings: 1,
      fromLegalBall: 12,
      toLegalBall: 7,
    };
    expect(QuestRuleSchema.safeParse(backwards).success).toBe(false);
    expect(QuestRuleSchema.safeParse({ ...backwards, toLegalBall: 18 }).success).toBe(true);
  });
});

describe("MomentSchema", () => {
  it("accepts a spoiler nudge and rejects one with a negative latency budget", () => {
    const nudge = {
      id: "m1",
      key: "nudge:1298150:1298150:0414",
      kind: "spoiler_nudge",
      phase: "climax",
      createdAt: 11_500_000,
      revealAt: 11_500_000,
      nudgeAt: 11_494_000,
      provenance: "live",
      traceId: "t1",
      scope: "shared",
      payload: {
        eventId: "1298150:0414",
        nudge: "Eyes up. Something big is about to land on your screen.",
        reveal: "That one went the distance.",
        leverage: 0.31,
        budgetMs: 19_000,
        usedMs: 1_800,
      },
    };
    expect(MomentSchema.safeParse(nudge).success).toBe(true);
    const broken = { ...nudge, payload: { ...nudge.payload, budgetMs: -1 } };
    expect(MomentSchema.safeParse(broken).success).toBe(false);
  });
});

describe("StreamMessageSchema and ControlRequestSchema", () => {
  it("rejects an unknown stream message type", () => {
    expect(StreamMessageSchema.safeParse({ v: 1, seq: 1, type: "gossip", data: {} }).success).toBe(
      false,
    );
  });

  it("only allows the supported playback speeds", () => {
    expect(ControlRequestSchema.safeParse({ action: "speed", value: 8 }).success).toBe(true);
    expect(ControlRequestSchema.safeParse({ action: "speed", value: 7 }).success).toBe(false);
  });

  it("bounds the broadcast delay between stadium (0s) and 60s", () => {
    expect(ControlRequestSchema.safeParse({ action: "delay", ms: 25_000 }).success).toBe(true);
    expect(ControlRequestSchema.safeParse({ action: "delay", ms: 90_000 }).success).toBe(false);
  });
});
