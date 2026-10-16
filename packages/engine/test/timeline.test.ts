import { describe, expect, it } from "vitest";
import {
  buildMatchSummary,
  buildTimeline,
  CricsheetMatchSchema,
  DEFAULT_TIMING,
  type DeliveryEvent,
  fnv1a32,
  MatchEventSchema,
} from "../src/index.ts";
import { type CricsheetRaw, loadMatch, MATCH_IDS, type RawDelivery } from "./helpers/data.ts";

const build = (id: (typeof MATCH_IDS)[number]) => {
  const match = loadMatch(id);
  return { match, events: buildTimeline(match) };
};

const deliveries = (events: ReturnType<typeof buildTimeline>) =>
  events.filter((event): event is DeliveryEvent => event.kind === "delivery");

function minimalRawWithDeliveries(
  match: CricsheetRaw,
  firstInningsDeliveries: RawDelivery[],
  secondInningsDeliveries: RawDelivery[],
): CricsheetRaw {
  const [firstTeam, secondTeam] = match.info.teams;
  if (!firstTeam || !secondTeam) throw new Error("fixture must contain two teams");
  return {
    info: match.info,
    innings: [
      { team: firstTeam, overs: [{ over: 0, deliveries: firstInningsDeliveries }] },
      {
        team: secondTeam,
        target: { runs: 5, overs: 20 },
        overs: [{ over: 0, deliveries: secondInningsDeliveries }],
      },
    ],
  };
}

describe.each(MATCH_IDS)("timeline for match %s", (id) => {
  it("builds a schema-valid, strictly ordered timeline", () => {
    const { events } = build(id);
    for (const [index, event] of events.entries()) {
      expect(MatchEventSchema.safeParse(event).success).toBe(true);
      expect(event.seq).toBe(index);
      expect(event.id).toBe(`${id}:${String(index).padStart(4, "0")}`);
      if (index > 0) expect(event.t).toBeGreaterThanOrEqual(events[index - 1]?.t ?? 0);
    }
  });

  it("emits the pre-match sequence", () => {
    const { match, events } = build(id);
    const firstDelivery = events.findIndex((event) => event.kind === "delivery");
    const kinds = events.slice(0, firstDelivery).map((event) => event.kind);
    const noteCount = id === "1298150" ? 5 : 2;
    expect(kinds).toEqual([
      "coverage_start",
      "squads",
      ...Array.from({ length: noteCount }, () => "note" as const),
      "toss",
      "playing_xi",
      "playing_xi",
      "innings_start",
    ]);
    expect(events[1]).toMatchObject({
      kind: "squads",
      squads: match.context.teams.map((team) => ({
        team: team.code,
        playerIds: match.players.players
          .filter((player) => player.team === team.code)
          .map((player) => player.id),
      })),
    });
  });

  it("counts deliveries per innings like Cricsheet", () => {
    const { events } = build(id);
    const perInnings = [1, 2].map(
      (innings) => deliveries(events).filter((event) => event.innings === innings).length,
    );
    expect(perInnings).toEqual(id === "1298150" ? [126, 125] : [127, 124]);
    expect(perInnings).toEqual(
      loadMatch(id).raw.innings.map((innings) =>
        innings.overs.reduce((sum, over) => sum + over.deliveries.length, 0),
      ),
    );
  });
});

