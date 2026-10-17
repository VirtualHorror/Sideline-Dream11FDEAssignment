/**
 * The control plane: what Sideline decided and what it cost, live (Architecture §8). Desktop docks it
 * under the match room as a one-line summary that opens into counters, the scale projection, the gate
 * log and the AI traces; on a phone it is the third tab, always open (`variant="panel"`).
 *
 * Caller: pages/MatchRoom.tsx with the session's `telemetry` message (every 5 s), the TV time, and
 * the stream's events and moments, which the gate log and traces need to stay spoiler-safe. With the
 * session's id it also opens the inspector (Task 9), which reads the views at this fan's TV time.
 */
import type { InspectorView, MatchEvent, Moment, TelemetrySnapshot } from "@sideline/engine";
import { useEffect, useId, useState } from "react";
import { api } from "../lib/api.ts";
import { Counters, formatCount, formatUsd } from "./Counters.tsx";
import { GateLog } from "./GateLog.tsx";
import { InspectorQuery } from "./InspectorQuery.tsx";
import { Projection } from "./Projection.tsx";
import { TraceList } from "./TraceList.tsx";

/** The inspector bound to one session, with the views listed once. */
function SessionInspector({ sessionId }: { sessionId: string }) {
  const [views, setViews] = useState<InspectorView[]>([]);
  useEffect(() => {
    let live = true;
    api
      .inspectorViews()
      .then((found) => live && setViews(found))
      .catch(() => live && setViews([]));
    return () => {
      live = false;
    };
  }, []);
  return <InspectorQuery inspect={(request) => api.inspect(sessionId, request)} views={views} />;
}

function summary(telemetry: TelemetrySnapshot | null): string {
  if (!telemetry) return "The first numbers arrive within a few seconds";
  const c = telemetry.counters;
  const estimated = telemetry.recentCalls.some((trace) => trace.costEstimated);
  return [
    `${formatCount(c.eventsDeterministic)} of ${formatCount(c.eventsTotal)} handled without AI`,
    `${formatCount(c.aiCallsLive)} AI calls`,
    `${formatCount(c.aiCacheHits)} cache hits`,
    `${formatCount(c.aiFallbacks)} fallbacks`,
    `${formatUsd(c.costUsd)}${estimated ? " est." : ""}`,
  ].join(", ");
}

export function ControlPlaneDrawer({
  telemetry,
  tvT,
  events,
  moments,
  defaultOpen = false,
  variant = "drawer",
  sessionId = null,
}: {
  telemetry: TelemetrySnapshot | null;
  tvT: number;
  events: readonly MatchEvent[];
  moments: readonly Moment[];
  defaultOpen?: boolean;
  variant?: "drawer" | "panel";
  sessionId?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const expanded = variant === "panel" || open;

  return (
    <section className="cp" data-variant={variant} aria-label="Control plane">
      {variant === "drawer" ? (
        <button
          type="button"
          className="cp__toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="cp__title">Control plane</span>
          <span className="cp__summary">{summary(telemetry)}</span>
          <span className="cp__chevron" aria-hidden="true" />
        </button>
      ) : (
        <header className="cp__panel-head">
          <h2 className="cp__title">Control plane</h2>
          <p className="cp__summary">{summary(telemetry)}</p>
        </header>
      )}
      {expanded ? (
        <div id={bodyId} className="cp__body">
          {telemetry ? (
            <>
              <Counters telemetry={telemetry} />
              <Projection projection={telemetry.projection} />
              <GateLog decisions={telemetry.recentDecisions} events={events} tvT={tvT} />
              <TraceList
                traces={telemetry.recentCalls}
                moments={moments}
                events={events}
                tvT={tvT}
              />
            </>
          ) : (
            <p className="cp-empty">The session sends its numbers every five seconds.</p>
          )}
          {sessionId ? <SessionInspector sessionId={sessionId} /> : null}
        </div>
      ) : null}
    </section>
  );
}
