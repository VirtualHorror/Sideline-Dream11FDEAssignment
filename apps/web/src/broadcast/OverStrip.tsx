/**
 * "This over": the current over ball by ball, extras included, as on a broadcast strip.
 * Caller: broadcast/TvPane.tsx with the state folded to the fan's TV time.
 */
import type { BallMark, MatchState } from "@sideline/engine";

function glyph(mark: BallMark): string {
  if (mark.isWicket) return "W";
  if (!mark.isLegal) return `${mark.extraKind ?? ""}${mark.runs > 1 ? mark.runs - 1 : ""}`;
  if (mark.runs === 0) return "•";
  return String(mark.runs);
}

function kind(mark: BallMark): string {
  if (mark.isWicket) return "wicket";
  if (mark.boundary === 6) return "six";
  if (mark.boundary === 4) return "four";
  if (!mark.isLegal) return "extra";
  return mark.runs === 0 ? "dot" : "runs";
}

export function OverStrip({ state }: { state: MatchState }) {
  const over = state.innings.at(-1)?.overs.at(-1);
  return (
    <div className="over-strip">
      <span className="over-strip__label">This over</span>
      <ul className="over-strip__balls" aria-label="This over">
        {(over?.balls ?? []).map((mark) => (
          <li key={mark.eventId} className="ball" data-ball={kind(mark)}>
            {glyph(mark)}
          </li>
        ))}
      </ul>
    </div>
  );
}
