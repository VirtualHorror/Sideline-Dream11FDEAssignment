/**
 * Fact builders shared by the detectors: player references, the situation, batting and bowling
 * figures, legal-ball labels.
 *
 * Callers: detectors/{lineup,collapse,nudge,catchup,room}.ts. Everything returned is a new plain
 * object, never a reference into the match state: a trigger's facts must not change when the
 * session applies the next event (the reducer mutates state in place).
 */
import type { Player } from "../contracts/match.ts";
import type { InningsState, MatchState } from "../contracts/state.ts";
import { oversText, requiredRate, runRate } from "../cricket/format.ts";
import type { BatterFigures, BowlerFigures, PlayerRef, Situation } from "./types.ts";

/** A T20 innings: 20 overs of six legal balls. */
export const BALLS_PER_INNINGS = 120;
/** Ten wickets end an innings (all out). */
export const WICKETS_PER_INNINGS = 10;

export function playerIndex(players: readonly Player[]): ReadonlyMap<string, Player> {
  return new Map(players.map((player) => [player.id, player]));
}

/** Throws for an id players.json does not know: facts never invent a name. */
export function playerRef(index: ReadonlyMap<string, Player>, id: string): PlayerRef {
  const player = index.get(id);
  if (!player) throw new Error(`player ${id} is not in players.json`);
  return {
    playerId: player.id,
    displayName: player.displayName,
    shortName: player.shortName,
    team: player.team,
    role: player.role,
  };
}

/** The scoreboard label of the n-th legal ball of an innings (1-based): 1 → "0.1", 7 → "1.1". */
export function legalBallLabel(n: number): string {
  return `${Math.floor((n - 1) / 6)}.${((n - 1) % 6) + 1}`;
}

export function situationOfInnings(innings: InningsState): Situation {
  const target = innings.target;
  const runsRequired = target ? Math.max(0, target.runs - innings.runs) : null;
  const ballsRemaining = Math.max(0, (target?.balls ?? BALLS_PER_INNINGS) - innings.legalBalls);
  return {
    innings: innings.innings,
    battingTeam: innings.battingTeam,
    bowlingTeam: innings.bowlingTeam,
    score: `${innings.runs}/${innings.wickets}`,
    runs: innings.runs,
    wickets: innings.wickets,
    legalBalls: innings.legalBalls,
    overs: oversText(innings.legalBalls),
    target: target?.runs ?? null,
    runsRequired,
    ballsRemaining,
    rrr: runsRequired === null ? null : requiredRate(runsRequired, ballsRemaining),
    crr: runRate(innings.runs, innings.legalBalls),
  };
}

/** The situation of the latest innings; null before the first innings starts. */
export function situationOf(state: MatchState): Situation | null {
  const innings = state.innings.at(-1);
  return innings ? situationOfInnings(innings) : null;
}

/** A batter's runs and balls so far (zeros for a batter yet to face). */
export function batterFigures(
  index: ReadonlyMap<string, Player>,
  innings: InningsState | undefined,
  id: string,
): BatterFigures {
  const line = innings?.batters.find((batter) => batter.playerId === id);
  return { ...playerRef(index, id), runs: line?.runs ?? 0, balls: line?.balls ?? 0 };
}

/** A bowler's figures so far (zeros for a bowler yet to bowl). */
export function bowlerFigures(
  index: ReadonlyMap<string, Player>,
  innings: InningsState | undefined,
  id: string,
): BowlerFigures {
  const line = innings?.bowlers.find((bowler) => bowler.playerId === id);
  return {
    ...playerRef(index, id),
    overs: line?.oversText ?? "0.0",
    maidens: line?.maidens ?? 0,
    runsConceded: line?.runsConceded ?? 0,
    wickets: line?.wickets ?? 0,
  };
}
