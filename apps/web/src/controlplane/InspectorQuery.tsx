/**
 * The inspector (PLAN 9.2, D-073): ask about the match or Sideline's own AI calls in English and see
 * the SQL the model wrote, run on the server's read-only sandbox over what this fan's TV has shown; or
 * edit that SQL (or write your own) and run it. Every outcome is shown as it is: the rows, a refusal
 * and its reason, a query stopped at 2 s, SQLite's own error, or no query when AI is unavailable.
 *
 * Caller: controlplane/ControlPlaneDrawer.tsx (`inspect` bound to the session; `views` from
 * GET /api/inspector/views). Tests pass both in.
 */
import type { InspectorRequest, InspectorResult, InspectorView } from "@sideline/engine";
import { useId, useState } from "react";
import { ProvenanceChip } from "../companion/ProvenanceChip.tsx";
import { RowsTable } from "./RowsTable.tsx";

function statusLine(result: InspectorResult): string {
  switch (result.status) {
    case "ok":
      return `${result.rows.length === 1 ? "1 row" : `${result.rows.length} rows`}${result.truncated ? " (the first 200: there may be more)" : ""}`;
    case "refused":
      return `Refused: ${result.reason}.`;
    case "timeout":
      return `Stopped: ${result.reason}.`;
    case "error":
      return `SQLite said: ${result.reason}.`;
    case "busy":
      return `${result.reason ?? "The sandbox is busy"}.`;
    case "no_query":
      return result.reason ?? "No query was written.";
  }
}

export function InspectorQuery({
  inspect,
  views,
}: {
  inspect(request: InspectorRequest): Promise<InspectorResult>;
  views: readonly InspectorView[];
}) {
  const questionId = useId();
  const sqlId = useId();
  const [question, setQuestion] = useState("");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<InspectorResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = (request: InspectorRequest) => {
    setBusy(true);
    setProblem(null);
    inspect(request)
      .then((answer) => {
        setResult(answer);
        if (answer.sql) setSql(answer.sql);
      })
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : "The inspector did not answer."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section className="cp-section inspector" aria-label="Inspector">
      <h3 className="cp-section__title">Inspector</h3>
      <form
        className="inspector__ask"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) run({ question: question.trim() });
        }}
      >
        <label htmlFor={questionId} className="inspector__label">
          Ask about the match or Sideline's AI calls
        </label>
        <div className="inspector__row">
          <input
            id={questionId}
            className="inspector__input"
            value={question}
            maxLength={280}
            placeholder="Which skill fell back most?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit" className="button" disabled={busy || question.trim() === ""}>
            Ask
          </button>
        </div>
      </form>
      <form
        className="inspector__sql"
        onSubmit={(event) => {
          event.preventDefault();
          if (sql.trim()) run({ sql: sql.trim() });
        }}
      >
        <label htmlFor={sqlId} className="inspector__label">
          SQL
        </label>
        <textarea
          id={sqlId}
          className="inspector__textarea"
          value={sql}
          rows={4}
          maxLength={2000}
          spellCheck={false}
          placeholder="SELECT skill, outcome, count(*) AS calls FROM ai_calls GROUP BY skill, outcome"
          onChange={(event) => setSql(event.target.value)}
        />
        <button type="submit" className="button" disabled={busy || sql.trim() === ""}>
          Run SQL
        </button>
      </form>
      {problem ? (
        <p className="cp-empty" role="alert">
          {problem}
        </p>
      ) : null}
      {result ? (
        <div className="inspector__result" data-status={result.status} aria-live="polite">
          <div className="inspector__meta">
            {result.source === "ai" && result.provenance ? (
              <ProvenanceChip provenance={result.provenance} />
            ) : (
              <span className="pill">Your SQL</span>
            )}
            <p className="inspector__status">{statusLine(result)}</p>
          </div>
          {result.explanation ? (
            <p className="inspector__explanation">{result.explanation}</p>
          ) : null}
          {result.status === "ok" && result.rows.length > 0 ? (
            <RowsTable rows={result.rows} columns={result.columns} label="Query rows" />
          ) : null}
        </div>
      ) : null}
      <details className="inspector__views">
        <summary>Tables you can query</summary>
        <p className="cp-empty">
          Read-only copies made for each query: deliveries only up to your TV, and AI calls without
          anyone's session.
        </p>
        <dl>
          {views.map((view) => (
            <div key={view.view} className="inspector__view">
              <dt className="cp-code">{view.view}</dt>
              <dd>
                {view.about}
                <ul>
                  {view.columns.map((column) => (
                    <li key={column}>{column}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
