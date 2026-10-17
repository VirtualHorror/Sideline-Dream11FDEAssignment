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
 * The ball a moment key waits for, when the key names one: a teaser's (`nudge:<match>:<eventId>`) or
 * a bailout's (`bailout:<match>:<eventId>:<C|VC>`) delivery, or a room read's over
 * (`room:<match>:<innings>:<over>`), whose last delivery so far closed it. Undefined otherwise.
 */
function awaitedEvent(key: string, events: readonly MatchEvent[]): MatchEvent | null | undefined {
  const named =
    key.match(/^nudge:[^:]+:(.+)$/)?.[1] ?? key.match(/^bailout:[^:]+:(.+):(?:C|VC)$/)?.[1];
  if (named) return events.find((e) => e.id === named) ?? null;
  const room = key.match(/^room:[^:]+:(\d+):(\d+)$/);
  if (room) {
    const [innings, over] = [Number(room[1]), Number(room[2])];
    return (
      events
        .filter((e) => e.kind === "delivery" && e.innings === innings && e.over === over)
        .at(-1) ?? null
    );
  }
  return undefined;
}

/**
 * When a trace may be shown: when its moment is revealed (a card the fan has); otherwise, for a key
 * that names a ball (a teaser, a bailout, a room read), when the TV reaches that ball. Traces without
 * either (a fan's own question, take or lineup request) are shown at once.
 */
export function traceVisible(
  trace: { id: string; momentKey: string },
  tvT: number,
  moments: readonly Moment[],
  events: readonly MatchEvent[],
): boolean {
  const moment = moments.find((m) => m.traceId === trace.id || m.key === trace.momentKey);
  if (moment) return momentVisibility(moment, tvT) === "revealed";
  const event = awaitedEvent(trace.momentKey, events);
  if (event === undefined) return true;
  return event !== null && event.t <= tvT;
}
