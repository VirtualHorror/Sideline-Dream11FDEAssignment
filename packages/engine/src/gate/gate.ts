/**
 * The entropy gate: runs every detector on every event and decides which events need AI at all.
 *
 * Callers: the server session's tick loop (Task 5), once per released event, with one gate per
 * session; the control plane renders its decisions and counters (Task 6). Most events are
 * routine, so most verdicts are "deterministic" and cost no model call; only `ai_trigger`
 * verdicts become MomentTriggers for the orchestrator. That ratio is Sideline's first design
 * thesis, and these counters are what prove it (Architecture §1, §6).
 *
 * The gate owns the only per-session memory in this pipeline: its counters and the moment keys
 * it has already asked for. A second trigger for a key this session already has (the room read
 * of an over that spiked mid-over and then ended) is recorded as `suppressed: duplicate_key`.
 * A detector that throws is a bug and is not swallowed here.
 */
import type { GateDecision } from "../contracts/telemetry.ts";
import type {
  Detector,
  DetectorInput,
  DetectorVerdict,
  MomentTrigger,
} from "../detectors/types.ts";

export interface GateCounters {
  /** Events processed. */
  eventsTotal: number;
  /** Events for which no detector triggered (suppressed verdicts count as handled). */
  eventsDeterministic: number;
  /** Triggers handed on: at most one per moment key per gate. */
  triggers: number;
  /** Suppressed verdicts: a detector's own (quest_active) plus repeated keys. */
  suppressed: number;
}

export function createGate(
  detectors: readonly Detector[],
  opts: { nowMicros: () => number },
): {
  process(input: DetectorInput): { decisions: GateDecision[]; triggers: MomentTrigger[] };
  counters(): GateCounters;
} {
  const counters: GateCounters = {
    eventsTotal: 0,
    eventsDeterministic: 0,
    triggers: 0,
    suppressed: 0,
  };
  const askedFor = new Set<string>();

  return {
    process(input) {
      const decisions: GateDecision[] = [];
      const triggers: MomentTrigger[] = [];
      for (const detector of detectors) {
        const start = opts.nowMicros();
        let verdict: DetectorVerdict = detector.evaluate(input);
        // Measured, never estimated: the injected clock is the server's high-resolution timer.
        const costMicros = Math.max(0, Math.round(opts.nowMicros() - start));
        let momentKey: string | null = null;
        if (verdict.outcome === "ai_trigger") {
          momentKey = verdict.trigger.key;
          if (askedFor.has(momentKey)) {
            verdict = { outcome: "suppressed", reason: "duplicate_key" };
          } else {
            askedFor.add(momentKey);
            triggers.push(verdict.trigger);
            counters.triggers += 1;
          }
        }
        if (verdict.outcome === "suppressed") counters.suppressed += 1;
        decisions.push({
          eventId: input.event.id,
          t: input.event.t,
          detector: detector.name,
          outcome: verdict.outcome,
          reason: verdict.reason,
          momentKey,
          costMicros,
        });
      }
      counters.eventsTotal += 1;
      if (triggers.length === 0) counters.eventsDeterministic += 1;
      return { decisions, triggers };
    },
    counters: () => ({ ...counters }),
  };
}
