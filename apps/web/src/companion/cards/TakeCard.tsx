/**
 * "Stat-back my take": the fan's chat line checked against the match database. The verdict, the
 * evidence in one line, and how Sideline checked it: the SQL the model wrote and the rows the sandbox
 * returned from what the fan's TV had shown (the verdict may quote only numbers in those rows).
 *
 * Caller: companion/MomentFeed.tsx. Shown at once: the fan asked for it.
 */
import type { Moment } from "@sideline/engine";
import { RowsTable } from "../../controlplane/RowsTable.tsx";
import { ProvenanceChip } from "../ProvenanceChip.tsx";

type TakeMoment = Extract<Moment, { kind: "take_card" }>;

const VERDICTS = {
  backed: "Backed",
  busted: "Busted",
  mixed: "Mixed",
  unclear: "Unclear",
} as const;

export function TakeCard({ moment }: { moment: TakeMoment }) {
  const p = moment.payload;
  return (
    <article className="card card--take" data-kind="take_card" data-verdict={p.verdict}>
      <header className="card__head">
        <h3 className="card__title card__title--take">{p.take}</h3>
        <ProvenanceChip provenance={moment.provenance} />
      </header>
      <p className="take__verdict" data-verdict={p.verdict}>
        {VERDICTS[p.verdict]}
      </p>
      <p className="card__body">{p.statLine}</p>
      <p className="card__note">Confidence: {p.confidence}</p>
      {p.sql ? (
        <details className="take__how">
          <summary>How Sideline checked</summary>
          <pre className="take__sql">
            <code>{p.sql}</code>
          </pre>
          {p.rows ? (
            p.rows.length > 0 ? (
              <RowsTable rows={p.rows} label="What the query found" />
            ) : (
              <p className="card__note">The query found no rows.</p>
            )
          ) : (
            <p className="card__note">The query did not run.</p>
          )}
        </details>
      ) : null}
    </article>
  );
}
