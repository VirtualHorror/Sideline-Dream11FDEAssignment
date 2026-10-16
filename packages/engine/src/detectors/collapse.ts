/**
 * Phase 2 (early collapse): the fan's captain or vice-captain is out cheaply in the powerplay.
 * Their fantasy team suddenly looks dead and this is when fans close the app, so Sideline offers
 * a comeback quest for the next three overs instead.
 *
 * Callers: the gate (every event) and, through the trigger, the bailout skill (Task 8), whose
 * guard checks every prediction rule against `questWindow`; the engine later resolves those rules
 * from real deliveries (quests/resolve.ts). The detector is stateless: "one comeback quest at a
 * time" is recomputed from the events since the fan joined.
 */
import type { DeliveryEvent, MatchEvent, Wicket } from "../contracts/events.ts";
import type { FantasySquad } from "../contracts/persona.ts";
import type { InningsState, MatchState } from "../contracts/state.ts";
import { describeDelivery } from "../cricket/describe.ts";
import { round2 } from "../cricket/format.ts";
import { joinSeq } from "../cricket/join.ts";
import { fantasyPoints } from "../fantasy/scoring.ts";
import { projectedPoints, projectSquad } from "../models/priors.ts";
import {
  BALLS_PER_INNINGS,
  batterFigures,
  bowlerFigures,
  legalBallLabel,
  playerIndex,
  playerRef,
  situationOfInnings,
} from "./facts.ts";
import type { BailoutFacts, Detector, DetectorContext, GroundedFact, PlayerRef } from "./types.ts";

/** "Out cheaply": at most this many runs (PLAN Task 4). */
const CHEAP_RUNS = 10;
/** "Early": within the innings' first 36 legal balls, the six-over powerplay. */
const EARLY_BALLS = 36;
/** A comeback quest covers the next 18 legal balls (three overs). */
const QUEST_BALLS = 18;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The wicket of the fan's captain (checked first) or vice-captain on this delivery, if any. */
function armbandWicket(
  event: DeliveryEvent,
  squad: FantasySquad,
): { wicket: Wicket; armband: "C" | "VC" } | null {
  for (const [armband, id] of [
    ["C", squad.captainId],
    ["VC", squad.viceCaptainId],
  ] as const) {
    // Retired hurt is not a dismissal (DOMAIN §2): the batter may come back.
    const wicket = event.wickets.find((w) => w.playerOut === id && w.kind !== "retired hurt");
    if (wicket) return { wicket, armband };
  }
  return null;
}

/** Runs and balls of a dismissed batter; their line stops changing once they are out. */
function lineOf(innings: InningsState, id: string) {
  const line = innings.batters.find((batter) => batter.playerId === id);
  return { runs: line?.runs ?? 0, balls: line?.balls ?? 0 };
}

/**
 * The last legal ball of the comeback quest still open when `event` is bowled, or 0. Earlier
 * cheap, early armband dismissals of this innings since the fan joined are replayed in order;
 * only those that opened a quest (no quest already running) count, exactly as they were judged.
 */
function openQuestUntil(
  events: readonly MatchEvent[],
  event: DeliveryEvent,
  squad: FantasySquad,
  after: InningsState,
  joinedSeq: number,
): number {
  let questTo = 0;
  let legalBalls = 0;
  for (const earlier of events) {
    if (earlier.seq >= event.seq) break;
    if (earlier.kind !== "delivery" || earlier.innings !== event.innings) continue;
    const position = legalBalls + 1;
    if (earlier.isLegal) legalBalls += 1;
    if (earlier.seq <= joinedSeq) continue;
    const found = armbandWicket(earlier, squad);
    if (!found || position > EARLY_BALLS || position <= questTo) continue;
    if (lineOf(after, found.wicket.playerOut).runs > CHEAP_RUNS) continue;
    questTo = legalBalls + QUEST_BALLS;
  }
  return questTo;
}

/** Scorecard notation with display names: "Babar Azam lbw b Arshdeep Singh 0 (1)". */
function scorecard(
  batter: PlayerRef,
  wicket: Wicket,
  bowler: PlayerRef,
  fielders: PlayerRef[],
  runs: number,
  balls: number,
): string {
  const by = bowler.displayName;
  const fielder = fielders[0]?.displayName;
  const how = (() => {
    switch (wicket.kind) {
      case "bowled":
        return `b ${by}`;
      case "lbw":
        return `lbw b ${by}`;
      case "caught":
        return fielder ? `c ${fielder} b ${by}` : `c b ${by}`;
      case "caught and bowled":
        return `c & b ${by}`;
      case "stumped":
        return fielder ? `st ${fielder} b ${by}` : `st b ${by}`;
      case "hit wicket":
        return `hit wicket b ${by}`;
      case "run out":
        return fielders.length > 0
          ? `run out (${fielders.map((f) => f.displayName).join("/")})`
          : "run out";
      default:
        return wicket.kind;
    }
  })();
  return `${batter.displayName} ${how} ${runs} (${balls})`;
}

