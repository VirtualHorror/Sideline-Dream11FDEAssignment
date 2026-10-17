/**
 * Telemetry: where every AI attempt is written down (one `ai_calls` row per gateway run), and the
 * counters, latencies, recent decisions and scale projection the control plane shows (PLAN 5.8).
 *
 * Callers: ai/gateway.ts records each trace through the sink; the sessions record every gate result
 * (sessions/session.ts); the telemetry route and the SSE "telemetry" message read snapshots. Trace
 * rows carry the session that asked, so the NL inspector (Task 8) can query them.
 */
import type { DatabaseSync } from "node:sqlite";
import type {
  AICallTrace,
  GateDecision,
  MomentTrigger,
  TelemetryCounters,
  TelemetrySnapshot,
} from "@sideline/engine";
import { scaleProjection } from "./projection.ts";

/** `called`: the run made a provider call (a cache hit, a budget stop or a shared result did not). */
export type TraceListener = (trace: AICallTrace, sessionId: string | null, called: boolean) => void;

export interface TraceSink {
  record(trace: AICallTrace, sessionId: string | null, called: boolean): void;
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
    record(trace, sessionId, called) {
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
      for (const listener of listeners) listener(trace, sessionId, called);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Per-scope tallies: the counters, provider latencies and the most recent decisions and calls. */
interface Bucket {
  counters: TelemetryCounters;
  latencies: number[];
  decisions: GateDecision[];
  calls: AICallTrace[];
  sharedKeys: Set<string>;
  personalKeys: Set<string>;
}

const RECENT_DECISIONS = 200;
const RECENT_CALLS = 100;
const LATENCY_WINDOW = 1000;
export const DEFAULT_VIEWERS = 10_000_000;

const emptyBucket = (): Bucket => ({
  counters: {
    eventsTotal: 0,
    eventsDeterministic: 0,
    gateTriggers: 0,
    aiCallsLive: 0,
    aiCacheHits: 0,
    aiFallbacks: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  },
  latencies: [],
  decisions: [],
  calls: [],
  sharedKeys: new Set(),
  personalKeys: new Set(),
});

const pushBounded = <T>(list: T[], item: T, max: number) => {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
};

/** Nearest-rank percentile of a sample; 0 for an empty one. */
function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

export interface Telemetry {
  registerSession(sessionId: string, matchId: string): void;
  /** One `gate.process` result: every released event of every session passes through here. */
  recordGate(
    sessionId: string,
    decisions: readonly GateDecision[],
    triggers: readonly MomentTrigger[],
  ): void;
  /** A moment the session asked for outside the gate (catch-up reels, fan questions). */
  recordKey(sessionId: string, key: string, scope: "shared" | "session"): void;
  /** Drops an evicted session's detail; global totals keep its numbers. */
  forgetSession(sessionId: string): void;
  hasSession(sessionId: string): boolean;
  snapshot(scope: "global" | "session", sessionId?: string, viewers?: number): TelemetrySnapshot;
}

/**
 * The control plane's numbers (Architecture §8), all counted from what happened: gate decisions
 * from the sessions, AI attempts from the trace sink. The global scope sums every session, including
 * evicted ones. Moment keys feed the scale projection: shared keys once, personal ones per viewer.
 */
export function createTelemetry(deps: {
  traces: TraceSink;
  /** Timeline length per match, for the projection's events per match. */
  eventsPerMatch: ReadonlyMap<string, number>;
}): Telemetry {
  const global = emptyBucket();
  const sessions = new Map<string, Bucket & { matchId: string }>();
  let sessionsSeen = 0;
  let personalMoments = 0;

  const bucketsOf = (sessionId: string | null): Bucket[] => {
    const own = sessionId === null ? undefined : sessions.get(sessionId);
    return own ? [global, own] : [global];
  };

  const addKey = (sessionId: string, key: string, scope: "shared" | "session") => {
    const own = sessions.get(sessionId);
    if (scope === "shared") {
      global.sharedKeys.add(key);
      own?.sharedKeys.add(key);
    } else if (own && !own.personalKeys.has(key)) {
      own.personalKeys.add(key);
      personalMoments += 1;
    }
  };

  deps.traces.subscribe((trace, sessionId, called) => {
    for (const bucket of bucketsOf(sessionId)) {
      const c = bucket.counters;
      if (called) {
        c.aiCallsLive += 1;
        pushBounded(bucket.latencies, trace.latencyMs, LATENCY_WINDOW);
      }
      if (trace.cache === "hit") c.aiCacheHits += 1;
      if (trace.outcome !== "ok") c.aiFallbacks += 1;
      c.tokensIn += trace.tokensIn;
      c.tokensOut += trace.tokensOut;
      c.costUsd += trace.costUsd;
      pushBounded(bucket.calls, trace, RECENT_CALLS);
    }
  });

  return {
    registerSession(sessionId, matchId) {
      sessions.set(sessionId, { ...emptyBucket(), matchId });
      sessionsSeen += 1;
    },
    recordGate(sessionId, decisions, triggers) {
      for (const bucket of bucketsOf(sessionId)) {
        const c = bucket.counters;
        c.eventsTotal += 1;
        if (triggers.length === 0) c.eventsDeterministic += 1;
        c.gateTriggers += triggers.length;
        for (const decision of decisions) pushBounded(bucket.decisions, decision, RECENT_DECISIONS);
      }
      for (const trigger of triggers) addKey(sessionId, trigger.key, trigger.scope);
    },
    recordKey: addKey,
    forgetSession: (sessionId) => {
      sessions.delete(sessionId);
    },
    hasSession: (sessionId) => sessions.has(sessionId),
    snapshot(scope, sessionId, viewers = DEFAULT_VIEWERS) {
      const own = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (scope === "session" && !own) throw new Error(`no telemetry for session ${sessionId}`);
      const bucket = scope === "session" && own ? own : global;
      const lengths = [...deps.eventsPerMatch.values()];
      const eventsPerMatch =
        scope === "session" && own
          ? (deps.eventsPerMatch.get(own.matchId) ?? 0)
          : Math.round(lengths.reduce((sum, n) => sum + n, 0) / Math.max(1, lengths.length));
      const personalPerViewer =
        scope === "session" && own
          ? own.personalKeys.size
          : sessionsSeen > 0
            ? personalMoments / sessionsSeen
            : 0;
      return {
        scope,
        counters: { ...bucket.counters },
        latencyMs: {
          p50: percentile(bucket.latencies, 0.5),
          p95: percentile(bucket.latencies, 0.95),
        },
        recentDecisions: [...bucket.decisions],
        recentCalls: [...bucket.calls],
        projection: scaleProjection({
          viewers,
          eventsPerMatch,
          sharedKeys: bucket.sharedKeys.size,
          personalPerViewer,
        }),
      };
    },
  };
}
