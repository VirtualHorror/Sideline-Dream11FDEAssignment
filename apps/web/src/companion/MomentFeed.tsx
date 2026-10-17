/**
 * The companion's feed: every moment this session has, newest first, each kind with its own card
 * (DESIGN_SYSTEM §7) and each card deciding for itself what the fan's TV time allows it to show.
 * A question in flight sits on top as a thinking card. Lineup patches, bailouts, room reads and takes
 * get their cards in Task 9; until then such a moment is listed by name only, never dropped silently.
 *
 * Caller: pages/MatchRoom.tsx. New cards are announced politely to screen readers.
 */
import type { MatchEvent, Moment } from "@sideline/engine";
import { DitherVeil } from "../effects/DitherVeil.tsx";
import { CatchUpReel, type SquadImpact } from "./cards/CatchUpReel.tsx";
import { ExplainerCard } from "./cards/ExplainerCard.tsx";
import { SpoilerCard } from "./cards/SpoilerCard.tsx";
import { ProvenanceChip } from "./ProvenanceChip.tsx";

const LATER_KINDS: Partial<Record<Moment["kind"], string>> = {
  lineup_patch: "Lineup patch",
  bailout: "Comeback quest",
  room_read: "Room read",
  take_card: "Stat check",
};

export function MomentFeed({
  moments,
  events,
  tvT,
  delayMs,
  speed,
  impact,
  pendingQuestion,
  onAsk,
}: {
  moments: readonly Moment[];
  events: readonly MatchEvent[];
  tvT: number;
  delayMs: number;
  speed: number;
  impact: SquadImpact | null;
  pendingQuestion: string | null;
  onAsk(text: string): void;
}) {
  const labels = new Map(
    events.flatMap((e) => (e.kind === "delivery" ? [[e.id, e.label] as const] : [])),
  );
  const ordered = [...moments].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));

  return (
    <section className="feed" aria-label="Moments">
      <div className="feed__list" aria-live="polite">
        {pendingQuestion ? (
          <article className="card card--explainer" data-kind="pending">
            <header className="card__head">
              <h3 className="card__title card__title--question">{pendingQuestion}</h3>
            </header>
            <div className="card__zone card__zone--thinking">
              <p className="card__body">Thinking about what your TV has shown so far…</p>
              <DitherVeil intensity={0.3} pulse />
            </div>
          </article>
        ) : null}
        {ordered.map((moment) => {
          switch (moment.kind) {
            case "spoiler_nudge":
              return (
                <SpoilerCard
                  key={moment.id}
                  moment={moment}
                  tvT={tvT}
                  delayMs={delayMs}
                  ballLabel={labels.get(moment.payload.eventId)}
                />
              );
            case "catch_up":
              return (
                <CatchUpReel
                  key={moment.id}
                  moment={moment}
                  tvT={tvT}
                  speed={speed}
                  impact={impact}
                />
              );
            case "explainer":
              return <ExplainerCard key={moment.id} moment={moment} onAsk={onAsk} />;
            default:
              return (
                <article key={moment.id} className="card" data-kind={moment.kind}>
                  <header className="card__head">
                    <h3 className="card__title">{LATER_KINDS[moment.kind] ?? moment.kind}</h3>
                    <ProvenanceChip provenance={moment.provenance} />
                  </header>
                </article>
              );
          }
        })}
        {ordered.length === 0 && !pendingQuestion ? (
          <div className="feed__empty">
            <p className="feed__empty-title">Your companion is listening</p>
            <p>
              Big balls arrive here held for your TV, a catch-up appears if you skip ahead, and you
              can ask about anything your TV has shown.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
