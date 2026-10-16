/**
 * Settles a prediction ("a wicket in the next three overs?") from the real deliveries.
 *
 * Callers: the bailout quest (Task 8) and the room-read poll resolve the rules an AI phrased, on
 * the server and in the browser, as events arrive. The model may word a prediction; only this code
 * decides it, from events alone, so an outcome can never be hallucinated (Architecture §1).
 *
 * Positions are 1-based legal balls of the innings (QuestRule). A wide or no-ball belongs to the
 * legal ball still to come, as its label says ("19.4 nb" is position 118 of a chase that has bowled
 * 117 legal balls). A rule resolves as soon as the outcome is certain: "15 or more off this over"
 * is won the moment the 15th run comes; "a wicket in balls 8-23" is lost once ball 23 is bowled
 * without one, or once the innings has ended.
 */
import type { DeliveryEvent, MatchEvent } from "../contracts/events.ts";
import type { QuestRule } from "../contracts/moments.ts";

export type QuestOutcome = "pending" | "won" | "lost";

interface Placed {
  delivery: DeliveryEvent;
  /** The legal ball this delivery is (or precedes): legal balls bowled before it, plus one. */
  position: number;
}

/** A team wicket: retired hurt is not one (DOMAIN §2). */
const takesWicket = (delivery: DeliveryEvent, playerId?: string) =>
  delivery.wickets.some(
    (wicket) =>
      wicket.kind !== "retired hurt" && (playerId === undefined || wicket.playerOut === playerId),
  );

function compare(op: "gte" | "lte", value: number, actual: number): boolean {
  return op === "gte" ? actual >= value : actual <= value;
}

/**
 * A count that can only grow, judged against `op value`: certain once reached (gte) or exceeded
 * (lte), and otherwise once nothing more can be added (`done`).
 */
function settle(op: "gte" | "lte", value: number, count: number, done: boolean): QuestOutcome {
  if (op === "gte" && count >= value) return "won";
  if (op === "lte" && count > value) return "lost";
  if (!done) return "pending";
  return compare(op, value, count) ? "won" : "lost";
}

export function resolveQuestRule(rule: QuestRule, events: readonly MatchEvent[]): QuestOutcome {
  const placed: Placed[] = [];
  let legalBowled = 0;
  let closed = false;
  for (const event of events) {
    if (event.kind === "innings_end" && event.innings === rule.innings) closed = true;
    if (event.kind !== "delivery" || event.innings !== rule.innings) continue;
    placed.push({ delivery: event, position: legalBowled + 1 });
    if (event.isLegal) legalBowled += 1;
  }

  switch (rule.type) {
    case "wicket_in_window":
    case "boundary_in_window": {
      const inWindow = placed.filter(
        (p) => p.position >= rule.fromLegalBall && p.position <= rule.toLegalBall,
      );
      const hit = inWindow.some(({ delivery }) =>
        rule.type === "wicket_in_window"
          ? takesWicket(delivery)
          : rule.boundary === "any"
            ? delivery.boundary !== 0
            : delivery.boundary === rule.boundary,
      );
      if (hit) return "won";
      return closed || legalBowled >= rule.toLegalBall ? "lost" : "pending";
    }
    case "dots_in_window": {
      // A dot is a legal ball with nothing off the bat (DOMAIN §2's bowler dot: byes do not
      // spoil it). The count is settled early when the balls left cannot change the answer.
      const dots = placed.filter(
        ({ delivery, position }) =>
          delivery.isLegal &&
          delivery.runs.batter === 0 &&
          position >= rule.fromLegalBall &&
          position <= rule.toLegalBall,
      ).length;
      const remaining = closed
        ? 0
        : Math.max(0, rule.toLegalBall - Math.max(rule.fromLegalBall - 1, legalBowled));
      if (rule.op === "gte" && dots + remaining < rule.value) return "lost";
      if (rule.op === "lte" && dots + remaining <= rule.value) return "won";
      return settle(rule.op, rule.value, dots, remaining === 0);
    }
    case "runs_in_over": {
      const over = placed.filter(({ delivery }) => delivery.over === rule.over);
      const runs = over.reduce((sum, { delivery }) => sum + delivery.runs.total, 0);
      const complete =
        closed || over.some(({ delivery }) => delivery.isLegal && delivery.ballInOver === 6);
      return settle(rule.op, rule.value, runs, complete);
    }
    case "batter_runs_by": {
      const upTo = placed.filter(({ position }) => position <= rule.byLegalBall);
      const runs = upTo
        .filter(({ delivery }) => delivery.batter === rule.playerId)
        .reduce((sum, { delivery }) => sum + delivery.runs.batter, 0);
      const out = upTo.some(({ delivery }) => takesWicket(delivery, rule.playerId));
      return settle(rule.op, rule.value, runs, closed || out || legalBowled >= rule.byLegalBall);
    }
  }
}
