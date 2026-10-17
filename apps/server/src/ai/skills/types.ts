/**
 * The skill contract: everything the gateway needs to turn a moment's facts into a validated,
 * guarded payload, or into a labelled fallback built from the same facts (D-016).
 *
 * Implemented by skills/{spoilerNudge,catchUp,explainer}.ts (Task 5) and the Task 8 skills; run only
 * through ai/gateway.ts. `facts` must hold only what every fan sharing the moment key shares
 * (Constraint 11): per-session values never reach `buildPrompt`.
 */
import type { z } from "zod";
import type { Effort } from "../providers/types.ts";

export type SkillTier = "fast" | "smart";

export type GuardResult = { ok: true } | { ok: false; reason: string };

export interface Skill<F, O, P> {
  /** Recorded on every trace ("spoiler_nudge", "catch_up", "explainer"). */
  name: string;
  /** Part of the cache key: bump it when the prompt, schema or guard changes. */
  promptVersion: string;
  tier: SkillTier;
  effort: Effort;
  maxTokens: number;
  /**
   * How long the provider may take. `deadlineMs` is the caller's latency budget (the teaser's time
   * until the fan's TV reaches the nudge), or null when there is none.
   */
  timeoutMs(facts: F, deadlineMs: number | null): number;
  /** zod `strictObject`s with no optional fields (`.nullable()` instead), PLAN Task 5. */
  outputSchema: z.ZodType<O>;
  buildPrompt(facts: F): { system: string; user: string };
  /** Deterministic checks on a schema-valid output (spoiler lint, citations, legality). */
  guard(out: O, facts: F): GuardResult;
  toPayload(out: O, facts: F): P;
  /** The labelled template used whenever the model's answer cannot be used. */
  fallback(facts: F): P;
}
