/**
 * The control plane runs on the fan's TV clock too. Gate decisions and AI traces are recorded at
 * stadium time, up to a minute before the fan's picture shows the ball, and a trace's detail can quote
 * the ball's outcome (a guard rejection names "the score after the ball"). So a row about a moment
 * waits until that moment is revealed on the TV, exactly like its card.
 *
 * Callers: controlplane/GateLog.tsx and TraceList.tsx.
 */
import { type MatchEvent, type Moment, momentVisibility } from "@sideline/engine";

/** A decision is shown once the TV has reached the event it was made on. */
export const decisionVisible = (decision: { t: number }, tvT: number) => decision.t <= tvT;

/**
 * When a trace may be shown: when its moment is revealed (a card the fan has); otherwise, for a
 * teaser key (`nudge:<match>:<eventId>`), when the TV reaches that ball. Traces without either
 * (a fan's own question) are shown at once.
 */
export function traceVisible(
  trace: { id: string; momentKey: string },
  tvT: number,
  moments: readonly Moment[],
  events: readonly MatchEvent[],
): boolean {
  const moment = moments.find((m) => m.traceId === trace.id || m.key === trace.momentKey);
  if (moment) return momentVisibility(moment, tvT) === "revealed";
  const eventId = trace.momentKey.match(/^nudge:[^:]+:(.+)$/)?.[1];
  if (eventId) {
    const event = events.find((e) => e.id === eventId);
    return event ? event.t <= tvT : false;
  }
  return true;
}
