/**
 * "When Sideline doesn't call AI", live (PLAN 9.4, Constraint 3): the server's global counters, every
 * fan's session since it started (GET /api/telemetry?scope=global), never a constant. After a story run
 * the rows count that run's events, triggers, calls, cache hits and fallbacks.
 *
 * Caller: pages/Architecture.tsx (`load` is the API's; tests pass their own).
 */
import type { TelemetrySnapshot } from "@sideline/engine";
import { useEffect, useState } from "react";
import { formatCount, formatUsd } from "../controlplane/Counters.tsx";
import { api } from "../lib/api.ts";

const share = (part: number, whole: number) =>
  whole > 0 ? ` (${((part / whole) * 100).toFixed(1)}%)` : "";

export function AiUsageTable({
  load = api.globalTelemetry,
}: {
  load?: () => Promise<TelemetrySnapshot>;
}) {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    load()
      .then((found) => live && setSnapshot(found))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [load]);

  if (failed) return <p className="notice">The live numbers did not load. Reload to try again.</p>;
  if (!snapshot) return <p className="notice">Loading the live numbers…</p>;
  const c = snapshot.counters;
  const estimated = snapshot.recentCalls.some((trace) => trace.costEstimated);
  const rows: [string, string][] = [
    [
      "Handled by rules, no AI call",
      `${formatCount(c.eventsDeterministic)} of ${formatCount(c.eventsTotal)} events${share(c.eventsDeterministic, c.eventsTotal)}`,
    ],
    ["Raised to the AI gateway, once per moment key", formatCount(c.gateTriggers)],
    ["Answered by a live model call", formatCount(c.aiCallsLive)],
    ["Served from the cache or a recording", formatCount(c.aiCacheHits)],
    ["Shown as a labelled fallback", formatCount(c.aiFallbacks)],
    [
      "Tokens the provider reported",
      `${formatCount(c.tokensIn)} in, ${formatCount(c.tokensOut)} out`,
    ],
    ["Cost", `${formatUsd(c.costUsd)}${estimated ? " est." : ""}`],
  ];
  return (
    <div className="ai-usage-live">
      <table className="cp-table" aria-label="When Sideline does not call AI, live">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="cp-num">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card__note">
        Every fan's session on this server since it started, from GET /api/telemetry?scope=global.
      </p>
    </div>
  );
}