describe("timeline cricket details", () => {
  it("uses 32-bit FNV-1a hashing", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("hello")).toBe(0x4f9f2cab);
  });

  it("uses the documented deterministic timing defaults", () => {
    expect(DEFAULT_TIMING).toEqual({
      noteSpacingMs: 60_000,
      tossAtMs: 600_000,
      xiAfterTossMs: 60_000,
      firstBallAtMs: 1_800_000,
      deliveryGapMs: 34_000,
      extraGapMs: 22_000,
      boundaryExtraMs: 18_000,
      wicketExtraMs: 50_000,
      overEndExtraMs: 55_000,
      inningsEndAfterMs: 30_000,
      inningsBreakMs: 900_000,
      firstBallAfterInningsStartMs: 60_000,
      matchEndAfterMs: 15_000,
      jitterMs: 3_000,
    });
  });

  it("allows unknown Cricsheet keys and rejects notes scheduled at the toss", () => {
    const { raw, players, context } = loadMatch("1298150");
    expect(CricsheetMatchSchema.safeParse({ ...raw, futureCricsheetField: true }).success).toBe(
      true,
    );
    expect(() =>
      buildTimeline({
        raw,
        players,
        context,
        timing: { ...DEFAULT_TIMING, noteSpacingMs: 1_000, tossAtMs: 1_000 },
      }),
    ).toThrow(/note.*toss/);
  });

  it("formats tied, no-result, singular-margin, and DLS outcomes", () => {
    const { raw, players, context } = loadMatch("1298150");
    const resultText = (outcome: CricsheetRaw["info"]["outcome"]) => {
      const synthetic = structuredClone(raw);
      synthetic.info.outcome = outcome;
      const result = buildTimeline({ raw: synthetic, players, context }).find(
        (event) => event.kind === "match_end",
      );
      return result?.kind === "match_end" ? result.resultText : undefined;
    };
    const winningTeam = context.teams[0];
    if (!winningTeam) throw new Error("missing first team");
    expect(resultText({ result: "tie" })).toBe("Match tied");
    expect(resultText({ result: "no result" })).toBe("No result");
    const displayContext = structuredClone(context);
    const winningTeamIndex = displayContext.teams.findIndex(
      (team) => team.code === winningTeam.code,
    );
    const displayTeam = displayContext.teams[winningTeamIndex];
    if (!displayTeam) throw new Error("winning team missing from context");
    displayContext.teams[winningTeamIndex] = { ...displayTeam, name: "Authored display label" };
    const synthetic = structuredClone(raw);
    synthetic.info.outcome = {
      winner: winningTeam.cricsheetName,
      by: { runs: 1 },
      method: "DLS",
    };
    const displayResult = buildTimeline({
      raw: synthetic,
      players,
      context: displayContext,
    }).find((event) => event.kind === "match_end");
    expect(displayResult?.kind === "match_end" ? displayResult.resultText : undefined).toBe(
      "Authored display label won by 1 run (DLS method)",
    );
  });

  it("labels extras with the legal ball still to come and carries free hits over a wide", () => {
    const { events } = build("1298150");
    const finalOver = deliveries(events).filter(
      (event) => event.innings === 2 && event.over === 19,
    );
    expect(finalOver.map((event) => event.label)).toEqual([
      "19.1",
      "19.2",
      "19.3",
      "19.4",
      "19.4",
      "19.4",
      "19.5",
      "19.6",
      "19.6",
    ]);
    expect(finalOver.map((event) => event.isFreeHit)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("maps delivery names to registry ids", () => {
    const first = deliveries(build("1298150").events)[0];
    expect(first).toMatchObject({ batter: "2f26ac1a", nonStriker: "8a75e999", bowler: "2e81a32d" });
  });

  it("marks boundaries, credited wickets, and run-out fielders", () => {
    const events = deliveries(build("1298150").events);
    expect(
      events.filter((event) => event.innings === 2 && ["18.5", "18.6"].includes(event.label)),
    ).toMatchObject([
      { label: "18.5", boundary: 6, batter: "ba607b88" },
      { label: "18.6", boundary: 6, batter: "ba607b88" },
    ]);
    expect(
      events.find((event) => event.innings === 1 && event.label === "1.1")?.wickets[0],
    ).toEqual({
      kind: "lbw",
      playerOut: "8a75e999",
      fielders: [],
      creditedToBowler: true,
    });
    expect(
      events.find((event) => event.innings === 2 && event.label === "6.1")?.wickets[0],
    ).toEqual({
      kind: "run out",
      playerOut: "2e171977",
      fielders: ["2f26ac1a", "8a75e999"],
      creditedToBowler: false,
    });
  });

  it("treats an all-run four as no boundary", () => {
    const { raw, players, context } = loadMatch("1298150");
    const original = raw.innings[0]?.overs[0]?.deliveries[0];
    const second = raw.innings[1]?.overs[0]?.deliveries[0];
    if (!original || !second) throw new Error("fixture has no opening delivery");
    const synthetic = minimalRawWithDeliveries(
      raw,
      [{ ...original, runs: { batter: 4, extras: 0, total: 4, non_boundary: true } }],
      [second],
    );
    const event = deliveries(buildTimeline({ raw: synthetic, players, context }))[0];
    expect(event?.boundary).toBe(0);
  });

  it("gives wickets a longer gap than dot balls after matching delivery types", () => {
    const { events } = build("1298150");
    const byOver = new Map<string, DeliveryEvent[]>();
    for (const event of deliveries(events)) {
      const key = `${event.innings}:${event.over}`;
      byOver.set(key, [...(byOver.get(key) ?? []), event]);
    }
    let comparisons = 0;
    for (const overEvents of byOver.values()) {
      const lastSeq = overEvents.at(-1)?.seq;
      const gap = (event: DeliveryEvent) => {
        const next = events[event.seq + 1];
        if (!next) throw new Error("delivery has no following event");
        return next.t - event.t;
      };
      const isLast = (event: DeliveryEvent) => event.seq === lastSeq;
      for (const wicket of overEvents.filter((event) => event.wickets.length > 0)) {
        for (const dot of overEvents.filter(
          (event) => event.runs.total === 0 && event.wickets.length === 0,
        )) {
          if (
            wicket.isLegal !== dot.isLegal ||
            wicket.boundary !== dot.boundary ||
            isLast(wicket) !== isLast(dot)
          ) {
            continue;
          }
          expect(gap(wicket) - gap(dot)).toBeGreaterThanOrEqual(50_000 - 2 * 3_000);
          comparisons += 1;
        }
      }
    }
    expect(comparisons).toBeGreaterThan(0);
  });

  it("is deterministic and fails loudly for unknown registry names", () => {
    const { raw, players, context } = loadMatch("1298150");
    expect(buildTimeline({ raw, players, context })).toEqual(
      buildTimeline({ raw, players, context }),
    );

    const unknown = structuredClone(raw);
    const firstDelivery = unknown.innings[0]?.overs[0]?.deliveries[0];
    if (!firstDelivery) throw new Error("fixture has no opening delivery");
    firstDelivery.batter = "unregistered synthetic player";
    expect(() => buildTimeline({ raw: unknown, players, context })).toThrow(/registry/);
  });

  it("summarises match metadata from Cricsheet and context", () => {
    const { raw, context } = loadMatch("1298150");
    expect(buildMatchSummary(raw, context)).toMatchObject({
      venue: "Melbourne Cricket Ground",
      city: "Melbourne",
      date: "2022-10-23",
      title: "Pakistan vs India",
      stage: "Super 12, Group 2",
    });
  });
});
