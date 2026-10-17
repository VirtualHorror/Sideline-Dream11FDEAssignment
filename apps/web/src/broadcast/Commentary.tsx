/**
 * Ball-by-ball commentary lines, newest first: the engine's deterministic `describeDelivery` text
 * (names from the match data), never model output. Caller: broadcast/TvPane.tsx, with the state folded
 * to the fan's TV time, so a line appears only when the TV shows its ball.
 */
import {
  type DeliveryEvent,
  describeDelivery,
  type MatchEvent,
  type MatchState,
  type Player,
} from "@sideline/engine";

const LINES = 6;

export function Commentary({
  state,
  events,
  players,
}: {
  state: MatchState;
  events: readonly MatchEvent[];
  players: ReadonlyMap<string, Player>;
}) {
  const shown: DeliveryEvent[] = [];
  for (let i = events.length - 1; i >= 0 && shown.length < LINES; i -= 1) {
    const event = events[i];
    if (event && event.seq <= state.lastSeq && event.kind === "delivery") shown.push(event);
  }
  return (
    <section className="commentary" aria-label="Commentary">
      {shown.length === 0 ? (
        <p className="commentary__empty">Ball-by-ball lines start with the first delivery.</p>
      ) : (
        <ol className="commentary__lines">
          {shown.map((event) => {
            const { text, tags } = describeDelivery(event, players);
            return (
              <li key={event.id} className="commentary__line" data-tags={tags.join(" ")}>
                {text}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
