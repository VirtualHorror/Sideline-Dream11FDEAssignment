/**
 * What the gateway asks of a model provider, and the typed failures a provider may report.
 *
 * Implemented by providers/{anthropic,openai,chat,chain,scripted}.ts and called only by
 * ai/gateway.ts (Constraint 11: model calls go through the gateway); the chain (D-079) calls the
 * others as its links. A provider sends one system prompt and one user message with a strict JSON
 * schema, and returns the parsed JSON plus the usage the API reported. It does not validate the
 * shape: the gateway does that with the skill's zod schema, so every provider (and the cache) passes
 * through one validation point (D-054).
 */
import type { AiProviderName } from "@sideline/engine";
import type { SkillTier } from "../skills/types.ts";

export type Effort = "low" | "medium" | "high";

export interface ProviderRequest {
  system: string;
  user: string;
  /** The skill's output schema as provider-safe JSON Schema (ai/gateway.ts providerJsonSchema). */
  jsonSchema: Record<string, unknown>;
  model: string;
  /** The skill's tier: a chain asks each link for that link's model of the tier. */
  tier: SkillTier;
  effort: Effort;
  maxTokens: number;
  /** The skill's timeout in ms, after which `signal` aborts: a chain shares it out among its links. */
  timeoutMs: number;
  /** Aborted by the gateway at the skill's timeout. */
  signal: AbortSignal;
  /** For logs and the scripted test provider; never sent to an API. */
  meta: { skill: string; key: string };
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
}

export interface ProviderResult extends Usage {
  /** Parsed JSON, not yet validated. */
  output: unknown;
  /** The model that actually answered (an Anthropic server-side fallback can change it). */
  model: string;
  /** The provider that answered, when it is not the one called: a chain's link (D-079). */
  provider?: AiProviderName;
  /** The links a chain passed over before this answer, and why; the trace's detail. */
  route?: string;
}

/** Which link of a chain produced a typed failure, so the trace names the model that gave it. */
export interface Served {
  provider: AiProviderName;
  model: string;
}

export interface LlmProvider {
  name: AiProviderName;
  complete(req: ProviderRequest): Promise<ProviderResult>;
}

/**
 * How the gateway's trace detail starts when the provider itself failed (a bad key, an account out of
 * credit, an outage): telemetry's TraceSink.lastProviderAnswer reads it back at boot (D-071).
 */
export const PROVIDER_ERROR_DETAIL = "provider error:";

/** The model declined (Anthropic `stop_reason: "refusal"`, an OpenAI refusal item). Tokens count. */
export class ProviderRefusalError extends Error {
  readonly usage: Usage;
  readonly served: Served | null;
  constructor(message: string, usage: Usage, served: Served | null = null) {
    super(message);
    this.name = "ProviderRefusalError";
    this.usage = usage;
    this.served = served;
  }
}

/** The model answered, but not with usable JSON (truncated, empty, not JSON). Tokens count. */
export class ProviderOutputError extends Error {
  readonly usage: Usage;
  readonly served: Served | null;
  constructor(message: string, usage: Usage, served: Served | null = null) {
    super(message);
    this.name = "ProviderOutputError";
    this.usage = usage;
    this.served = served;
  }
}

/**
 * No link of the AI chain answered (D-079): each was rate limited, cooling down, over its daily cap
 * or failing. `summary` names every link and its reason from statuses and error codes only, never a
 * provider's message, so it may go into a trace.
 */
export class ChainExhaustedError extends Error {
  readonly summary: string;
  constructor(summary: string) {
    super(`no link answered: ${summary}`);
    this.name = "ChainExhaustedError";
    this.summary = summary;
  }
}

/** A provider's machine-readable error code ("service_unavailable"), never free text. */
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,48}$/;

/**
 * The HTTP status and the body's error code of a provider failure (the SDKs expose `status`, `code`
 * and `type`), e.g. ["429", "rate_limit_exceeded"]: enough to tell an outage, an exhausted account
 * or a bad key apart. Provider messages are never part of it (they can hold account details).
 */
export function errorParts(error: unknown): string[] {
  const { status, code, type } = (error ?? {}) as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
  };
  const errorCode = [code, type].find(
    (v): v is string => typeof v === "string" && ERROR_CODE.test(v),
  );
  return [typeof status === "number" ? String(status) : null, errorCode ?? null].filter(
    (part): part is string => part !== null,
  );
}

/**
 * How the gateway's trace names a provider failure: "RateLimitError (429, rate_limit_error)", or
 * for the chain the reason of each link. Called by ai/gateway.ts after PROVIDER_ERROR_DETAIL.
 */
export function describeProviderError(error: unknown): string {
  if (error instanceof ChainExhaustedError) return error.message;
  const name = error instanceof Error ? error.constructor.name : typeof error;
  const parts = errorParts(error);
  return parts.length > 0 ? `${name} (${parts.join(", ")})` : name;
}
