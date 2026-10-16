/** Cricsheet-to-event normalization; the server and tests call this pure builder. */
import { type DeliveryEvent, type MatchEvent, MatchEventSchema } from "../contracts/events.ts";
import {
  type MatchContextFile,
  type MatchSummary,
  MatchSummarySchema,
  type PlayersFile,
} from "../contracts/match.ts";
import type { TeamCode } from "../contracts/primitives.ts";
import { fnv1a32 } from "../util/hash.ts";
import { type CricsheetMatch, CricsheetMatchSchema } from "./cricsheet.ts";
import { DEFAULT_TIMING, type TimingModel } from "./timing.ts";

type RawDelivery = CricsheetMatch["innings"][number]["overs"][number]["deliveries"][number];
type RawWicket = NonNullable<RawDelivery["wickets"]>[number];
type MatchEventDraft = MatchEvent extends infer Event
  ? Event extends MatchEvent
    ? Omit<Event, "id" | "seq" | "t">
    : never
  : never;
type DeliveryDraft = Omit<DeliveryEvent, "id" | "seq" | "t">;

const NON_BOWLER_WICKETS = new Set([
  "run out",
  "retired hurt",
  "retired out",
  "obstructing the field",
  "handled the ball",
  "hit the ball twice",
  "timed out",
]);

function nameId(raw: CricsheetMatch, name: string): string {
  const id = raw.info.registry.people[name];
  if (!id) throw new Error(`Cricsheet name ${name} is missing from the registry`);
  return id;
}

function contextTeam(context: MatchContextFile, cricsheetName: string) {
  const team = context.teams.find((candidate) => candidate.cricsheetName === cricsheetName);
  if (!team) throw new Error(`Cricsheet team ${cricsheetName} is missing from match context`);
  return team;
}

function teamCode(context: MatchContextFile, cricsheetName: string): TeamCode {
  return contextTeam(context, cricsheetName).code;
}

function extrasOf(delivery: RawDelivery): DeliveryEvent["extras"] {
  const extras = delivery.extras ?? {};
  return {
    wides: extras.wides ?? 0,
    noballs: extras.noballs ?? 0,
    byes: extras.byes ?? 0,
    legbyes: extras.legbyes ?? 0,
    penalty: extras.penalty ?? 0,
  };
}

function wicketsOf(raw: CricsheetMatch, delivery: RawDelivery): DeliveryEvent["wickets"] {
  return (delivery.wickets ?? []).map((wicket: RawWicket) => ({
    kind: wicket.kind as DeliveryEvent["wickets"][number]["kind"],
    playerOut: nameId(raw, wicket.player_out),
    fielders: (wicket.fielders ?? []).map((fielder) => nameId(raw, fielder.name)),
    creditedToBowler: !NON_BOWLER_WICKETS.has(wicket.kind),
  }));
}

function jitter(id: string, jitterMs: number): number {
  const seconds = jitterMs / 1000;
  const slotCount = Math.floor(seconds * 2 + 1);
  if (slotCount <= 1) return 0;
  return ((fnv1a32(id) % slotCount) - seconds) * 1000;
}

function matchEvent(
  events: MatchEvent[],
  matchId: string,
  t: number,
  event: MatchEventDraft,
): MatchEvent {
  const seq = events.length;
  const parsed = MatchEventSchema.parse({
    ...event,
    id: `${matchId}:${String(seq).padStart(4, "0")}`,
    seq,
    t,
  });
  const prior = events.at(-1);
  if (prior && parsed.t < prior.t) throw new Error("timeline event time moved backwards");
  events.push(parsed);
  return parsed;
}

function inningsTotals(innings: CricsheetMatch["innings"][number]) {
  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  for (const over of innings.overs) {
    for (const delivery of over.deliveries) {
      runs += delivery.runs.total;
      const extras = extrasOf(delivery);
      if (extras.wides === 0 && extras.noballs === 0) legalBalls += 1;
      wickets += (delivery.wickets ?? []).filter((wicket) => wicket.kind !== "retired hurt").length;
    }
  }
  return { runs, wickets, legalBalls };
}

function isBoundary(delivery: RawDelivery): 0 | 4 | 6 {
  if (delivery.runs.non_boundary === true) return 0;
  return delivery.runs.batter === 4 || delivery.runs.batter === 6 ? delivery.runs.batter : 0;
}

