/**
 * The control plane's counters (Architecture §8): what the system decided and what it cost, straight
 * from the session's TelemetrySnapshot (every number is counted on the server, Constraint 3).
 * Caller: controlplane/ControlPlaneDrawer.tsx.
 */
import type { TelemetrySnapshot } from "@sideline/engine";

/** Four decimals below a dollar: a teaser costs fractions of a cent. */
export const formatUsd = (usd: number) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
export const formatCount = (n: number) => n.toLocaleString("en-US");
export const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

export function deterministicShare(telemetry: TelemetrySnapshot): string {
  const { eventsTotal, eventsDeterministic } = telemetry.counters;
  if (eventsTotal === 0) return "0 of 0";
  return `${formatCount(eventsDeterministic)} of ${formatCount(eventsTotal)} (${Math.round((eventsDeterministic / eventsTotal) * 100)}%)`;
}

export function Counters({ telemetry }: { telemetry: TelemetrySnapshot }) {
  const c = telemetry.counters;
  const estimated = telemetry.recentCalls.some((trace) => trace.costEstimated);
  const items: [string, string][] = [
    ["Events", formatCount(c.eventsTotal)],
    ["Handled without AI", deterministicShare(telemetry)],
    ["Moments for AI", formatCount(c.gateTriggers)],
    ["AI calls", formatCount(c.aiCallsLive)],
    ["Cache hits", formatCount(c.aiCacheHits)],
    ["Fallbacks", formatCount(c.aiFallbacks)],
    ["Tokens", `${formatCount(c.tokensIn)} in, ${formatCount(c.tokensOut)} out`],
    ["Cost", `${formatUsd(c.costUsd)}${estimated ? " est." : ""}`],
    [
      "AI latency",
      telemetry.latencyMs.p50 > 0
        ? `${formatMs(telemetry.latencyMs.p50)} median, ${formatMs(telemetry.latencyMs.p95)} p95`
        : "no calls yet",
    ],
  ];
  return (
    <section className="cp-counters" aria-label="Counters">
      <dl className="cp-counters__grid">
        {items.map(([label, value]) => (
          <div key={label} className="cp-counter">
            <dt className="cp-counter__label">{label}</dt>
            <dd className="cp-counter__value">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
