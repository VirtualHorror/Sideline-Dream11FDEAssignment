/** Event reducer used by the server clock, browser replay, and engine tests. */
import type { DeliveryEvent, MatchEvent } from "../contracts/events.ts";
import type { PlayerId } from "../contracts/primitives.ts";
import type {
  BatterLine,
  BowlerLine,
  InningsState,
  MatchState,
  OverSummary,
} from "../contracts/state.ts";
import { oversText, requiredRate, round2, runRate } from "./format.ts";

function newBatter(playerId: PlayerId): BatterLine {
  return { playerId, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, strikeRate: 0, out: null };
}

function newBowler(playerId: PlayerId): BowlerLine {
  return {
    playerId,
    legalBalls: 0,
    runsConceded: 0,
    wickets: 0,
    maidens: 0,
    dots: 0,
    wides: 0,
    noballs: 0,
    economy: 0,
    oversText: "0.0",
  };
}

function batterLine(innings: InningsState, playerId: PlayerId): BatterLine {
  let line = innings.batters.find((batter) => batter.playerId === playerId);
  if (!line) {
    line = newBatter(playerId);
    innings.batters.push(line);
  }
  return line;
}

function bowlerLine(innings: InningsState, playerId: PlayerId): BowlerLine {
  let line = innings.bowlers.find((bowler) => bowler.playerId === playerId);
  if (!line) {
    line = newBowler(playerId);
    innings.bowlers.push(line);
  }
  return line;
}

function currentOver(innings: InningsState, event: DeliveryEvent): OverSummary {
  let over = innings.overs.at(-1);
  if (!over || over.over !== event.over) {
    over = {
      over: event.over,
      bowlerId: event.bowler,
      runs: 0,
      runsConceded: 0,
      wickets: 0,
      balls: [],
      isMaiden: false,
      complete: false,
    };
    innings.overs.push(over);
  }
  // An over has exactly one bowler in this contract (`OverSummary.bowlerId`), which is what makes
  // maidens exact. A bowler replaced mid-over (injury) throws instead of being merged into one
  // summary; the Task 3 archive pipeline excludes such matches with a recorded reason (BUG-002).
  if (over.bowlerId !== event.bowler)
    throw new Error(`over ${event.over} contains more than one bowler`);
  return over;
}

function extraKind(event: DeliveryEvent): OverSummary["balls"][number]["extraKind"] {
  if (event.extras.wides > 0) return "wd";
  if (event.extras.noballs > 0) return "nb";
  if (event.extras.byes > 0) return "b";
  if (event.extras.legbyes > 0) return "lb";
  if (event.extras.penalty > 0) return "pen";
  return null;
}

function updateRates(innings: InningsState): void {
  for (const batter of innings.batters) {
    batter.strikeRate = batter.balls > 0 ? round2((batter.runs * 100) / batter.balls) : 0;
  }
  for (const bowler of innings.bowlers) {
    bowler.economy =
      bowler.legalBalls > 0 ? round2((bowler.runsConceded * 6) / bowler.legalBalls) : 0;
    bowler.oversText = oversText(bowler.legalBalls);
  }
}

function updateLive(state: MatchState, innings: InningsState, event: DeliveryEvent): void {
  const target = innings.target;
  const ballsRemaining = target ? Math.max(0, target.balls - innings.legalBalls) : 0;
  const runsRequired = target ? Math.max(0, target.runs - innings.runs) : null;
  const hitWicket = event.wickets.length > 0;
  // Strike rotation (DOMAIN §1, verified on 470 demo deliveries): the batters cross when the runs
  // actually run are odd. The one-run wide or no-ball penalty is not run, so a wide adds only its
  // extra runs, and a boundary (4 or 6) is even. They swap again after the sixth legal ball. After
  // a wicket the new striker is unknown until the next delivery names the batter, so both are null.
  const runsRun =
    event.runs.batter +
    event.extras.byes +
    event.extras.legbyes +
    Math.max(event.extras.wides - 1, 0);
  let strikerId: PlayerId | null = hitWicket ? null : event.batter;
  let nonStrikerId: PlayerId | null = hitWicket ? null : event.nonStriker;
  if (!hitWicket) {
    if (runsRun % 2 === 1) [strikerId, nonStrikerId] = [nonStrikerId, strikerId];
    if (event.isLegal && event.ballInOver === 6)
      [strikerId, nonStrikerId] = [nonStrikerId, strikerId];
  }
  state.live = {
    innings: event.innings,
    strikerId,
    nonStrikerId,
    bowlerId: event.bowler,
    label: event.label,
    currentRunRate: runRate(innings.runs, innings.legalBalls),
    requiredRunRate:
      target && runsRequired !== null ? requiredRate(runsRequired, ballsRemaining) : null,
    runsRequired,
    ballsRemaining,
    freeHitNext: event.extras.noballs > 0 || (event.isFreeHit && !event.isLegal),
  };
}

