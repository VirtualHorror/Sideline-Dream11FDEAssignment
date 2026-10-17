/**
 * The AI gateway: the only way to a model (Constraint 11), and the place where thesis 3 is
 * enforced: the LLM proposes, deterministic rules dispose.
 *
 * Callers: orchestrator/orchestrator.ts (moments from triggers, fan questions) and
 * scripts/ai-smoke.ts. For one moment key it runs, in order (PLAN Task 5):
 *   in-flight dedupe → cache (live rows, then recorded replay rows) → budget → provider call with an
 *   AbortSignal timeout → zod validation → the skill's guard → cache write.
 * Any failure (no provider, budget, timeout, refusal, invalid output, guard) returns the skill's
 * labelled fallback, built from the same facts, with provenance "fallback". Every run writes exactly
 * one AICallTrace (a run that joined another's in-flight call writes its own) and updates the
 * counters the control plane shows. Fallbacks are never cached: the next fan's run asks again.
 */
import { randomUUID } from "node:crypto";
import type { AICallTrace, AiProviderName, Provenance } from "@sideline/engine";
import { type ZodError, type ZodType, z } from "zod";
import type { TraceSink } from "../telemetry/collector.ts";
import type { Budget } from "./budget.ts";
import type { AiCache } from "./cache.ts";
import { costOf } from "./pricing.ts";
import {
  type LlmProvider,
  ProviderOutputError,
  ProviderRefusalError,
  type Usage,
} from "./providers/types.ts";
import type { Skill } from "./skills/types.ts";

export interface GatewayDeps {
  /** null = no key configured: cache and replay rows only, else fallbacks (aiMode "replay"). */
  provider: LlmProvider | null;
  cache: AiCache;
  budget: Budget;
  traces: TraceSink;
  models: { fast: string; smart: string } | null;
  /** Prices for models without a built-in price (their costs are flagged as estimates). */
  pricing: { inPerMTok: number; outPerMTok: number };
  /** Wall clock (ms): latency, trace timestamps, the budget's day. Injected in tests. */
  now: () => number;
  newId?: () => string;
}

export interface RunOptions {
  /** The caller's latency budget in ms (spoiler teasers); recorded as the trace's budgetMs. */
  deadlineMs?: number;
  /** The session that asked: charged against its call cap and written on the trace row. */
  sessionId?: string;
}

export interface GatewayResult<P> {
  payload: P;
  provenance: Provenance;
  trace: AICallTrace;
}

export interface GatewayCounters {
  /** Provider calls made, whatever their outcome. */
  aiCallsLive: number;
  /** Results served from the cache, replay rows or another run's in-flight call. */
  aiCacheHits: number;
  /** Results that are the skill's labelled fallback. */
  aiFallbacks: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface Gateway {
  run<F, O, P>(
    skill: Skill<F, O, P>,
    key: string,
    facts: F,
    opts?: RunOptions,
  ): Promise<GatewayResult<P>>;
  counters(): GatewayCounters;
  /** "live" while a provider is configured and the daily budget holds, else "replay". */
  mode(): "live" | "replay";
}

/** One run's result before the payload is built: the validated output, or null for a fallback. */
interface Outcome {
  output: unknown;
  provenance: Provenance;
  trace: AICallTrace;
  /** A provider call was made (counted live even when its answer was then rejected). */
  called: boolean;
}

/**
 * JSON Schema keywords not sent to providers: strict structured-output modes reject several of
 * them. zod still enforces every limit on the answer, and the prompts state the limits in words.
 */
const UNSENT_KEYWORDS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "uniqueItems",
]);

function stripKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripKeywords);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSENT_KEYWORDS.has(key)) continue;
    // Under these keys the names are the schema's own property names, not keywords.
    out[key] =
      key === "properties" || key === "$defs"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([name, sub]) => [
              name,
              stripKeywords(sub),
            ]),
          )
        : stripKeywords(value);
  }
  return out;
}

/** The skill's zod output schema as the JSON Schema a provider's strict mode accepts. */
export function providerJsonSchema(schema: ZodType): Record<string, unknown> {
  return stripKeywords(z.toJSONSchema(schema)) as Record<string, unknown>;
}

const MAX_DETAIL = 300;
const clip = (text: string) => (text.length > MAX_DETAIL ? text.slice(0, MAX_DETAIL) : text);