function bailoutFacts(
  event: DeliveryEvent,
  dismissal: { wicket: Wicket; armband: "C" | "VC" },
  squad: FantasySquad,
  before: InningsState | undefined,
  after: InningsState,
  state: MatchState,
  ctx: DetectorContext,
): BailoutFacts {
  const index = playerIndex(ctx.players);
  const outId = dismissal.wicket.playerOut;
  const batter = playerRef(index, outId);
  const { runs, balls } = lineOf(after, outId);
  const bowlerRef = playerRef(index, event.bowler);
  const fielders = dismissal.wicket.fielders.map((id) => playerRef(index, id));

  // Per-session numbers: the squad's projection, then the same with the dismissed player's
  // projection swapped for the points they have so far (they will not bat again).
  const multiplier =
    dismissal.armband === "C"
      ? ctx.rules.team.captainMultiplier
      : ctx.rules.team.viceCaptainMultiplier;
  const projectedBefore = projectSquad(squad, ctx.priors, ctx.rules).total;
  const dismissedProjected = projectedPoints(outId, ctx.priors);
  const dismissedPoints = fantasyPoints(state, ctx.players, ctx.rules).get(outId)?.total ?? 0;

  const fromLegalBall = after.legalBalls + 1;
  const lastBall = after.target?.balls ?? BALLS_PER_INNINGS;
  const toLegalBall = Math.min(fromLegalBall + QUEST_BALLS - 1, lastBall);

  // The stand that just ended: the one running before this ball, plus this ball.
  const stand = before?.partnership;
  const standIds = stand ? stand.batterIds : [event.batter, event.nonStriker];
  const standRuns = (stand?.runs ?? 0) + event.runs.total;
  const standBalls = (stand?.legalBalls ?? 0) + (event.isLegal ? 1 : 0);

  const situation = situationOfInnings(after);
  const bowler = bowlerFigures(index, after, event.bowler);
  const chase =
    situation.runsRequired !== null
      ? `, needing ${situation.runsRequired} off ${plural(situation.ballsRemaining, "ball")}`
      : "";
  const text = scorecard(batter, dismissal.wicket, bowlerRef, fielders, runs, balls);
  const grounded: GroundedFact[] = [
    { id: "dismissal", text },
    {
      id: "bowler_figures",
      text: `${bowler.displayName} has ${plural(bowler.wickets, "wicket")} for ${plural(bowler.runsConceded, "run")} in ${bowler.overs} overs`,
    },
    {
      id: "partnership",
      text: `${standIds.map((id) => playerRef(index, id).displayName).join(" and ")} added ${plural(standRuns, "run")} off ${plural(standBalls, "ball")}`,
    },
    {
      id: "situation",
      text: `${situation.battingTeam} are ${situation.score} after ${situation.overs} overs${chase}`,
    },
  ];

  return {
    matchId: ctx.matchId,
    eventId: event.id,
    innings: event.innings,
    label: event.label,
    armband: dismissal.armband,
    dismissal: {
      batter,
      runs,
      balls,
      kind: dismissal.wicket.kind,
      bowler: dismissal.wicket.creditedToBowler ? bowlerRef : null,
      fielders,
      scorecard: text,
      description: describeDelivery(event, index).text,
    },
    projection: {
      before: round2(projectedBefore),
      after: round2(
        projectedBefore - multiplier * dismissedProjected + multiplier * dismissedPoints,
      ),
      dismissedProjected,
      dismissedPoints,
      multiplier,
    },
    questWindow: {
      innings: event.innings,
      fromLegalBall,
      toLegalBall,
      fromLabel: legalBallLabel(fromLegalBall),
      toLabel: legalBallLabel(toLegalBall),
    },
    atCrease: [event.batter, event.nonStriker]
      .filter((id) => !event.wickets.some((w) => w.playerOut === id && w.kind !== "retired hurt"))
      .map((id) => batterFigures(index, after, id)),
    bowler,
    situation,
    grounded,
  };
}

export const collapseDetector: Detector = {
  name: "collapse",
  evaluate({ before, after, event, events, ctx }) {
    if (event.kind !== "delivery") return { outcome: "deterministic", reason: "not_delivery" };
    const squad = ctx.persona.squad;
    if (!squad) return { outcome: "deterministic", reason: "no_squad" };
    if (!event.wickets.some((w) => w.kind !== "retired hurt")) {
      return { outcome: "deterministic", reason: "no_wicket" };
    }
    const dismissal = armbandWicket(event, squad);
    if (!dismissal) return { outcome: "deterministic", reason: "not_armband" };

    const inningsAfter = after.innings.find((innings) => innings.innings === event.innings);
    const inningsBefore = before.innings.find((innings) => innings.innings === event.innings);
    if (!inningsAfter) throw new Error(`no innings ${event.innings} after ${event.id}`);
    if (lineOf(inningsAfter, dismissal.wicket.playerOut).runs > CHEAP_RUNS) {
      return { outcome: "deterministic", reason: "not_cheap" };
    }
    const position = (inningsBefore?.legalBalls ?? 0) + 1;
    if (position > EARLY_BALLS) return { outcome: "deterministic", reason: "not_early" };
    const joined = joinSeq(events, ctx.persona.joinAt);
    if (position <= openQuestUntil(events, event, squad, inningsAfter, joined)) {
      return { outcome: "suppressed", reason: "quest_active" };
    }
    return {
      outcome: "ai_trigger",
      reason: "armband_out_cheaply",
      trigger: {
        kind: "bailout",
        key: `bailout:${ctx.matchId}:${event.id}:${dismissal.armband}`,
        scope: "shared",
        facts: bailoutFacts(event, dismissal, squad, inningsBefore, inningsAfter, after, ctx),
      },
    };
  },
};
