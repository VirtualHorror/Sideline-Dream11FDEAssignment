/**
 * Control-plane telemetry: what the system decided, and what it cost.
 *
 * GateDecision records every detector verdict (most are "deterministic": handled by
 * code at no LLM cost). AICallTrace records every LLM attempt, cache hit, replay or
 * fallback. The Control Plane drawer renders these live; the NL inspector can query
 * them. Numbers here must come from real counters, never from constants.
 */
import { z } from "zod";
import { MatchTimeSchema } from "./primitives.ts";

export const GateDecisionSchema = z.object({
  eventId: z.string(),
  t: MatchTimeSchema,
  detector: z.string().min(1),
  outcome: z.enum(["deterministic", "ai_trigger", "suppressed"]),
  /** Short machine-readable reason, e.g. "captain_dismissed_cheaply". */
  reason: z.string().min(1),
  momentKey: z.string().nullable(),
  /** Measured evaluation cost in microseconds. */
  costMicros: z.number().int().nonnegative(),
});
export type GateDecision = z.infer<typeof GateDecisionSchema>;

/**
 * Who answered an AI attempt. Task 11 addition (D-079): "groq" and "gemini" are the AI chain's
 * links; "chain" names the chain itself where no single link did (a cache hit it served, a run no
 * link answered).
 */
export const AiProviderNameSchema = z.enum([
  "anthropic",
  "openai",
  "groq",
  "gemini",
  "chain",
  "replay",
  "scripted",
  "none",
]);
export type AiProviderName = z.infer<typeof AiProviderNameSchema>;

export const AICallTraceSchema = z.object({
  id: z.string().min(1),
  skill: z.string().min(1),
  momentKey: z.string().min(1),
  provider: AiProviderNameSchema,
  model: z.string().nullable(),
  cache: z.enum(["hit", "miss", "bypass"]),
  outcome: z.enum(["ok", "repaired", "fallback", "refused", "error", "timeout", "budget"]),
  latencyMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  /**
   * True when the model has no built-in price and the cost uses the configured per-token prices
   * (SIDELINE_PRICE_*_PER_MTOK); the UI shows such costs as "est." (Task 5 addition, D-053).
   */
  costEstimated: z.boolean(),
  promptVersion: z.string().min(1),
  startedAtWall: z.iso.datetime(),
  /** For deadline-bound skills (spoiler nudges): ms available when the call started. */
  budgetMs: z.number().int().nullable(),
  /**
   * Why the attempt ended as it did when it was not a clean result ("no answer within 9000 ms",
   * "guard: …", "no provider configured"); null otherwise (Task 5 addition, D-053).
   */
  detail: z.string().max(300).nullable(),
});
export type AICallTrace = z.infer<typeof AICallTraceSchema>;

export const TelemetryCountersSchema = z.object({
  eventsTotal: z.number().int().nonnegative(),
  eventsDeterministic: z.number().int().nonnegative(),
  gateTriggers: z.number().int().nonnegative(),
  aiCallsLive: z.number().int().nonnegative(),
  aiCacheHits: z.number().int().nonnegative(),
  aiFallbacks: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type TelemetryCounters = z.infer<typeof TelemetryCountersSchema>;

/**
 * "What would this cost at Dream11 scale?" computed from live counters:
 * naive = one LLM call per event per viewer; Sideline = one call per unique moment key.
 */
export const ScaleProjectionSchema = z.object({
  concurrentViewers: z.number().int().positive(),
  eventsPerMatch: z.number().int().nonnegative(),
  naiveLlmCalls: z.number().nonnegative(),
  sidelineLlmCalls: z.number().nonnegative(),
  savedPct: z.number().min(0).max(100),
  /** Human-readable formula with the numbers substituted, shown in the UI. */
  formula: z.string(),
});
export type ScaleProjection = z.infer<typeof ScaleProjectionSchema>;

export const TelemetrySnapshotSchema = z.object({
  scope: z.enum(["session", "global"]),
  counters: TelemetryCountersSchema,
  latencyMs: z.object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() }),
  recentDecisions: z.array(GateDecisionSchema).max(200),
  recentCalls: z.array(AICallTraceSchema).max(100),
  projection: ScaleProjectionSchema,
});
export type TelemetrySnapshot = z.infer<typeof TelemetrySnapshotSchema>;