function describeIssues(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** A provider's machine-readable error code ("service_unavailable"), never free text. */
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,48}$/;

/**
 * Error class, HTTP status and the body's error code (the SDKs expose `code` and `type`): enough to
 * tell an outage or an exhausted account from a bad key in the trace alone. Provider messages are
 * not echoed into traces.
 */
function errorLabel(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : typeof error;
  const { status, code, type } = (error ?? {}) as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
  };
  const errorCode = [code, type].find(
    (v): v is string => typeof v === "string" && ERROR_CODE.test(v),
  );
  const parts = [typeof status === "number" ? String(status) : null, errorCode ?? null].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? `${name} (${parts.join(", ")})` : name;
}

/** Rejects as soon as `signal` aborts, so a provider that ignores its signal cannot hang a run. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted at the skill's timeout"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function createGateway(deps: GatewayDeps): Gateway {
  const newId = deps.newId ?? randomUUID;
  const counters: GatewayCounters = {
    aiCallsLive: 0,
    aiCacheHits: 0,
    aiFallbacks: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };
  const inflight = new Map<string, Promise<Outcome>>();

  async function lead<F, O, P>(
    skill: Skill<F, O, P>,
    key: string,
    facts: F,
    opts: RunOptions,
  ): Promise<Outcome> {
    const started = deps.now();
    const elapsed = () => Math.max(0, Math.round(deps.now() - started));
    const providerName: AiProviderName = deps.provider?.name ?? "none";
    const model = deps.provider && deps.models ? deps.models[skill.tier] : null;
    const trace = (fields: {
      provider: AiProviderName;
      model: string | null;
      cache: AICallTrace["cache"];
      outcome: AICallTrace["outcome"];
      usage?: Usage;
      cost?: { usd: number; estimated: boolean };
      detail: string | null;
    }): AICallTrace => ({
      id: newId(),
      skill: skill.name,
      momentKey: key,
      provider: fields.provider,
      model: fields.model,
      cache: fields.cache,
      outcome: fields.outcome,
      latencyMs: elapsed(),
      tokensIn: fields.usage?.tokensIn ?? 0,
      tokensOut: fields.usage?.tokensOut ?? 0,
      costUsd: fields.cost?.usd ?? 0,
      costEstimated: fields.cost?.estimated ?? false,
      promptVersion: skill.promptVersion,
      startedAtWall: new Date(started).toISOString(),
      budgetMs: opts.deadlineMs ?? null,
      detail: fields.detail === null ? null : clip(fields.detail),
    });

    // 1. The cache: this model's live rows first, then recorded replay rows (any model).
    const row = deps.cache.get(key, skill.promptVersion, model);
    if (row) {
      const parsed = skill.outputSchema.safeParse(row.output);
      if (parsed.success) {
        const replay = row.source === "replay";
        return {
          output: parsed.data,
          provenance: replay ? "replay" : "cache",
          called: false,
          trace: trace({
            provider: replay ? "replay" : providerName,
            model: row.model,
            cache: "hit",
            outcome: "ok",
            detail: null,
          }),
        };
      }
      console.warn(
        `[sideline] ignoring a cached ${skill.name} row for ${key} that no longer validates`,
      );
    }

    // 2. No provider, or 3. no budget: the labelled fallback, without a call.
    if (!deps.provider || model === null) {
      return {
        output: null,
        provenance: "fallback",
        called: false,
        trace: trace({
          provider: "none",
          model: null,
          cache: "miss",
          outcome: "fallback",
          detail: "no provider configured and no recorded output",
        }),
      };
    }
    const admitted = deps.budget.admit(opts.sessionId ?? null);
    if (!admitted.ok) {
      return {
        output: null,
        provenance: "fallback",
        called: false,
        trace: trace({
          provider: providerName,
          model,
          cache: "miss",
          outcome: "budget",
          detail: admitted.reason,
        }),
      };
    }

    // 4. The provider call, cut off at the skill's timeout.
    const { system, user } = skill.buildPrompt(facts);
    const timeoutMs = Math.max(1, Math.round(skill.timeoutMs(facts, opts.deadlineMs ?? null)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let usage: Usage | undefined;
    let served = model;
    const called = (outcome: AICallTrace["outcome"], detail: string | null): Outcome => {
      // Costs come from reported usage only; a call cut off by the timeout has none to report.
      const cost = usage
        ? costOf(served, usage.tokensIn, usage.tokensOut, deps.pricing)
        : undefined;
      if (cost) deps.budget.charge(cost.usd);
      return {
        output: null,
        provenance: "fallback",
        called: true,
        trace: trace({
          provider: providerName,
          model: served,
          cache: "miss",
          outcome,
          usage,
          cost,
          detail,
        }),
      };
    };
    try {
      const result = await abortable(
        deps.provider.complete({
          system,
          user,
          jsonSchema: providerJsonSchema(skill.outputSchema),
          model,
          effort: skill.effort,
          maxTokens: skill.maxTokens,
          signal: controller.signal,
          meta: { skill: skill.name, key },
        }),
        controller.signal,
      );
      usage = { tokensIn: result.tokensIn, tokensOut: result.tokensOut };
      served = result.model;
      // 5. Validation and 6. the guard: the model proposes, deterministic rules dispose.
      const parsed = skill.outputSchema.safeParse(result.output);
      if (!parsed.success)
        return called("error", `invalid output: ${describeIssues(parsed.error)}`);
      const verdict = skill.guard(parsed.data, facts);
      if (!verdict.ok) return called("fallback", `guard: ${verdict.reason}`);
      // 7. Only a validated, guarded answer is cached for the next fan.
      deps.cache.putLive(key, skill.promptVersion, model, parsed.data);
      const live = called("ok", null);
      return { ...live, output: parsed.data, provenance: "live" };
    } catch (error) {
      if (controller.signal.aborted) return called("timeout", `no answer within ${timeoutMs} ms`);
      if (error instanceof ProviderRefusalError) {
        usage = error.usage;
        return called("refused", error.message);
      }
      if (error instanceof ProviderOutputError) {
        usage = error.usage;
        return called("error", `invalid output: ${error.message}`);
      }
      return called("error", `provider error: ${errorLabel(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A run that found another run's call in flight for the same key shares its result. */
  function follow(leader: Outcome, started: number, opts: RunOptions): Outcome {
    const shared = leader.provenance === "live" ? "cache" : leader.provenance;
    return {
      output: leader.output,
      provenance: shared,
      called: false,
      trace: {
        ...leader.trace,
        id: newId(),
        cache: shared === "cache" || shared === "replay" ? "hit" : "miss",
        latencyMs: Math.max(0, Math.round(deps.now() - started)),
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        costEstimated: false,
        startedAtWall: new Date(started).toISOString(),
        budgetMs: opts.deadlineMs ?? null,
        detail: leader.trace.detail === null ? null : clip(`shared result: ${leader.trace.detail}`),
      },
    };
  }

  function count(outcome: Outcome, sessionId: string | null): void {
    if (outcome.called) counters.aiCallsLive += 1;
    if (outcome.provenance === "cache" || outcome.provenance === "replay")
      counters.aiCacheHits += 1;
    if (outcome.provenance === "fallback") counters.aiFallbacks += 1;
    counters.tokensIn += outcome.trace.tokensIn;
    counters.tokensOut += outcome.trace.tokensOut;
    counters.costUsd += outcome.trace.costUsd;
    deps.traces.record(outcome.trace, sessionId, outcome.called);
  }

  return {
    async run(skill, key, facts, opts = {}) {
      const flightKey = `${skill.promptVersion}\u0000${key}`;
      const pending = inflight.get(flightKey);
      let outcome: Outcome;
      if (pending) {
        const started = deps.now();
        outcome = follow(await pending, started, opts);
      } else {
        const promise = lead(skill, key, facts, opts);
        inflight.set(flightKey, promise);
        try {
          outcome = await promise;
        } finally {
          inflight.delete(flightKey);
        }
      }
      count(outcome, opts.sessionId ?? null);
      const payload =
        outcome.output === null
          ? skill.fallback(facts)
          : skill.toPayload(outcome.output as Parameters<typeof skill.toPayload>[0], facts);
      return { payload, provenance: outcome.provenance, trace: outcome.trace };
    },
    counters: () => ({ ...counters }),
    mode: () => (deps.provider && deps.models && !deps.budget.exhausted() ? "live" : "replay"),
  };
}
