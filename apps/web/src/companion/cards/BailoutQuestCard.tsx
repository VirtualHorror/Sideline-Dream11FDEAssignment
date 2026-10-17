/**
 * Bailout (phase 2): the fan's captain or vice-captain fell cheaply. A comeback quest over the next
 * three overs: yes-or-no calls the fan makes before they settle, trivia grounded in the facts, and a
 * banter card to share with their friends' league. Every call is settled by the engine's
 * `resolveQuestRule` from the deliveries the fan's TV has shown, never by the card or the model.
 * Rewards are simulated DreamBucks, kept in this card for this session.
 *
 * Caller: companion/MomentFeed.tsx with the events released on the fan's TV. Held until the TV shows
 * the wicket.
 */

import type { MatchEvent } from "@sideline/engine";
import { type Moment, momentVisibility, type Player, resolveQuestRule } from "@sideline/engine";
import { useState } from "react";
import { ProvenanceChip } from "../ProvenanceChip.tsx";
import { BanterCard } from "./BanterCard.tsx";
import { HeldCard } from "./HeldCard.tsx";

type BailoutMoment = Extract<Moment, { kind: "bailout" }>;

const points = (n: number) => n.toFixed(1);

export function BailoutQuestCard({
  moment,
  tvT,
  players,
  events,
}: {
  moment: BailoutMoment;
  tvT: number;
  players: ReadonlyMap<string, Player>;
  /** The events the fan's TV has shown: the calls settle on these. */
  events: readonly MatchEvent[];
}) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<number, number>>({});
  if (momentVisibility(moment, tvT) !== "revealed") {
    return <HeldCard kind="bailout" note="This one waits for a wicket on your stream." />;
  }
  const p = moment.payload;
  const { trigger, quest } = p;
  const name = players.get(trigger.playerId)?.displayName ?? trigger.playerId;
  const outcomes = quest.predictions.map((prediction) => resolveQuestRule(prediction.rule, events));
  // The first option is the call that the rule comes true (the server's guard holds it to two).
  const called = (index: number) => {
    const prediction = quest.predictions[index];
    const pick = prediction ? picks[prediction.id] : undefined;
    const outcome = outcomes[index];
    if (!prediction || pick === undefined || outcome === "pending") return null;
    return (pick === prediction.options[0]?.id) === (outcome === "won");
  };
  const won = quest.predictions.reduce(
    (sum, prediction, index) => sum + (called(index) ? prediction.rewardBucks : 0),
    0,
  );

  return (
    <article className="card card--quest" data-kind="bailout" data-visibility="revealed">
      <header className="card__head">
        <h3 className="card__title">Comeback quest</h3>
        <ProvenanceChip provenance={moment.provenance} />
      </header>
      <p className="quest__trigger">
        Your {trigger.role === "C" ? "captain" : "vice-captain"} {name} is out for {trigger.runs} (
        {trigger.balls}) at {trigger.label}.
      </p>
      <p className="quest__projection">
        Your team's projection: {points(p.projectedBefore)} points before,{" "}
        {points(p.projectedAfter)} now.
      </p>
      <div className="quest__ticket">
        <h4 className="quest__title">{quest.title}</h4>
        <p className="card__note">
          From {quest.windowFromLabel} to {quest.windowToLabel} on your TV. Make each call before it
          settles.
        </p>
        {quest.predictions.map((prediction, index) => {
          const outcome = outcomes[index] ?? "pending";
          const pick = picks[prediction.id];
          const right = called(index);
          const status =
            outcome === "pending"
              ? pick === undefined
                ? "Waiting for the balls on your TV."
                : "Called. Waiting for the balls on your TV."
              : right === null
                ? outcome === "won"
                  ? "It came true."
                  : "It did not happen."
                : right
                  ? `You called it: +${prediction.rewardBucks} simulated DreamBucks.`
                  : "Not this time.";
          return (
            <fieldset key={prediction.id} className="quest__call" data-outcome={outcome}>
              <legend className="quest__prompt">{prediction.prompt}</legend>
              <div className="quest__options">
                {prediction.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="chip-button"
                    aria-pressed={pick === option.id}
                    disabled={outcome !== "pending"}
                    onClick={() => setPicks((all) => ({ ...all, [prediction.id]: option.id }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="quest__status">{status}</p>
            </fieldset>
          );
        })}
        <p className="quest__tally">{won} simulated DreamBucks won</p>
      </div>
      {p.trivia.map((question, index) => {
        const answer = answers[index];
        return (
          <div key={question.question} className="quest__trivia">
            <p className="quest__prompt">{question.question}</p>
            <div className="quest__options">
              {question.options.map((option, choice) => (
                <button
                  key={option}
                  type="button"
                  className="chip-button"
                  aria-pressed={answer === choice}
                  disabled={answer !== undefined}
                  onClick={() => setAnswers((all) => ({ ...all, [index]: choice }))}
                >
                  {option}
                </button>
              ))}
            </div>
            {answer !== undefined ? (
              <p className="quest__status">
                {answer === question.answerIndex
                  ? "Right."
                  : `Not quite: ${question.options[question.answerIndex]}.`}{" "}
                {question.fact}
              </p>
            ) : null}
          </div>
        );
      })}
      <BanterCard banter={p.banter} />
    </article>
  );
}
