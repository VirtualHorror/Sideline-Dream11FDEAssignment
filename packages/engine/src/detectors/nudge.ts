/**
 * Phase 4 (climax): which deliveries deserve a spoiler-free teaser on the fan's delayed stream.
 *
 * Callers: the gate (every event) and, through the trigger, the spoiler-teaser skill (Task 5),
 * which gets the server's head start (the fan's stream delay) to write a teaser that names the
 * pre-ball situation and never the result. Two rules, both from data:
 *   - a big ball: leverage at or above the model's `nudgeThreshold` (the held-out 95th percentile,
 *     D-041), never tuned per match;
 *   - the ball that decides the match (D-046, Nabhanyu): the chase reaches its target, runs out of
 *     balls or loses its tenth wicket. It is the biggest spoiler of all, yet leverage can miss it
 *     when the result was already near-certain (1298150's winning single scores 0.019, BUG-003).
 */
import type { MatchState } from "../contracts/state.ts";
import { describeDelivery } from "../cricket/describe.ts";
import { leverage } from "../models/leverage.ts";
import {
  batterFigures,
  bowlerFigures,
  playerIndex,
  playerRef,
  situationOfInnings,
  WICKETS_PER_INNINGS,
} from "./facts.ts";
import type { Detector, NudgeFacts } from "./types.ts";

/** True once the chase (the innings with a target) is over: won, all out, or out of balls. */
function chaseOver(state: MatchState): boolean {
  const chase = state.innings.find((innings) => innings.target !== null);
  if (!chase?.target) return false;
  return (
    chase.runs >= chase.target.runs ||
    chase.wickets >= WICKETS_PER_INNINGS ||
    chase.legalBalls >= chase.target.balls
  );
}

export const nudgeDetector: Detector = {
  name: "nudge",
  evaluate({ before, after, event, ctx }) {
    if (event.kind !== "delivery") return { outcome: "deterministic", reason: "not_delivery" };
    const lev = leverage({ before, after, event, model: ctx.winprob });
    const threshold = ctx.winprob.leverage.nudgeThreshold;
    // The ball that made the chase terminal: a ball after that (none in real data) decides nothing.
    const decided = chaseOver(after) && !chaseOver(before);
    if (lev.value < threshold && !decided) {
      return { outcome: "deterministic", reason: "below_threshold" };
    }
    const why = decided ? "match_decided" : "big_ball";

    const index = playerIndex(ctx.players);
    const inningsBefore = before.innings.find((innings) => innings.innings === event.innings);
    const inningsAfter = after.innings.find((innings) => innings.innings === event.innings);
    if (!inningsBefore || !inningsAfter)
      throw new Error(`no innings ${event.innings} at ${event.id}`);
    const { text, tags } = describeDelivery(event, index);
    const facts: NudgeFacts = {
      matchId: ctx.matchId,
      eventId: event.id,
      innings: event.innings,
      label: event.label,
      why,
      before: {
        situation: situationOfInnings(inningsBefore),
        striker: batterFigures(index, inningsBefore, event.batter),
        nonStriker: batterFigures(index, inningsBefore, event.nonStriker),
        bowler: bowlerFigures(index, inningsBefore, event.bowler),
        freeHit: event.isFreeHit,
      },
      outcome: {
        description: text,
        tags,
        runs: event.runs.total,
        dismissed: event.wickets
          .filter((wicket) => wicket.kind !== "retired hurt")
          .map((wicket) => playerRef(index, wicket.playerOut)),
        situation: situationOfInnings(inningsAfter),
        matchOver: decided,
      },
      leverage: {
        value: lev.value,
        threshold,
        wpBefore: lev.wpBefore,
        wpAfter: lev.wpAfter,
        swing: lev.swing,
      },
    };
    return {
      outcome: "ai_trigger",
      reason: why,
      trigger: {
        kind: "spoiler_nudge",
        key: `nudge:${ctx.matchId}:${event.id}`,
        scope: "shared",
        facts,
      },
    };
  },
};