function deliveryEvent(
  raw: CricsheetMatch,
  inningsNumber: 1 | 2,
  over: number,
  deliveryInOver: number,
  legalBallInOver: number,
  delivery: RawDelivery,
  isFreeHit: boolean,
): DeliveryDraft {
  const extras = extrasOf(delivery);
  const isLegal = extras.wides === 0 && extras.noballs === 0;
  const ballInOver = legalBallInOver + 1;
  const wickets = wicketsOf(raw, delivery);
  return {
    kind: "delivery",
    innings: inningsNumber,
    over,
    ballInOver,
    deliveryInOver,
    label: `${over}.${ballInOver}`,
    batter: nameId(raw, delivery.batter),
    nonStriker: nameId(raw, delivery.non_striker),
    bowler: nameId(raw, delivery.bowler),
    runs: delivery.runs,
    extras,
    isLegal,
    isFreeHit,
    boundary: isBoundary(delivery),
    wickets,
  };
}

function appendInningsDeliveries(
  events: MatchEvent[],
  raw: CricsheetMatch,
  matchId: string,
  inningsNumber: 1 | 2,
  firstBallAt: number,
  timing: TimingModel,
): number {
  let currentTime = firstBallAt;
  let lastDeliveryTime = firstBallAt;
  let freeHitNext = false;
  const innings = raw.innings[inningsNumber - 1];
  if (!innings) throw new Error(`missing Cricsheet innings ${inningsNumber}`);
  for (const over of innings.overs) {
    let legalBallInOver = 0;
    for (let index = 0; index < over.deliveries.length; index += 1) {
      const delivery = over.deliveries[index];
      if (!delivery) throw new Error(`missing delivery ${index + 1} in over ${over.over}`);
      const isFreeHit: boolean = freeHitNext;
      const event = deliveryEvent(
        raw,
        inningsNumber,
        over.over,
        index + 1,
        legalBallInOver,
        delivery,
        isFreeHit,
      );
      const parsed = matchEvent(events, matchId, currentTime, event);
      const actualLegal =
        (delivery.extras?.wides ?? 0) === 0 && (delivery.extras?.noballs ?? 0) === 0;
      lastDeliveryTime = currentTime;
      if (actualLegal) legalBallInOver += 1;
      const completesOver = actualLegal && legalBallInOver === 6;
      const isBoundaryBall = event.boundary > 0;
      currentTime +=
        (actualLegal ? timing.deliveryGapMs : timing.extraGapMs) +
        (isBoundaryBall ? timing.boundaryExtraMs : 0) +
        (event.wickets.length > 0 ? timing.wicketExtraMs : 0) +
        (completesOver ? timing.overEndExtraMs : 0) +
        jitter(parsed.id, timing.jitterMs);
      freeHitNext = (delivery.extras?.noballs ?? 0) > 0 || (isFreeHit && !actualLegal);
    }
  }
  return lastDeliveryTime;
}

