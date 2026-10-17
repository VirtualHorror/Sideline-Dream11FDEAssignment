/**
 * Every AI attempt of this session, newest first: the skill, where the words came from (provenance),
 * the outcome and why (a fallback's detail, D-053), latency against the teaser's budget, tokens and
 * cost ("est." for a model without a built-in price). Rows about a moment the fan's TV has not shown
 * are held (controlplane/spoilerSafe.ts). Caller: controlplane/ControlPlaneDrawer.tsx.
 */
import type { AICallTrace, MatchEvent, Moment, Provenance } from "@sideline/engine";
import { ProvenanceChip } from "../companion/ProvenanceChip.tsx";
import { formatCount, formatMs, formatUsd } from "./Counters.tsx";
import { traceVisible } from "./spoilerSafe.ts";
import { TraceDetail } from "./TraceDetail.tsx";

const SKILLS: Record<string, string> = {
  spoiler_nudge: "Spoiler teaser",
  catch_up: "Catch-up reel",
  explainer: "Explainer",
};

/** What a card made from this trace says about itself, when the card is not at hand. */
export function provenanceOf(trace: AICallTrace): Provenance {
  if (trace.cache === "hit") return trace.provider === "replay" ? "replay" : "cache";
  return trace.outcome === "ok" ? "live" : "fallback";
}

function Budget({ trace }: { trace: AICallTrace }) {
  if (trace.budgetMs === null) return null;
  const share = trace.budgetMs > 0 ? Math.min(1, trace.latencyMs / trace.budgetMs) : 1;
  const late = trace.latencyMs > trace.budgetMs;
  return (
    <span className="trace__budget" data-late={late}>
      <span className="trace__budget-bar" aria-hidden="true">
        <span className="trace__budget-fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      {formatMs(trace.latencyMs)} of a {formatMs(trace.budgetMs)} budget
      {late ? ", too late to tease" : ""}
    </span>
  );
}

export function TraceList({
  traces,
  moments,
  events,
  tvT,
}: {
  traces: readonly AICallTrace[];
  moments: readonly Moment[];
  events: readonly MatchEvent[];
  tvT: number;
}) {
  const rows = [...traces].reverse();
  return (
    <section className="cp-section">
      <h3 className="cp-section__title">AI calls</h3>
      {rows.length === 0 ? (
        <p className="cp-empty">No AI work yet: every event so far was handled by rules.</p>
      ) : (
        <ul className="traces" aria-label="AI calls">
          {rows.map((trace) => {
            const skill = SKILLS[trace.skill] ?? trace.skill;
            if (!traceVisible(trace, tvT, moments, events)) {
              return (
                <li key={trace.id} className="trace" data-held="true">
                  <span className="trace__skill">{skill}</span>
                  <span className="trace__held">Held until your TV shows this moment</span>
                </li>
              );
            }
            const moment = moments.find((m) => m.traceId === trace.id);
            return (
              <li key={trace.id} className="trace">
                <div className="trace__head">
                  <span className="trace__skill">{skill}</span>
                  <ProvenanceChip provenance={moment?.provenance ?? provenanceOf(trace)} />
                  <span className="trace__outcome">{trace.outcome}</span>
                </div>
                <div className="trace__meta">
                  <span>{trace.model ?? "no model"}</span>
                  <span>
                    {formatCount(trace.tokensIn)} in, {formatCount(trace.tokensOut)} out
                  </span>
                  <span>
                    {formatUsd(trace.costUsd)}
                    {trace.costEstimated ? " est." : ""}
                  </span>
                  {trace.budgetMs === null ? <span>{formatMs(trace.latencyMs)}</span> : null}
                </div>
                <Budget trace={trace} />
                {trace.detail ? <p className="trace__detail">{trace.detail}</p> : null}
                <TraceDetail trace={trace} payload={moment?.payload ?? null} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
