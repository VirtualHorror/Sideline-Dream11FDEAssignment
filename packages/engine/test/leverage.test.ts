import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildTimeline,
  CHASE_FEATURE_NAMES,
  createMatchState,
  type DeliveryEvent,
  FIRST_INNINGS_FEATURE_NAMES,
  foldEvents,
  leverage,
  type WinProbModel,
  WinProbModelSchema,
} from "../src/index.ts";
import { loadMatch, loadWinProbModel, MATCH_IDS } from "./helpers/data.ts";

type MatchId = (typeof MATCH_IDS)[number];

/** A schema-valid model with chosen weights, so expected leverage values can be worked by hand. */
function handModel(weights: { chase?: number[]; firstInnings?: number[]; swing?: number }) {
  const metrics = { brierTest: 0, logLossTest: 0, calibration: [] };
  return WinProbModelSchema.parse({
    version: "hand-checked",
    trainedOn: {
      source: "https://example.invalid/archive.zip",
      sha256: "0".repeat(64),
      retrievedAt: "2026-10-16",
      nMatches: 1,
      nTrainStates: 1,
      nTestStates: 1,
      excludedMatchIds: [],
    },
    chase: { features: [...CHASE_FEATURE_NAMES], weights: weights.chase ?? [0, 0, 0, 0, 0, 0] },
    firstInnings: {
      features: [...FIRST_INNINGS_FEATURE_NAMES],
      weights: weights.firstInnings ?? [0, 0, 0, 0, 0, 0],
    },
    metrics: { chase: metrics, firstInnings: metrics },
    leverage: {
      weights: {
        swing: weights.swing ?? 2,
        wicket: 0.15,
        six: 0.12,
        four: 0.06,
        noball: 0.08,
        freeHit: 0.04,
      },
      nudgeThreshold: 0.5,
      percentile: 0.95,
    },
  });
}

const isDelivery = (event: { kind: string }): event is DeliveryEvent => event.kind === "delivery";

/** Leverage of the last delivery matching `pick` (extras repeat labels, so the legal one is last). */
function leverageOf(id: MatchId, pick: (event: DeliveryEvent) => boolean, model: WinProbModel) {
  const events = buildTimeline(loadMatch(id));
  const event = events.filter(isDelivery).filter(pick).at(-1);
  if (!event) throw new Error(`no matching delivery in ${id}`);
  const before = foldEvents(id, events, event.seq - 1);
  const after = foldEvents(id, events, event.seq);
  return leverage({ before, after, event, model });
}

const chaseBall = (label: string, extra?: "noballs" | "wides" | "byes") => (event: DeliveryEvent) =>
  event.innings === 2 && event.label === label && (!extra || event.extras[extra] > 0);

describe("leverage formula (hand-checked models on real deliveries)", () => {
  // All-zero weights give p = 0.5 in every live state: no swing, closeness 1, so leverage is
  // exactly the delivery's spectacle score until the chase is decided.
  const flat = handModel({});

  it.each([
    ["the 18.5 six", chaseBall("18.5"), 0.12],
    ["Hardik's dismissal at 19.1", chaseBall("19.1"), 0.15],
    ["the 19.4 no-ball hit for six", chaseBall("19.4", "noballs"), 0.2],
    ["the wide on the free hit", chaseBall("19.4", "wides"), 0.04],
    ["the byes off the free hit", chaseBall("19.4", "byes"), 0.04],
    ["Karthik's stumping at 19.5", chaseBall("19.5"), 0.15],
    ["the 19.6 wide", chaseBall("19.6", "wides"), 0],
  ])("scores the spectacle of %s in 1298150", (_name, pick, value) => {
    const result = leverageOf("1298150", pick, flat);
    expect(result.value).toBeCloseTo(value, 12);
    expect(result).toMatchObject({ wpBefore: 0.5, wpAfter: 0.5, swing: 0 });
  });

  it("turns the winning single into a full swing, with no spectacle once the game is decided", () => {
    expect(leverageOf("1298150", chaseBall("19.6"), flat)).toEqual({
      value: 1,
      wpBefore: 0.5,
      wpAfter: 1,
      swing: 0.5,
    });
    // weights.swing 3 makes 3 x 0.5 = 1.5, which is clamped to 1.
    expect(leverageOf("1298150", chaseBall("19.6"), handModel({ swing: 3 })).value).toBe(1);
  });

  it("measures a wicket's swing against the batting side", () => {
    // Chase model z = 4·(wickets left / 10): India go from 6 to 5 wickets in hand at 19.1.
    const result = leverageOf(
      "1298150",
      chaseBall("19.1"),
      handModel({ chase: [0, 0, 4, 0, 0, 0] }),
    );
    expect(result.wpBefore).toBeCloseTo(0.9168273035060777, 14);
    expect(result.wpAfter).toBeCloseTo(0.8807970779778823, 14);
    expect(result.swing).toBeCloseTo(-0.03603022552819535, 14);
    expect(result.value).toBeCloseTo(0.10782132766302599, 14);
  });

  it("uses the first-innings model during the first innings", () => {
    // First-innings model z = 2·(runs / 160): Pakistan 70/2 → 76/2 with Iftikhar's six at 11.1.
    const result = leverageOf(
      "1298150",
      (event) => event.innings === 1 && event.label === "11.1",
      handModel({ firstInnings: [0, 2, 0, 0, 0, 0] }),
    );
    expect(result.wpBefore).toBeCloseTo(0.7057850278370112, 14);
    expect(result.wpAfter).toBeCloseTo(0.7211151780228631, 14);
    expect(result.swing).toBeCloseTo(0.01533015018585182, 14);
    expect(result.value).toBeCloseTo(0.0975926576462165, 14);
  });

  // D-041 / DOMAIN §2: retired hurt is not a dismissal, so it adds no wicket drama. Neither demo
  // match has one, so the delivery is a real dot ball with a synthetic wicket attached.
  it.each([
    ["retired hurt", 0],
    ["caught", 0.15],
  ] as const)("gives a %s on a dot ball a spectacle of %s", (kind, value) => {
    const events = buildTimeline(loadMatch("1298150"));
    const dot = events
      .filter(isDelivery)
      .find((e) => e.innings === 2 && e.isLegal && e.runs.total === 0 && !e.isFreeHit);
    if (!dot) throw new Error("no dot ball in the chase");
    const event: DeliveryEvent = {
      ...dot,
      wickets: [{ kind, playerOut: dot.batter, fielders: [], creditedToBowler: false }],
    };
    const before = foldEvents("1298150", events, dot.seq - 1);
    const after = structuredClone(before);
    applyEvent(after, event);
    expect(leverage({ before, after, event, model: flat }).value).toBeCloseTo(value, 12);
  });

  it("refuses states from different innings", () => {
    const events = buildTimeline(loadMatch("1298150"));
    const event = events.filter(isDelivery).find(chaseBall("0.1"));
    const lastOfFirst = events
      .filter(isDelivery)
      .filter((e) => e.innings === 1)
      .at(-1);
    if (!event || !lastOfFirst) throw new Error("fixture deliveries missing");
    expect(() =>
      leverage({
        before: foldEvents("1298150", events, lastOfFirst.seq),
        after: foldEvents("1298150", events, event.seq),
        event,
        model: flat,
      }),
    ).toThrow(/batting/);
  });
});

