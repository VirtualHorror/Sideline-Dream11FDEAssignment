/**
 * Detector contracts: what a phase detector reads, what it may decide, and the facts a trigger
 * hands to the AI gateway.
 *
 * Callers: every detector in this folder, the gate (gate/gate.ts) that runs them on each event,
 * the server session and orchestrator (Task 5), and the AI skills that turn facts into prompts
 * (Tasks 5 and 8). Detectors are pure functions of their input: they hold no state between
 * calls, so one detector object serves every session. Anything they need from the past (an
 * earlier dismissal, the join point) they recompute from `events` and the states.
 *
 * Facts are plain data, copied out of the match state (never references into it), and carry
 * everything a prompt may use, with registry ids *and* display names. Team codes ("IND") are the
 * team identifiers here; full team names come from the match context at prompt time.
 */
import type { ChatMessage } from "../contracts/chat.ts";
import type { MatchEvent, WicketKind } from "../contracts/events.ts";
import type { Player } from "../contracts/match.ts";
import type { Persona } from "../contracts/persona.ts";
import type { InningsNumber, Lens, Role } from "../contracts/primitives.ts";
import type { FantasyRules } from "../contracts/rules.ts";
import type { MatchState } from "../contracts/state.ts";
import type { DeliveryTag } from "../cricket/describe.ts";
import type { PriorsFile } from "../models/priors.ts";
import type { WinProbModel } from "../models/winprob.ts";

/** Per-session, per-match data a detector may read. The model files are passed in as data. */
export interface DetectorContext {
  matchId: string;
  /** Both full squads (players.json), so benched players can be named too. */
  players: readonly Player[];
  rules: FantasyRules;
  persona: Persona;
  winprob: WinProbModel;
  priors: PriorsFile;
}

export interface DetectorInput {
  /** State folded through the previous event: a copy, because the reducer mutates in place. */
  before: MatchState;
  /** State folded through `event`. Detectors only read it. */
  after: MatchState;
  event: MatchEvent;
  /**
   * The match timeline (it may run past `event`). Detectors read only entries with
   * `seq <= event.seq`, so passing the whole timeline can never leak the future.
   */
  events: readonly MatchEvent[];
  ctx: DetectorContext;
  /**
   * The watch-along chat the session holds (Task 4 addition, D-045): the room detector reads the
   * messages stamped at or before `event.t`. Optional: without it, room reads stay deterministic.
   */
  chat?: readonly ChatMessage[];
}

export type DetectorVerdict =
  | { outcome: "deterministic" | "suppressed"; reason: string }
  | { outcome: "ai_trigger"; reason: string; trigger: MomentTrigger };

export interface Detector {
  /** Stable name recorded in every GateDecision ("lineup", "collapse", "nudge", "room"). */
  name: string;
  evaluate(input: DetectorInput): DetectorVerdict;
}

/**
 * What a detector asks the AI gateway for. `key` is the moment's cache key: the same key means
 * the same words for every fan. `scope: "session"` keys are personal (a squad hash); `"shared"`
 * keys are per moment or per cohort, so facts marked per-session below must stay out of the
 * shared prompt (or be rendered beside the AI text by code).
 */
export type MomentTrigger =
  | { kind: "lineup_patch"; key: string; scope: "session"; facts: LineupFacts }
  | { kind: "bailout"; key: string; scope: "shared"; facts: BailoutFacts }
  | { kind: "spoiler_nudge"; key: string; scope: "shared"; facts: NudgeFacts }
  | { kind: "catch_up"; key: string; scope: "shared"; facts: CatchUpFacts }
  | { kind: "room_read"; key: string; scope: "shared"; facts: RoomFacts };

/** A player as facts name them: the registry id plus the names a prompt or card may use. */
export interface PlayerRef {
  playerId: string;
  displayName: string;
  shortName: string;
  team: string;
  role: Role;
}

