/**
 * "What would this cost at Dream11 scale?" (Architecture §6), computed from live counters only.
 *
 * Called by telemetry/collector.ts for every snapshot. The naive design calls a model once per
 * event per viewer; Sideline calls it once per shared moment key, plus once per personal moment per
 * viewer. The personal rate is the one observed so far, assumed for every viewer (no squad shared
 * with anyone else): the conservative reading. The formula string carries the substituted numbers.
 */
import type { ScaleProjection } from "@sideline/engine";

const count = (n: number) => Math.round(n).toLocaleString("en-US");

export function scaleProjection(input: {
  viewers: number;
  eventsPerMatch: number;
  sharedKeys: number;
  personalPerViewer: number;
}): ScaleProjection {
  const { viewers, eventsPerMatch, sharedKeys, personalPerViewer } = input;
  const naive = eventsPerMatch * viewers;
  const sideline = Math.round(sharedKeys + personalPerViewer * viewers);
  const savedPct = naive > 0 ? Math.min(100, Math.max(0, (1 - sideline / naive) * 100)) : 0;
  return {
    concurrentViewers: viewers,
    eventsPerMatch,
    naiveLlmCalls: naive,
    sidelineLlmCalls: sideline,
    savedPct,
    formula:
      `naive = ${count(eventsPerMatch)} events × ${count(viewers)} viewers = ${count(naive)} calls; ` +
      `Sideline = ${count(sharedKeys)} shared moment keys + ${personalPerViewer.toFixed(2)} personal moments per viewer × ${count(viewers)} viewers = ${count(sideline)} calls; ` +
      `saved = 1 − ${count(sideline)} / ${count(naive)} = ${savedPct.toFixed(4)}%`,
  };
}
