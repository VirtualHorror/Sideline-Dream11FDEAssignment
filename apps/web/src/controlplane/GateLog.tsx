/**
 * The entropy gate's recent decisions, one row per detector verdict with its reason and measured cost
 * (GateDecision, Flow §11): most rows are "deterministic", which is the point. Rows about events the
 * fan's TV has not shown yet are held back (controlplane/spoilerSafe.ts).
 * Caller: controlplane/ControlPlaneDrawer.tsx.
 */
import type { GateDecision, MatchEvent } from "@sideline/engine";
import { decisionVisible } from "./spoilerSafe.ts";

const ROWS = 40;

const EVENT_NAMES: Record<MatchEvent["kind"], string> = {
  coverage_start: "Coverage",
  squads: "Squads",
  note: "Note",
  toss: "Toss",
  playing_xi: "Playing XI",
  innings_start: "Innings start",
  delivery: "Ball",
  innings_end: "Innings end",
  match_end: "Result",
};

const OUTCOMES: Record<GateDecision["outcome"], string> = {
  deterministic: "Rules",
  ai_trigger: "AI moment",
  suppressed: "Suppressed",
};

export function GateLog({
  decisions,
  events,
  tvT,
}: {
  decisions: readonly GateDecision[];
  events: readonly MatchEvent[];
  tvT: number;
}) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const label = (eventId: string) => {
    const event = byId.get(eventId);
    if (!event) return eventId;
    return event.kind === "delivery" ? event.label : EVENT_NAMES[event.kind];
  };
  const rows = decisions
    .filter((d) => decisionVisible(d, tvT))
    .slice(-ROWS)
    .reverse();
  return (
    <section className="cp-section">
      <h3 className="cp-section__title">Gate decisions</h3>
      <div className="cp-scroll">
        <table className="cp-table" aria-label="Gate decisions">
          <thead>
            <tr>
              <th scope="col">Ball</th>
              <th scope="col">Detector</th>
              <th scope="col">Decision</th>
              <th scope="col">Reason</th>
              <th scope="col" className="cp-num">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="cp-empty">
                  Decisions appear as your TV shows each ball.
                </td>
              </tr>
            ) : (
              rows.map((d, i) => (
                <tr key={`${d.eventId}:${d.detector}:${i}`} data-outcome={d.outcome}>
                  <td className="cp-num">{label(d.eventId)}</td>
                  <td>{d.detector}</td>
                  <td>{OUTCOMES[d.outcome]}</td>
                  <td className="cp-code">{d.reason}</td>
                  <td className="cp-num">{d.costMicros} µs</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
