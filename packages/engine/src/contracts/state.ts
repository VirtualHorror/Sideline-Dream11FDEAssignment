/**
 * Derived match state: the output of the reducer (engine/cricket/reducer.ts, Task 2).
 *
 * These are plain TS interfaces, not zod schemas: state is never parsed from the
 * wire. Server and browser each compute it with the same pure reducer from the same
 * events (state = fold(events)), which is what makes seeking and the per-fan TV
 * delay cheap. Field names here are the contract the UI renders against.
 */
import type { NoteEvent, WicketKind } from "./events.ts";
import type { InningsNumber, MatchTime, PlayerId, TeamCode } from "./primitives.ts";

/** One delivery as a scorer would mark it in the over strip / dot-matrix. */
export interface BallMark {
  eventId: string;
  label: string;
  /** Total runs off the delivery, extras included. */
  runs: number;
  isLegal: boolean;
  isWicket: boolean;
  boundary: 0 | 4 | 6;
  isFreeHit: boolean;
  /** Extras kind if any, for the glyph ("wd", "nb", "b", "lb"); null for clean deliveries. */
  extraKind: "wd" | "nb" | "b" | "lb" | "pen" | null;
}

export interface BatterLine {
  playerId: PlayerId;
  runs: number;
  /** Legal balls faced (wides do not count; no-balls do). */
  balls: number;
  fours: number;
  sixes: number;
  dots: number;
  /** Runs per 100 balls, 2 decimal places; 0 when no balls faced. */
  strikeRate: number;
  out: null | {
    kind: WicketKind;
    bowlerId: PlayerId | null;
    fielderIds: PlayerId[];
    label: string;
    eventId: string;
  };
}

export interface BowlerLine {
  playerId: PlayerId;
  legalBalls: number;
  /** Runs charged to the bowler: everything except byes, leg-byes and penalties. */
  runsConceded: number;
  wickets: number;
  maidens: number;
  dots: number;
  wides: number;
  noballs: number;
  /** Runs per over, 2 decimal places; 0 when no legal balls. */
  economy: number;
  /** Overs bowled as a scorecard string, e.g. "3.2". */
  oversText: string;
}

export interface FallOfWicket {
  wicket: number;
  runs: number;
  label: string;
  playerOut: PlayerId;
  eventId: string;
}

export interface OverSummary {
  over: number;
  bowlerId: PlayerId;
  runs: number;
  wickets: number;
  balls: BallMark[];
  /** Six legal balls, no runs charged to the bowler. */
  isMaiden: boolean;
  complete: boolean;
}

export interface Partnership {
  batterIds: [PlayerId, PlayerId];
  runs: number;
  legalBalls: number;
}

export interface InningsState {
  innings: InningsNumber;
  battingTeam: TeamCode;
  bowlingTeam: TeamCode;
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: {
    wides: number;
    noballs: number;
    byes: number;
    legbyes: number;
    penalty: number;
    total: number;
  };
  target: { runs: number; balls: number } | null;
  /** In order of appearance at the crease. */
  batters: BatterLine[];
  /** In order of first delivery bowled. */
  bowlers: BowlerLine[];
  fallOfWickets: FallOfWicket[];
  overs: OverSummary[];
  /** The current unbroken stand; null between a wicket and the next delivery. */
  partnership: Partnership | null;
  status: "in_progress" | "complete";
  endReason: "overs_complete" | "all_out" | "target_reached" | null;
}

/** "Where are we right now", recomputed after every delivery. */
export interface LiveSituation {
  innings: InningsNumber;
  /** Who faces next under strike rotation; null right after a wicket until the new batter is known. */
  strikerId: PlayerId | null;
  nonStrikerId: PlayerId | null;
  /** Bowler of the last delivery (the next over's bowler is unknown until it starts). */
  bowlerId: PlayerId | null;
  /** Label of the last delivery, "0.0" before the first ball of the innings. */
  label: string;
  currentRunRate: number;
  requiredRunRate: number | null;
  runsRequired: number | null;
  ballsRemaining: number;
  freeHitNext: boolean;
}

export type MatchPhase =
  | "pre_match"
  | "toss_done"
  | "innings_1"
  | "innings_break"
  | "innings_2"
  | "complete";

export interface MatchState {
  matchId: string;
  phase: MatchPhase;
  /** seq of the last folded event; -1 before any event. */
  lastSeq: number;
  lastT: MatchTime;
  squads: Partial<Record<TeamCode, PlayerId[]>>;
  notes: NoteEvent[];
  toss: { winner: TeamCode; decision: "bat" | "field" } | null;
  playingXI: Partial<Record<TeamCode, PlayerId[]>>;
  innings: InningsState[];
  live: LiveSituation | null;
  result: { winner: TeamCode | null; text: string; playerOfMatch: PlayerId[] } | null;
}
