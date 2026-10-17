/**
 * What the gateway asks of a model provider, and the typed failures a provider may report.
 *
 * Implemented by providers/{anthropic,openai,scripted}.ts and called only by ai/gateway.ts
 * (Constraint 11: model calls go through the gateway). A provider sends one system prompt and one
 * user message with a strict JSON schema, and returns the parsed JSON plus the usage the API
 * reported. It does not validate the shape: the gateway does that with the skill's zod schema, so
 * every provider (and the cache) passes through one validation point (D-054).
 */
import type { AiProviderName } from "@sideline/engine";

export type Effort = "low" | "medium" | "high";

export interface ProviderRequest {
  system: string;
  user: string;
  /** The skill's output schema as provider-safe JSON Schema (ai/gateway.ts providerJsonSchema). */
  jsonSchema: Record<string, unknown>;
  model: string;
  effort: Effort;
  maxTokens: number;
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
}

export interface LlmProvider {
  name: AiProviderName;
  complete(req: ProviderRequest): Promise<ProviderResult>;
}

/** The model declined (Anthropic `stop_reason: "refusal"`, an OpenAI refusal item). Tokens count. */
export class ProviderRefusalError extends Error {
  readonly usage: Usage;
  constructor(message: string, usage: Usage) {
    super(message);
    this.name = "ProviderRefusalError";
    this.usage = usage;
  }
}

/** The model answered, but not with usable JSON (truncated, empty, not JSON). Tokens count. */
export class ProviderOutputError extends Error {
  readonly usage: Usage;
  constructor(message: string, usage: Usage) {
    super(message);
    this.name = "ProviderOutputError";
    this.usage = usage;
  }
}