/** Leverage of every delivery, folding once and copying the state before each ball. */
function leverageByDelivery(id: MatchId, model: WinProbModel) {
  const events = buildTimeline(loadMatch(id));
  const state = createMatchState(id);
  const results: { event: DeliveryEvent; value: number }[] = [];
  for (const event of events) {
    if (!isDelivery(event)) {
      applyEvent(state, event);
      continue;
    }
    const before = structuredClone(state);
    applyEvent(state, event);
    results.push({ event, value: leverage({ before, after: state, event, model }).value });
  }
  return results;
}

describe("leverage threshold on the demo matches (committed model)", () => {
  it("was built with the PLAN's default weights at the 95th percentile", () => {
    const model = loadWinProbModel();
    expect(model.leverage.weights).toEqual({
      swing: 2,
      wicket: 0.15,
      six: 0.12,
      four: 0.06,
      noball: 0.08,
      freeHit: 0.04,
    });
    expect(model.leverage.percentile).toBe(0.95);
    expect(model.leverage.nudgeThreshold).toBeGreaterThan(0);
    expect(model.leverage.nudgeThreshold).toBeLessThan(1);
  });

  it.each(MATCH_IDS)("marks 2 to 20 percent of the deliveries in %s as big balls", (id) => {
    const model = loadWinProbModel();
    const values = leverageByDelivery(id, model);
    const big = values.filter(({ value }) => value >= model.leverage.nudgeThreshold).length;
    expect(big / values.length).toBeGreaterThanOrEqual(0.02);
    expect(big / values.length).toBeLessThanOrEqual(0.2);
  });

  // PLAN 3.4 as amended by D-043 (owner decision after BUG-003): the specified model scores the
  // first Rauf six (18.5) at 0.093 and the winning single at 0.019, because the 19.6 wide before it
  // already took P(India) to 0.99. The list names the balls a win-probability leverage can see.
  it("flags the 1298150 climax: the second Rauf six and every final-over twist", () => {
    const model = loadWinProbModel();
    for (const pick of [
      chaseBall("18.6"),
      chaseBall("19.1"),
      chaseBall("19.4", "noballs"),
      chaseBall("19.5"),
      chaseBall("19.6", "wides"),
    ]) {
      const result = leverageOf("1298150", pick, model);
      expect(result.value).toBeGreaterThanOrEqual(model.leverage.nudgeThreshold);
    }
  });

  it("flags Klaasen's and Miller's dismissals in 1415755", () => {
    const model = loadWinProbModel();
    for (const label of ["16.1", "19.1"]) {
      const result = leverageOf("1415755", chaseBall(label), model);
      expect(result.value).toBeGreaterThanOrEqual(model.leverage.nudgeThreshold);
    }
  });
});
