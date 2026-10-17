/**
 * Room Read (phase 4): the watch-along chat's last few minutes clustered into the debates that matter.
 * Each pod has its share of the room as a bar and its real lines from the chat (the server's guard
 * accepts only message ids from the window); a hot take; and a poll, which the engine settles when it
 * carries a rule. The crowd is simulated and the card says so.
 *
 * Caller: companion/MomentFeed.tsx with the chat and events the fan's TV has shown. Held until the TV
 * shows the ball that closed the over.
 */
import {
  type ChatMessage,
  type MatchEvent,
  type Moment,
  momentVisibility,
  resolveQuestRule,
} from "@sideline/engine";
import { useState } from "react";
import { ProvenanceChip } from "../ProvenanceChip.tsx";
import { HeldCard } from "./HeldCard.tsx";

type RoomMoment = Extract<Moment, { kind: "room_read" }>;

export function RoomReadPods({
  moment,
  tvT,
  chat,
  events,
}: {
  moment: RoomMoment;
  tvT: number;
  chat: readonly ChatMessage[];
  events: readonly MatchEvent[];
}) {
  const [vote, setVote] = useState<string | null>(null);
  if (momentVisibility(moment, tvT) !== "revealed") {
    return (
      <HeldCard
        kind="room_read"
        note="The room's read of this over comes with its last ball on your TV."
      />
    );
  }
  const p = moment.payload;
  const lines = new Map(chat.map((m) => [m.id, m]));
  const hot = p.hotTake ? lines.get(p.hotTake.messageId) : undefined;
  const poll = p.poll;
  const settled = poll?.rule ? resolveQuestRule(poll.rule, events) : null;
  return (
    <article className="card card--room" data-kind="room_read" data-visibility="revealed">
      <header className="card__head">
        <h3 className="card__title">Room read</h3>
        <span className="pill">Simulated crowd</span>
        <ProvenanceChip provenance={moment.provenance} />
      </header>
      <p className="room__mood">
        <span className="room__emoji" aria-hidden="true">
          {p.mood.emoji}
        </span>{" "}
        {p.mood.label}, from {p.messageCount} messages in the last five minutes
      </p>
      <div className="pods__bar" aria-hidden="true">
        {p.pods.map((pod) => (
          <span
            key={pod.id}
            className="pods__share"
            style={{ flexGrow: Math.max(1, pod.sharePct) }}
          />
        ))}
      </div>
      <ol className="pods">
        {p.pods.map((pod) => (
          <li key={pod.id} className="pod">
            <div className="pod__head">
              <h4 className="pod__title">{pod.title}</h4>
              <span className="pod__pct">{pod.sharePct}%</span>
            </div>
            <p className="pod__stance">{pod.stance}</p>
            <ul className="pod__lines">
              {pod.sampleMessageIds.flatMap((id) => {
                const line = lines.get(id);
                return line
                  ? [
                      <li key={id} className="pod__line">
                        <q>{line.text}</q> <span className="pod__handle">{line.handle}</span>
                      </li>,
                    ]
                  : [];
              })}
            </ul>
          </li>
        ))}
      </ol>
      {p.hotTake && hot ? (
        <figure className="room__hot">
          <blockquote>
            <p>{hot.text}</p>
          </blockquote>
          <figcaption>
            Hot take from {hot.handle}: {p.hotTake.why}
          </figcaption>
        </figure>
      ) : null}
      {poll ? (
        <fieldset className="room__poll" data-outcome={settled ?? "opinion"}>
          <legend className="quest__prompt">{poll.question}</legend>
          <div className="quest__options">
            {poll.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="chip-button"
                aria-pressed={vote === option.id}
                disabled={settled !== null && settled !== "pending"}
                onClick={() => setVote(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="quest__status">
            {settled === null
              ? "A poll of opinion: nothing for Sideline to settle."
              : settled === "pending"
                ? "Sideline settles this from the balls on your TV."
                : settled === "won"
                  ? `It came true${vote ? (vote === poll.options[0]?.id ? ": you called it." : ".") : "."}`
                  : `It did not happen${vote ? (vote === poll.options[1]?.id ? ": you called it." : ".") : "."}`}
          </p>
        </fieldset>
      ) : null}
    </article>
  );
}
