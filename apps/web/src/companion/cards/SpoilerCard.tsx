/**
 * Hold the Spoiler (phase 4): a big ball the fan's delayed stream has not shown yet.
 *
 * Caller: companion/MomentFeed.tsx with the TV time from the match room. The server sends the card at
 * stadium time; this component decides, with the engine's `momentVisibility`, what the fan may see at
 * their TV time (Flow §9): held (the dither veil over empty bars: neither the teaser nor the outcome
 * is in the DOM), the spoiler-free teaser from `nudgeAt`, and the scorecard reveal from `revealAt`,
 * each zone dissolving out of its veil. A teaser that was ready only after the TV passed its time
 * arrives with `nudgeAt: null` and goes straight from held to revealed (Review focus 3).
 */
import { type Moment, momentVisibility } from "@sideline/engine";
import { DitherVeil } from "../../effects/DitherVeil.tsx";
import { ProvenanceChip } from "../ProvenanceChip.tsx";

type SpoilerMoment = Extract<Moment, { kind: "spoiler_nudge" }>;

const TITLES = {
  hidden: "Held for your TV",
  teaser: "Watch your TV",
  revealed: "On your TV now",
} as const;

function Bars({ widths }: { widths: string[] }) {
  return (
    <span className="bars" aria-hidden="true">
      {widths.map((width) => (
        <span key={width} className="bars__bar" style={{ width }} />
      ))}
    </span>
  );
}

function timingNote(moment: SpoilerMoment): string {
  const { budgetMs, usedMs } = moment.payload;
  if (moment.nudgeAt === null) {
    return `Ready too late for a teaser: it took ${(usedMs / 1000).toFixed(1)} s and your TV got there first.`;
  }
  return `Teaser ready with ${(Math.max(0, budgetMs - usedMs) / 1000).toFixed(1)} s to spare before your TV.`;
}

export function SpoilerCard({
  moment,
  tvT,
  delayMs,
  ballLabel,
}: {
  moment: SpoilerMoment;
  tvT: number;
  delayMs: number;
  ballLabel?: string;
}) {
  const visibility = momentVisibility(moment, tvT);
  const { payload } = moment;
  const teased = moment.nudgeAt !== null;
  const showTeaser = visibility === "teaser" || (visibility === "revealed" && teased);

  return (
    <article
      className="card card--spoiler"
      data-kind="spoiler_nudge"
      data-visibility={visibility}
      data-ball={ballLabel}
    >
      <header className="card__head">
        <h3 className="card__title">{TITLES[visibility]}</h3>
        {ballLabel && visibility !== "hidden" ? (
          <span className="ball-tag">{ballLabel}</span>
        ) : null}
        <ProvenanceChip provenance={moment.provenance} />
      </header>
      {visibility === "revealed" && !teased ? null : (
        <div className="card__zone">
          {showTeaser ? (
            <p className="spoiler__nudge">{payload.nudge}</p>
          ) : (
            <Bars widths={["92%", "64%"]} />
          )}
          <DitherVeil intensity={visibility === "hidden" ? 1 : 0} />
        </div>
      )}
      <div className="card__zone card__zone--reveal">
        {visibility === "revealed" ? (
          <p className="spoiler__reveal">{payload.reveal}</p>
        ) : (
          <Bars widths={["78%"]} />
        )}
        <DitherVeil intensity={visibility === "revealed" ? 0 : 1} />
      </div>
      <p className="card__note">
        {visibility === "hidden"
          ? `Your stream is ${Math.round(delayMs / 1000)} s behind the ground. This one waits for your picture.`
          : visibility === "teaser"
            ? "The ball is seconds away on your stream."
            : timingNote(moment)}
      </p>
    </article>
  );
}
