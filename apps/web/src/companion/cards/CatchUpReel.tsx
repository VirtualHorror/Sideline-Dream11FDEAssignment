/**
 * Catch Me Up (phase 3): what a late fan missed, as a short reel of slides in their lens.
 *
 * Caller: companion/MomentFeed.tsx. The server makes the reel when the fan joins or skips ahead and
 * stamps it to reveal when their TV reaches the point they joined at, since the window's last balls
 * are still in their delay (D-056); until then the card pulses as "thinking". The slides cite only
 * balls in the window (the server's guard). The squad impact is computed here from the fan's own
 * folded state and squad, because a shared reel cannot carry one fan's team (Constraint 11, F05
 * follow-up 1).
 */
import { type Moment, momentVisibility } from "@sideline/engine";
import { DitherVeil } from "../../effects/DitherVeil.tsx";
import { ProvenanceChip } from "../ProvenanceChip.tsx";

type CatchUpMoment = Extract<Moment, { kind: "catch_up" }>;

export interface SquadImpact {
  total: number;
  captain: { name: string; points: number } | null;
}

const SLIDE_KINDS = {
  plot_twist: "Plot twist",
  turning_point: "Turning point",
  anomaly: "Out of the ordinary",
  watch_next: "Watch next",
} as const;

const points = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function CatchUpReel({
  moment,
  tvT,
  speed,
  impact,
}: {
  moment: CatchUpMoment;
  tvT: number;
  speed: number;
  impact: SquadImpact | null;
}) {
  const visibility = momentVisibility(moment, tvT);
  const { payload } = moment;
  if (visibility !== "revealed") {
    const seconds = Math.max(1, Math.ceil(((moment.revealAt ?? tvT) - tvT) / speed / 1000));
    return (
      <article className="card card--reel" data-kind="catch_up" data-visibility={visibility}>
        <header className="card__head">
          <h3 className="card__title">Catching you up</h3>
          <ProvenanceChip provenance={moment.provenance} />
        </header>
        <div className="card__zone card__zone--thinking">
          <p className="card__body">
            Your reel is ready when your TV reaches the moment you joined, in about {seconds} s.
          </p>
          <DitherVeil intensity={0.3} pulse />
        </div>
      </article>
    );
  }
  return (
    <article className="card card--reel" data-kind="catch_up" data-visibility="revealed">
      <header className="card__head">
        <h3 className="card__title">While you were away</h3>
        <ProvenanceChip provenance={moment.provenance} />
      </header>
      <p className="reel__window">
        {payload.innings === 1 ? "1st" : "2nd"} innings, {payload.fromLabel} to {payload.toLabel}
      </p>
      <p className="reel__situation">{payload.situation}</p>
      <ol className="reel__slides">
        {payload.slides.map((slide) => (
          <li
            key={`${slide.kind}:${slide.headline}`}
            className="reel__slide"
            data-slide={slide.kind}
          >
            <span className="reel__kind">{SLIDE_KINDS[slide.kind]}</span>
            <h4 className="reel__headline">{slide.headline}</h4>
            <p className="reel__body">{slide.body}</p>
          </li>
        ))}
      </ol>
      {impact ? (
        <p className="reel__impact">
          Your team: <strong>{points(impact.total)} points</strong> so far
          {impact.captain
            ? `, with ${impact.captain.name} (captain) on ${points(impact.captain.points)}`
            : ""}
          .
        </p>
      ) : null}
    </article>
  );
}
