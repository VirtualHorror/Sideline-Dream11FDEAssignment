/**
 * The OpenAI-compatible provider (openai 7.27.0, D-033, D-052): any endpoint that speaks the
 * Responses API; today an OpenAI-compatible proxy whose base URL is in .env (gpt-6.1-sol).
 *
 * Called by ai/gateway.ts only. `client.responses.create` with a system and a user input item and a
 * strict `json_schema` text format named after the skill; the answer is `output_text`, the usage
 * `usage.input_tokens/output_tokens` as reported (the proxy adds a hidden ~4.4k-token prompt, which
 * the reported usage includes, D-033). No `reasoning` options are sent. A refusal item or an
 * incomplete response is a typed failure; the model's refusal wording is not copied into traces.
 * Retries are off, as for Anthropic: the gateway owns the timeout and the fallback.
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_BASE_URL } from "../../config.ts";
import {
  type LlmProvider,
  ProviderOutputError,
  ProviderRefusalError,
  type ProviderRequest,
  type ProviderResult,
} from "./types.ts";

export function createOpenAiProvider(opts: {
  apiKey: string;
  /** OPENAI_BASE_URL; null means api.openai.com. */
  baseURL: string | null;
  /** Tests pass a fake fetch; production uses the global one. */
  fetch?: typeof globalThis.fetch;
}): LlmProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL ?? OPENAI_DEFAULT_BASE_URL,
    maxRetries: 0,
    timeout: 120_000,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    name: "openai",
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const response = await client.responses.create(
        {
          model: req.model,
          input: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          text: {
            format: {
              type: "json_schema",
              name: req.meta.skill,
              schema: req.jsonSchema,
              strict: true,
            },
          },
          max_output_tokens: req.maxTokens,
        },
        { signal: req.signal },
      );
      const usage = {
        tokensIn: response.usage?.input_tokens ?? 0,
        tokensOut: response.usage?.output_tokens ?? 0,
      };
      const refused = response.output.some(
        (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
      );
      if (refused) throw new ProviderRefusalError("refused by the model", usage);
      if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason ?? "unknown reason";
        throw new ProviderOutputError(`incomplete (${reason})`, usage);
      }
      const text = response.output_text;
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
