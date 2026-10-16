/**
 * Leverage: how much one delivery mattered, on a 0-1 scale.
 *
 * Callers: scripts/build-models.ts (its distribution over the test split sets
 * `leverage.nudgeThreshold`, the "big ball" line) and from Task 4 the spoiler-teaser detector,
 * which fires when a delivery's value reaches that threshold. Two ingredients, both from PLAN
 * Task 3: the win-probability swing the ball caused, and its spectacle (a wicket, a boundary, a
 * no-ball, a free hit) weighted by how close the game still is, so a six in a dead game scores
 * little and a wicket in a tight finish scores a lot. Weights live in the model file, not here.
 */
import type { DeliveryEvent } from "../contracts/events.ts";
import type { MatchState } from "../contracts/state.ts";
import { type WinProbModel, winProbability } from "./winprob.ts";

export interface Leverage {
  value: number;
  /** P(batting side wins) before and after the delivery, for the side batting on it. */
  wpBefore: number;
  wpAfter: number;
  /** wpAfter − wpBefore: positive when the ball helped the batting side. */
  swing: number;
}

/**
 * `before` and `after` are the states either side of `event` (copy the state before applying the
 * event: the reducer mutates in place). value = clamp(swing weight·|swing| + spectacle·closeness, 0, 1)
 * with closeness = 1 − |wpAfter − 0.5|·2.
 */
export function leverage(input: {
  before: MatchState;
  after: MatchState;
  event: DeliveryEvent;
  model: WinProbModel;
}): Leverage {
  const { event, model } = input;
  const before = winProbability(input.before, model);
  const after = winProbability(input.after, model);
  if (!before || !after) throw new Error(`leverage needs an innings in progress (${event.id})`);
  if (before.battingTeam !== after.battingTeam) {
    throw new Error(`leverage states have different batting sides (${event.id})`);
  }

  const weights = model.leverage.weights;
  // A retired-hurt batter is not a dismissal (DOMAIN §2), so it is not a wicket's drama either.
  const takesWicket = event.wickets.some((wicket) => wicket.kind !== "retired hurt");
  const spectacle =
    (takesWicket ? weights.wicket : 0) +
    (event.boundary === 6 ? weights.six : 0) +
    (event.boundary === 4 ? weights.four : 0) +
    (event.extras.noballs > 0 ? weights.noball : 0) +
    (event.isFreeHit ? weights.freeHit : 0);
  const swing = after.pBattingTeamWins - before.pBattingTeamWins;
  const closeness = 1 - Math.abs(after.pBattingTeamWins - 0.5) * 2;
  const value = Math.min(1, Math.max(0, weights.swing * Math.abs(swing) + spectacle * closeness));
  return { value, wpBefore: before.pBattingTeamWins, wpAfter: after.pBattingTeamWins, swing };
}