export function buildTimeline(input: {
  raw: unknown;
  players: PlayersFile;
  context: MatchContextFile;
  timing?: TimingModel;
}): MatchEvent[] {
  const raw = CricsheetMatchSchema.parse(input.raw);
  const timing = input.timing ?? DEFAULT_TIMING;
  const matchId = input.players.matchId;
  if (input.context.matchId !== matchId) throw new Error("players and context match ids differ");
  const events: MatchEvent[] = [];

  matchEvent(events, matchId, 0, { kind: "coverage_start", matchId });
  matchEvent(events, matchId, 0, {
    kind: "squads",
    squads: input.context.teams.map((team) => ({
      team: team.code,
      playerIds: input.players.players
        .filter((player) => player.team === team.code)
        .map((player) => player.id),
    })),
  });
  input.context.notes.forEach((note, index) => {
    const t = (index + 1) * timing.noteSpacingMs;
    if (t >= timing.tossAtMs) throw new Error("a pre-match note would land at or after the toss");
    matchEvent(events, matchId, t, {
      kind: "note",
      noteId: note.id,
      category: note.category,
      title: note.title,
      text: note.text,
      sources: note.sources,
    });
  });

  matchEvent(events, matchId, timing.tossAtMs, {
    kind: "toss",
    winner: teamCode(input.context, raw.info.toss.winner),
    decision: raw.info.toss.decision,
  });
  raw.info.teams.forEach((name, index) => {
    const names = raw.info.players[name];
    if (!names) throw new Error(`Cricsheet team ${name} has no playing XI`);
    matchEvent(events, matchId, timing.tossAtMs + timing.xiAfterTossMs + index * 1000, {
      kind: "playing_xi",
      team: teamCode(input.context, name),
      playerIds: names.map((playerName) => nameId(raw, playerName)),
    });
  });

  const firstInnings = raw.innings[0];
  const secondInnings = raw.innings[1];
  if (!firstInnings || !secondInnings) throw new Error("Cricsheet match must contain two innings");
  const firstTeam = teamCode(input.context, firstInnings.team);
  const secondTeam = teamCode(input.context, secondInnings.team);
  const firstStartAt = timing.firstBallAtMs - timing.firstBallAfterInningsStartMs;
  matchEvent(events, matchId, firstStartAt, {
    kind: "innings_start",
    innings: 1,
    battingTeam: firstTeam,
    bowlingTeam: secondTeam,
    target: null,
  });
  const firstInningsEndAt =
    appendInningsDeliveries(events, raw, matchId, 1, timing.firstBallAtMs, timing) +
    timing.inningsEndAfterMs;
  const firstTotals = inningsTotals(firstInnings);
  matchEvent(events, matchId, firstInningsEndAt, {
    kind: "innings_end",
    innings: 1,
    ...firstTotals,
    reason: firstTotals.wickets >= 10 ? "all_out" : "overs_complete",
  });

  const secondStartAt = firstInningsEndAt + timing.inningsBreakMs;
  const secondTeamCode = teamCode(input.context, secondInnings.team);
  const secondBowlingTeam = input.context.teams.find((team) => team.code !== secondTeamCode)?.code;
  if (!secondBowlingTeam) throw new Error("match context must contain both teams");
  const target = secondInnings.target;
  if (!target) throw new Error("chasing innings is missing its Cricsheet target");
  matchEvent(events, matchId, secondStartAt, {
    kind: "innings_start",
    innings: 2,
    battingTeam: secondTeamCode,
    bowlingTeam: secondBowlingTeam,
    target: { runs: target.runs, balls: target.overs * 6 },
  });
  const secondInningsEndAt =
    appendInningsDeliveries(
      events,
      raw,
      matchId,
      2,
      secondStartAt + timing.firstBallAfterInningsStartMs,
      timing,
    ) + timing.inningsEndAfterMs;
  const secondTotals = inningsTotals(secondInnings);
  const result =
    secondTotals.runs >= target.runs
      ? "target_reached"
      : secondTotals.wickets >= 10
        ? "all_out"
        : "overs_complete";
  matchEvent(events, matchId, secondInningsEndAt, {
    kind: "innings_end",
    innings: 2,
    ...secondTotals,
    reason: result,
  });

  const outcome = raw.info.outcome;
  let winner: TeamCode | null = null;
  let resultText: string;
  if (outcome?.winner) {
    winner = teamCode(input.context, outcome.winner);
    const by = outcome.by;
    // A winner without a margin (an awarded match, say) reads "<team> won", never "won by …".
    const margin =
      by?.runs !== undefined
        ? ` by ${by.runs} ${by.runs === 1 ? "run" : "runs"}`
        : by?.wickets !== undefined
          ? ` by ${by.wickets} ${by.wickets === 1 ? "wicket" : "wickets"}`
          : "";
    resultText = `${contextTeam(input.context, outcome.winner).name} won${margin}`;
  } else {
    resultText = outcome?.result === "tie" ? "Match tied" : "No result";
  }
  if (outcome?.method) resultText += " (DLS method)";
  matchEvent(events, matchId, secondInningsEndAt + timing.matchEndAfterMs, {
    kind: "match_end",
    winner,
    resultText,
    playerOfMatch: (raw.info.player_of_match ?? []).map((name) => nameId(raw, name)),
  });
  return events;
}

export function buildMatchSummary(rawInput: unknown, context: MatchContextFile): MatchSummary {
  const raw = CricsheetMatchSchema.parse(rawInput);
  return MatchSummarySchema.parse({
    id: context.matchId,
    title: context.title,
    competition: context.competition,
    stage: context.stage,
    venue: raw.info.venue,
    city: raw.info.city ?? null,
    date: raw.info.dates[0],
    teams: context.teams,
  });
}
