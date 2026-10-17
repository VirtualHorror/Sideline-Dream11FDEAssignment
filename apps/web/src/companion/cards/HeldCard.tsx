/**
 * A card the fan's TV has not reached yet (Task 9): the lineup patch before the XIs are on screen, the
 * comeback quest before the wicket, the room read before the over's last ball. Like a held teaser it
 * shows that something is coming and nothing of what: empty bars under the dither veil, no names, no
 * numbers in the DOM (Flow §9).
 *
 * Callers: the Task 9 cards in this folder, while `momentVisibility` says "hidden".
 */
import type { Moment } from "@sideline/engine";
import { DitherVeil } from "../../effects/DitherVeil.tsx";

export function HeldCard({
  kind,
  note,
}: {
  kind: Moment["kind"];
  /** What the card waits for, in the fan's words ("the XIs on your stream"). */
  note: string;
}) {
  return (
    <article className="card card--held" data-kind={kind} data-visibility="hidden">
      <header className="card__head">
        <h3 className="card__title">Held for your TV</h3>
      </header>
      <div className="card__zone">
        <span className="bars" aria-hidden="true">
          <span className="bars__bar" style={{ width: "88%" }} />
          <span className="bars__bar" style={{ width: "61%" }} />
        </span>
        <DitherVeil intensity={1} />
      </div>
      <p className="card__note">{note}</p>
    </article>
  );
}
