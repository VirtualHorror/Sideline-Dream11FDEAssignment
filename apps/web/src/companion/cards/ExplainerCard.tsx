/**
 * "What does that mean?": a fan's question and its answer, from the glossary (rules only, no model)
 * or from the AI with what the fan's TV has shown as its facts (D-057). Related terms ask the next
 * question in one tap. Caller: companion/MomentFeed.tsx.
 */
import type { Moment } from "@sideline/engine";
import { ProvenanceChip } from "../ProvenanceChip.tsx";

type ExplainerMoment = Extract<Moment, { kind: "explainer" }>;

export function ExplainerCard({
  moment,
  onAsk,
}: {
  moment: ExplainerMoment;
  onAsk?(text: string): void;
}) {
  const { payload } = moment;
  return (
    <article className="card card--explainer" data-kind="explainer">
      <header className="card__head">
        <h3 className="card__title card__title--question">{payload.question}</h3>
        <ProvenanceChip provenance={moment.provenance} />
      </header>
      <p className="card__body">{payload.answer}</p>
      {payload.relatedTerms.length > 0 && onAsk ? (
        <div className="explainer__related">
          <span className="explainer__related-label">Related</span>
          {payload.relatedTerms.map((term) => (
            <button
              key={term}
              type="button"
              className="chip-button"
              onClick={() => onAsk(`What is ${term}?`)}
            >
              {term}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
