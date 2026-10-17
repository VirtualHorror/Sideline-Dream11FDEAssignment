/**
 * The Anthropic provider (@anthropic-ai/sdk 0.131.0, D-014, D-052).
 *
 * Called by ai/gateway.ts only. One system prompt, one user message, `output_config` with the
 * skill's effort and a JSON-schema format; `stop_reason` is checked before any content is read
 * (a refusal is a typed failure, with its usage). Opus 5.5 rejects `budget_tokens`, a disabled
 * thinking block and forced `tool_choice`, so none is sent: thinking stays adaptive and `effort`
 * controls depth. The server-side refusal fallback is on (`fallbacks: "default"` with the
 * `server-side-fallback-2026-07-01` beta), so a declined request is re-run on Anthropic's
 * recommended fallback model and the answer reports the model that served it.
 * Retries are off: the gateway owns the timeout, and a failure falls back to the labelled template
 * (the next fan's request for the moment asks again).
 */
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_BASE_URL } from "../../config.ts";
import {
  type LlmProvider,
  ProviderOutputError,
  ProviderRefusalError,
  type ProviderRequest,
  type ProviderResult,
} from "./types.ts";

export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createAnthropicProvider(opts: {
  apiKey: string;
  /** Tests pass a fake fetch; production uses the global one. */
  fetch?: typeof globalThis.fetch;
}): LlmProvider {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    maxRetries: 0,
    timeout: 120_000,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    name: "anthropic",
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const response = await client.beta.messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: {
            effort: req.effort,
            format: { type: "json_schema", schema: req.jsonSchema },
          },
          betas: [SERVER_SIDE_FALLBACK_BETA],
          fallbacks: "default",
        },
        { signal: req.signal },
      );
      const usage = {
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
      };
      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category ?? null;
        throw new ProviderRefusalError(
          category ? `refused (category: ${category})` : "refused",
          usage,
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new ProviderOutputError("cut off at max_tokens", usage);
      }
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      if (text.trim() === "") throw new ProviderOutputError("no text in the answer", usage);
      let output: unknown;
      try {
        output = JSON.parse(text);
      } catch {
        throw new ProviderOutputError("the answer is not JSON", usage);
      }
      return { output, ...usage, model: response.model };
    },
  };
}
