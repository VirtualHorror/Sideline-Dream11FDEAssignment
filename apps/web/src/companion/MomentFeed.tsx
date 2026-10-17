/**
 * The companion's feed: every moment this session has, newest first, each kind with its own card
 * (DESIGN_SYSTEM §7) and each card deciding for itself what the fan's TV time allows it to show.
 * A question or a take in flight sits on top as a thinking card.
 *
 * Caller: pages/MatchRoom.tsx, with what the fan's TV has shown (events, chat) for the cards that
 * settle calls or quote the chat. New cards are announced politely to screen readers.
 */
import type { ChatMessage, MatchEvent, Moment, Player } from "@sideline/engine";
import { DitherVeil } from "../effects/DitherVeil.tsx";
import { BailoutQuestCard } from "./cards/BailoutQuestCard.tsx";
import { CatchUpReel, type SquadImpact } from "./cards/CatchUpReel.tsx";
import { ExplainerCard } from "./cards/ExplainerCard.tsx";
import { RoomReadPods } from "./cards/RoomReadPods.tsx";
import { SpoilerCard } from "./cards/SpoilerCard.tsx";
import { SquadDiffLedger } from "./cards/SquadDiffLedger.tsx";
import { TakeCard } from "./cards/TakeCard.tsx";

/** The fan's lineup request (phase 1), threaded from the match room to every lineup card. */
export interface LineupRequest {
  locked: boolean;
  pending: boolean;
  error: string | null;
  send(text: string): void;
}

export function MomentFeed({
  moments,
  events,
  tvEvents = events,
  chat = [],
  players = new Map(),
  tvT,
  delayMs,
  speed,
  impact,
  pendingQuestion,
  onAsk,
  lineup,
}: {
  moments: readonly Moment[];
  events: readonly MatchEvent[];
  /** The events the fan's TV has shown: quests and polls settle on these. */
  tvEvents?: readonly MatchEvent[];
  /** The chat lines the fan's TV has shown: room reads quote these. */
  chat?: readonly ChatMessage[];
  players?: ReadonlyMap<string, Player>;
  tvT: number;
  delayMs: number;
  speed: number;
  impact: SquadImpact | null;
  pendingQuestion: string | null;
  onAsk(text: string): void;
  lineup?: LineupRequest;
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
            case "lineup_patch":
              return (
                <SquadDiffLedger
                  key={moment.id}
                  moment={moment}
                  tvT={tvT}
                  players={players}
                  locked={lineup?.locked ?? true}
                  pending={lineup?.pending ?? false}
                  error={lineup?.error ?? null}
                  onIntent={(text) => lineup?.send(text)}
                />
              );
            case "bailout":
              return (
                <BailoutQuestCard
                  key={moment.id}
                  moment={moment}
                  tvT={tvT}
                  players={players}
                  events={tvEvents}
                />
              );
            case "room_read":
              return (
                <RoomReadPods
                  key={moment.id}
                  moment={moment}
                  tvT={tvT}
                  chat={chat}
                  events={tvEvents}
                />
              );
            case "take_card":
              return <TakeCard key={moment.id} moment={moment} />;
            default:
              // Every kind has a card; a kind added to the contract without one shows nothing.
              return null;
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
