/**
 * Telemetry: where every AI attempt is written down (one `ai_calls` row per gateway run) and,
 * from PLAN 5.8, the counters the control plane shows.
 *
 * Callers: ai/gateway.ts records each trace through the sink; the telemetry collector (below, 5.8)
 * subscribes to it. Rows carry the session that asked, so the NL inspector (Task 8) can query them.
 */
import type { DatabaseSync } from "node:sqlite";
import type { AICallTrace } from "@sideline/engine";

export type TraceListener = (trace: AICallTrace, sessionId: string | null) => void;

export interface TraceSink {
  record(trace: AICallTrace, sessionId: string | null): void;
  subscribe(listener: TraceListener): () => void;
}

export function createTraceSink(db: DatabaseSync): TraceSink {
  const insert = db.prepare(
    `INSERT INTO ai_calls (id, session_id, skill, moment_key, provider, model, cache, outcome,
       latency_ms, tokens_in, tokens_out, cost_usd, cost_estimated, prompt_version,
       started_at_wall, budget_ms, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const listeners = new Set<TraceListener>();
  return {
    record(trace, sessionId) {
      insert.run(
        trace.id,
        sessionId,
        trace.skill,
        trace.momentKey,
        trace.provider,
        trace.model,
        trace.cache,
        trace.outcome,
        trace.latencyMs,
        trace.tokensIn,
        trace.tokensOut,
        trace.costUsd,
        trace.costEstimated ? 1 : 0,
        trace.promptVersion,
        trace.startedAtWall,
        trace.budgetMs,
        trace.detail,
      );
      for (const listener of listeners) listener(trace, sessionId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
