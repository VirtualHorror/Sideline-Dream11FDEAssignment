/**
 * Where a fan's session starts in the timeline: before the first event, or right after a given
 * number of completed overs of an innings (the scoreboard reading `${afterOvers}.0`).
 *
 * Callers: the detectors (only what happens after the join point was seen live), the session's
 * starting clock and `jump` control (Task 5), and the engine tests. Positions are found from the
 * events themselves, never from a stored label or sequence number.
 */
import type { MatchEvent } from "../contracts/events.ts";
import type { JoinAt } from "../contracts/persona.ts";
import type { InningsNumber } from "../contracts/primitives.ts";

/**
 * The seq of the event after which `innings` reads `${afterOvers}.0`: its `innings_start` for 0
 * overs, else the delivery that completed over `afterOvers − 1` (the over's sixth legal ball; no
 * extra can follow it inside the same over). Throws if the innings never got that far.
 */
export function seqAfterOvers(
  events: readonly MatchEvent[],
  innings: InningsNumber,
  afterOvers: number,
): number {
  const found = events.find((event) =>
    afterOvers === 0
      ? event.kind === "innings_start" && event.innings === innings
      : event.kind === "delivery" &&
        event.innings === innings &&
        event.over === afterOvers - 1 &&
        event.isLegal &&
        event.ballInOver === 6,
  );
  if (!found) throw new Error(`innings ${innings} never reached ${afterOvers} overs`);
  return found.seq;
}

/** The last event a fan joining at `joinAt` has already missed: -1 for a pre-match fan. */
export function joinSeq(events: readonly MatchEvent[], joinAt: JoinAt): number {
  return joinAt.kind === "pre_match"
    ? -1
    : seqAfterOvers(events, joinAt.innings, joinAt.afterOvers);
}