/** Where the latest innings stands, from the reducer's state. */
export interface Situation {
  innings: InningsNumber;
  battingTeam: string;
  bowlingTeam: string;
  /** "90/4" */
  score: string;
  runs: number;
  wickets: number;
  legalBalls: number;
  /** Overs bowled, scoreboard style: "14.0", "18.5". */
  overs: string;
  /** Runs the chasing side must reach; null in the first innings. */
  target: number | null;
  runsRequired: number | null;
  /** Legal balls left: of the target's balls in a chase, of a 20-over innings otherwise. */
  ballsRemaining: number;
  /** Required run rate (runs per over); null in the first innings or with no balls left. */
  rrr: number | null;
  /** Current run rate (runs per over). */
  crr: number;
}

/** A batter's line as facts quote it. */
export interface BatterFigures extends PlayerRef {
  runs: number;
  balls: number;
}

/** A bowler's line as facts quote it. */
export interface BowlerFigures extends PlayerRef {
  /** Overs bowled, scoreboard style: "3.2". */
  overs: string;
  maidens: number;
  runsConceded: number;
  wickets: number;
}

/** A sentence built by code from data, with a stable id an AI output can cite (bailout trivia). */
export interface GroundedFact {
  id: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Phase 1: lineup patch (session scope, keyed by squad hash).
// ---------------------------------------------------------------------------

export interface LineupSwap extends PlayerRef {
  credits: number;
  /** Pre-match projection from the priors file. */
  projected: number;
  /** Squad credits after this single swap. */
  creditsAfter: number;
}

export interface LineupSquadPlayer extends PlayerRef {
  credits: number;
  projected: number;
  armband: "C" | "VC" | null;
  /** In either announced XI. */
  playing: boolean;
}

export interface LineupFacts {
  matchId: string;
  squad: {
    players: LineupSquadPlayer[];
    captainId: string;
    viceCaptainId: string;
    credits: number;
    budget: number;
  };
  /** Squad players outside both XIs, in squad order, each with the best legal single swaps. */
  notPlaying: (LineupSquadPlayer & { swaps: LineupSwap[] })[];
  playingXI: { team: string; players: PlayerRef[] }[];
  toss: { winner: string; decision: "bat" | "field" } | null;
  /** The sourced pre-match notes (weather, injuries, pitch). */
  notes: { noteId: string; category: string; title: string; text: string }[];
}

// ---------------------------------------------------------------------------
// Phase 2: bailout (shared by the cohort whose captain or vice-captain this was).
// ---------------------------------------------------------------------------

export interface QuestWindow {
  innings: InningsNumber;
  /** 1-based legal balls of the innings, inclusive (QuestRule windows use the same numbering). */
  fromLegalBall: number;
  toLegalBall: number;
  fromLabel: string;
  toLabel: string;
}

export interface BailoutFacts {
  matchId: string;
  eventId: string;
  innings: InningsNumber;
  label: string;
  armband: "C" | "VC";
  dismissal: {
    batter: PlayerRef;
    runs: number;
    balls: number;
    kind: WicketKind;
    /** The bowler credited with the wicket; null for a run out. */
    bowler: PlayerRef | null;
    fielders: PlayerRef[];
    /** Scorecard style: "Babar Azam lbw b Arshdeep Singh 0 (1)". */
    scorecard: string;
    /** describeDelivery's commentary line for the ball. */
    description: string;
  };
  /**
   * Per-session (depends on the fan's whole squad): the squad's pre-match projection, and the same
   * with the dismissed player's projection replaced by the points they have so far, both with
   * captain and vice-captain multipliers. "After" assumes they add nothing more, though an
   * all-rounder may still bowl.
   */
  projection: {
    before: number;
    after: number;
    dismissedProjected: number;
    dismissedPoints: number;
    multiplier: number;
  };
  /** The comeback quest's window: the next 18 legal balls of the innings. */
  questWindow: QuestWindow;
  /** The not-out batter (the incoming one is unknown until the next ball). */
  atCrease: BatterFigures[];
  bowler: BowlerFigures;
  situation: Situation;
  /** Figures, the stand that just ended, the situation: sentences trivia may cite by id. */
  grounded: GroundedFact[];
}

// ---------------------------------------------------------------------------
// Phase 4: spoiler teaser for a big ball (shared, one per delivery).
// ---------------------------------------------------------------------------

export interface NudgeFacts {
  matchId: string;
  eventId: string;
  innings: InningsNumber;
  label: string;
  /** big_ball: leverage at or above the threshold; match_decided: the ball that ended the match. */
  why: "big_ball" | "match_decided";
  /** Everything known before the ball: the only facts a teaser may use. */
  before: {
    situation: Situation;
    striker: BatterFigures;
    nonStriker: BatterFigures;
    bowler: BowlerFigures;
    freeHit: boolean;
  };
  /** What happened. For the reveal text only: never put it in a teaser prompt. */
  outcome: {
    description: string;
    tags: DeliveryTag[];
    runs: number;
    dismissed: PlayerRef[];
    situation: Situation;
    matchOver: boolean;
  };
  /** Win probabilities are the batting side's. */
  leverage: { value: number; threshold: number; wpBefore: number; wpAfter: number; swing: number };
}

// ---------------------------------------------------------------------------
// Phase 3: catch-up reel (shared per window and lens; built by the session, not per event).
// ---------------------------------------------------------------------------

export interface CatchUpFacts {
  matchId: string;
  lens: Lens;
  /** Whole overs [fromOver, toOver) of the innings in progress at the resume point. */
  window: {
    innings: InningsNumber;
    fromOver: number;
    toOver: number;
    /** First and last delivery labels of the window, e.g. "0.1" and "13.6". */
    fromLabel: string;
    toLabel: string;
    /** Every delivery in the window: a catch-up slide may cite only these (Task 5 guard). */
    deliveryIds: string[];
  };
  /** The innings before the window's, when the window is in the chase. */
  previousInnings: {
    innings: InningsNumber;
    battingTeam: string;
    bowlingTeam: string;
    score: string;
    overs: string;
    topBatters: (BatterFigures & { out: boolean })[];
    topBowlers: BowlerFigures[];
  } | null;
  /** Team runs (extras included) and wickets of each over in the window. */
  overs: { over: number; runs: number; wickets: number; bowler: PlayerRef }[];
  /** Overs at least two population standard deviations above the window's mean. */
  anomalies: { over: number; runs: number; z: number; bowler: PlayerRef }[];
  /** The longest run of consecutive deliveries with nothing scored. */
  longestRunless: {
    balls: number;
    fromLabel: string;
    toLabel: string;
    fromEventId: string;
    toEventId: string;
  } | null;
  /** The three biggest win-probability moves in the window (batting side's view). */
  biggestSwings: {
    eventId: string;
    label: string;
    description: string;
    wpBefore: number;
    wpAfter: number;
    swing: number;
  }[];
  partnership: { batters: BatterFigures[]; runs: number; balls: number } | null;
  situation: Situation;
  winProbability: { battingTeam: string; bowlingTeam: string; pBattingTeamWins: number } | null;
  /**
   * Per-session (the persona's squad): fantasy points so far with multipliers, best first. Keep it
   * out of the shared catch-up prompt; render it beside the reel (Task 5).
   */
  squadImpact: {
    total: number;
    players: (PlayerRef & { base: number; multiplier: number; points: number })[];
  } | null;
}

// ---------------------------------------------------------------------------
// Phase 4: room read of the watch-along chat (shared, one per over).
// ---------------------------------------------------------------------------

export interface RoomFacts {
  matchId: string;
  innings: InningsNumber;
  over: number;
  /** death_over_end: an over from the 16th on just finished; chat_spike: chat ran unusually hot. */
  why: "death_over_end" | "chat_spike";
  /** The messages read: stamped in (fromT, toT]. */
  window: { fromT: number; toT: number };
  /** Messages in the window, duplicates included. */
  messageCount: number;
  /** Up to 60, deduplicated by text, most recent kept, oldest first. */
  messages: { id: string; text: string; stance: string | null; affinity: string }[];
  /** Messages per stance in the window ("none" for unlabelled ones). */
  stanceCounts: Record<string, number>;
  /** The chat rate test behind a spike (also filled for an over end). */
  rate: {
    lastMinute: number;
    meanPerMinute: number;
    sdPerMinute: number;
    threshold: number;
    minutes: number;
  };
  situation: Situation;
}