function applyDelivery(state: MatchState, event: DeliveryEvent): void {
  const innings = state.innings.find((candidate) => candidate.innings === event.innings);
  if (innings?.status !== "in_progress") {
    throw new Error(`delivery for inactive innings ${event.innings}`);
  }

  const batter = batterLine(innings, event.batter);
  batterLine(innings, event.nonStriker);
  const bowler = bowlerLine(innings, event.bowler);
  const over = currentOver(innings, event);

  innings.runs += event.runs.total;
  innings.extras.total += event.runs.extras;
  innings.extras.wides += event.extras.wides;
  innings.extras.noballs += event.extras.noballs;
  innings.extras.byes += event.extras.byes;
  innings.extras.legbyes += event.extras.legbyes;
  innings.extras.penalty += event.extras.penalty;

  batter.runs += event.runs.batter;
  if (event.extras.wides === 0) {
    batter.balls += 1;
    if (event.runs.batter === 0) batter.dots += 1;
  }
  if (event.boundary === 4) batter.fours += 1;
  if (event.boundary === 6) batter.sixes += 1;

  const conceded =
    event.runs.total - event.extras.byes - event.extras.legbyes - event.extras.penalty;
  bowler.runsConceded += conceded;
  bowler.wides += event.extras.wides;
  bowler.noballs += event.extras.noballs;
  if (event.isLegal) {
    bowler.legalBalls += 1;
    innings.legalBalls += 1;
    if (event.runs.batter === 0) bowler.dots += 1;
  }

  over.runs += event.runs.total;
  over.runsConceded += conceded;
  over.balls.push({
    eventId: event.id,
    label: event.label,
    runs: event.runs.total,
    isLegal: event.isLegal,
    isWicket: event.wickets.length > 0,
    boundary: event.boundary,
    isFreeHit: event.isFreeHit,
    extraKind: extraKind(event),
  });

  for (const wicket of event.wickets) {
    const dismissed = batterLine(innings, wicket.playerOut);
    dismissed.out = {
      kind: wicket.kind,
      bowlerId: wicket.creditedToBowler ? event.bowler : null,
      fielderIds: [...wicket.fielders],
      label: event.label,
      eventId: event.id,
    };
    if (wicket.kind !== "retired hurt") {
      innings.wickets += 1;
      if (wicket.creditedToBowler) bowler.wickets += 1;
    }
    innings.fallOfWickets.push({
      wicket: innings.wickets,
      runs: innings.runs,
      label: event.label,
      playerOut: wicket.playerOut,
      eventId: event.id,
    });
    over.wickets += wicket.kind === "retired hurt" ? 0 : 1;
  }

  if (event.wickets.length > 0) {
    innings.partnership = null;
  } else {
    if (!innings.partnership) {
      innings.partnership = { batterIds: [event.batter, event.nonStriker], runs: 0, legalBalls: 0 };
    }
    innings.partnership.runs += event.runs.total;
    if (event.isLegal) innings.partnership.legalBalls += 1;
  }

  if (event.isLegal && event.ballInOver === 6) {
    over.complete = true;
    if (over.runsConceded === 0) {
      over.isMaiden = true;
      bowlerLine(innings, over.bowlerId).maidens += 1;
    }
  }
  updateRates(innings);
  updateLive(state, innings, event);
}

export function createMatchState(matchId: string): MatchState {
  return {
    matchId,
    phase: "pre_match",
    lastSeq: -1,
    lastT: 0,
    squads: {},
    notes: [],
    toss: null,
    playingXI: {},
    innings: [],
    live: null,
    result: null,
  };
}

export function applyEvent(state: MatchState, event: MatchEvent): void {
  if (event.seq !== state.lastSeq + 1) {
    throw new Error(`event sequence ${event.seq} does not follow ${state.lastSeq}`);
  }

  switch (event.kind) {
    case "coverage_start":
      state.matchId = event.matchId;
      break;
    case "squads":
      for (const squad of event.squads) state.squads[squad.team] = [...squad.playerIds];
      break;
    case "note":
      state.notes.push(event);
      break;
    case "toss":
      state.toss = { winner: event.winner, decision: event.decision };
      state.phase = "toss_done";
      break;
    case "playing_xi":
      state.playingXI[event.team] = [...event.playerIds];
      break;
    case "innings_start": {
      const innings: InningsState = {
        innings: event.innings,
        battingTeam: event.battingTeam,
        bowlingTeam: event.bowlingTeam,
        runs: 0,
        wickets: 0,
        legalBalls: 0,
        extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0, penalty: 0, total: 0 },
        target: event.target,
        batters: [],
        bowlers: [],
        fallOfWickets: [],
        overs: [],
        partnership: null,
        status: "in_progress",
        endReason: null,
      };
      state.innings.push(innings);
      state.phase = event.innings === 1 ? "innings_1" : "innings_2";
      state.live = {
        innings: event.innings,
        strikerId: null,
        nonStrikerId: null,
        bowlerId: null,
        label: "0.0",
        currentRunRate: 0,
        requiredRunRate: event.target ? requiredRate(event.target.runs, event.target.balls) : null,
        runsRequired: event.target?.runs ?? null,
        ballsRemaining: event.target?.balls ?? 0,
        freeHitNext: false,
      };
      break;
    }
    case "delivery":
      applyDelivery(state, event);
      break;
    case "innings_end": {
      const innings = state.innings.find((candidate) => candidate.innings === event.innings);
      if (!innings) throw new Error(`end for unknown innings ${event.innings}`);
      innings.status = "complete";
      innings.endReason = event.reason;
      if (event.innings === 1) state.phase = "innings_break";
      break;
    }
    case "match_end":
      state.result = {
        winner: event.winner,
        text: event.resultText,
        playerOfMatch: [...event.playerOfMatch],
      };
      state.phase = "complete";
      break;
  }

  state.lastSeq = event.seq;
  state.lastT = event.t;
}

export function foldEvents(
  matchId: string,
  events: readonly MatchEvent[],
  uptoSeq = Number.POSITIVE_INFINITY,
): MatchState {
  const state = createMatchState(matchId);
  for (const event of events) {
    if (event.seq > uptoSeq) break;
    applyEvent(state, event);
  }
  return state;
}
