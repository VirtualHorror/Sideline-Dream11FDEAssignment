/**
 * The innings as a scorebook dot-matrix: 20 rows of six legal balls, one cell per ball, written the
 * way a scorer writes it (a dot for a dot ball, the runs, 4, 6, W), with wides and no-balls as small
 * marks inside the cell of the legal ball they preceded (their label carries that ball's number,
 * "19.4 nb, 19.4 wd, 19.4"). DESIGN_SYSTEM §1: the stadium board and the scorebook are dot matrices.
 *
 * Caller: broadcast/TvPane.tsx with innings folded to the fan's TV time, so a cell fills only when
 * the TV shows the ball. Colour carries the cricket meaning only (six, four, wicket, dot).
 */
import type { BallMark, InningsState } from "@sideline/engine";

const OVERS = 20;
const BALLS = 6;

type BallKind = "six" | "four" | "wicket" | "dot" | "byes" | "runs" | "future";

function kindOf(mark: BallMark | undefined): BallKind {
  if (!mark) return "future";
  if (mark.isWicket) return "wicket";
  if (mark.boundary === 6) return "six";
  if (mark.boundary === 4) return "four";
  if (mark.runs === 0) return "dot";
  if (mark.extraKind === "b" || mark.extraKind === "lb") return "byes";
  return "runs";
}

const GLYPH: Record<BallKind, (mark: BallMark | undefined) => string> = {
  six: () => "6",
  four: () => "4",
  wicket: () => "W",
  dot: () => "•",
  byes: (mark) => `${mark?.runs ?? ""}`,
  runs: (mark) => `${mark?.runs ?? ""}`,
  future: () => "",
};

export function InningsDotMatrix({ innings }: { innings: InningsState }) {
  const byLabel = new Map<string, { legal?: BallMark; extras: BallMark[] }>();
  for (const over of innings.overs) {
    for (const mark of over.balls) {
      const slot = byLabel.get(mark.label) ?? { extras: [] };
      if (mark.isLegal) slot.legal = mark;
      else slot.extras.push(mark);
      byLabel.set(mark.label, slot);
    }
  }
  const sixes = innings.batters.reduce((sum, b) => sum + b.sixes, 0);
  const fours = innings.batters.reduce((sum, b) => sum + b.fours, 0);
  const summary = `${innings.innings === 1 ? "1st" : "2nd"} innings ball by ball: ${innings.runs}/${innings.wickets} from ${Math.floor(innings.legalBalls / 6)}.${innings.legalBalls % 6} overs, ${fours} fours, ${sixes} sixes`;

  return (
    <figure className="matrix" data-innings={innings.innings}>
      <figcaption className="matrix__caption">
        <span className="matrix__team">{innings.battingTeam}</span>
        <span className="matrix__score">
          {innings.runs}/{innings.wickets}
        </span>
      </figcaption>
      <div className="matrix__grid" role="img" aria-label={summary}>
        {Array.from({ length: OVERS }, (_, over) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: overs are a fixed 0-19 sequence
          <div className="matrix__row" key={over} aria-hidden="true">
            <span className="matrix__over">{over + 1}</span>
            {Array.from({ length: BALLS }, (_, i) => {
              const label = `${over}.${i + 1}`;
              const slot = byLabel.get(label);
              const kind = kindOf(slot?.legal);
              return (
                <span key={label} className="cell" data-label={label} data-ball={kind}>
                  {GLYPH[kind](slot?.legal)}
                  {slot?.extras.length ? (
                    <span className="cell__marks">
                      {slot.extras.map((extra) => (
                        <span
                          key={extra.eventId}
                          className="cell__mark"
                          data-extra={extra.extraKind ?? "x"}
                          data-boundary={extra.boundary}
                        />
                      ))}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </figure>
  );
}
