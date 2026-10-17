/**
 * The Chat Completions provider for Groq and Gemini (openai 7.27.0, D-079): both serve an
 * OpenAI-compatible `/chat/completions` (Groq at api.groq.com/openai/v1, Gemini at
 * generativelanguage.googleapis.com/v1beta/openai/, config.ts), with a bearer key.
 *
 * Called by providers/chain.ts, whose links these are (never by the gateway directly). One system
 * and one user message, a strict `json_schema` response format named after the skill, and the
 * reasoning options each model family takes (Groq's reasoning docs, Gemini's OpenAI compatibility):
 *   Groq qwen/*            reasoning_effort one step below the skill's ("none" for low effort: no
 *                          thinking, the instruct mode), reasoning_format "hidden" (JSON mode refuses
 *                          "raw")
 *   Groq openai/gpt-oss-*  reasoning_effort as the skill's, include_reasoning false
 *   Gemini                 reasoning_effort as the skill's (Gemini 3.x cannot turn thinking off)
 *   any other Groq model   no reasoning options
 * The usage is the API's: completion tokens include Groq's reasoning; Gemini counts thinking outside
 * completion_tokens, so whatever total_tokens holds beyond prompt and completion counts as output.
 * Retries are off: the chain moves to its next link, and the gateway owns the timeout and fallback.
 */
import OpenAI from "openai";
import {
  type Effort,
  type LlmProvider,
  ProviderOutputError,
  ProviderRefusalError,
  type ProviderRequest,
  type ProviderResult,
} from "./types.ts";

/** Qwen on Groq: "none" is the instruct mode; each effort reasons one step less than its name. */
const QWEN_EFFORT: Readonly<Record<Effort, "none" | "low" | "medium">> = {
  low: "none",
  medium: "low",
  high: "medium",
};

function reasoningOptions(
  name: "groq" | "gemini",
  model: string,
  effort: Effort,
): Record<string, unknown> {
  if (name === "gemini") return { reasoning_effort: effort };
  if (model.startsWith("qwen/")) {
    return { reasoning_effort: QWEN_EFFORT[effort], reasoning_format: "hidden" };
  }
  if (model.startsWith("openai/gpt-oss")) {
    return { reasoning_effort: effort, include_reasoning: false };
  }
  return {};
}

export function createChatProvider(opts: {
  name: "groq" | "gemini";
  apiKey: string;
  /** config.ts GROQ_BASE_URL or GEMINI_BASE_URL; tests pass their own. */
  baseURL: string;
  /** Tests pass a fake fetch; production uses the global one. */
  fetch?: typeof globalThis.fetch;
}): LlmProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    maxRetries: 0,
    timeout: 120_000,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    name: opts.name,
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      // The reasoning options are the providers' own fields, outside the SDK's types: the body is
      // cast once, and the SDK sends every field as given.
      const body = {
        model: req.model,
        messages: [
          { role: "system" as const, content: req.system },
          { role: "user" as const, content: req.user },
        ],
        response_format: {
          type: "json_schema" as const,
          json_schema: { name: req.meta.skill, schema: req.jsonSchema, strict: true },
        },
        max_completion_tokens: req.maxTokens,
        ...reasoningOptions(opts.name, req.model, req.effort),
      };
      const response = await client.chat.completions.create(
        body as OpenAI.ChatCompletionCreateParamsNonStreaming,
        { signal: req.signal },
      );
      const prompt = response.usage?.prompt_tokens ?? 0;
      const completion = response.usage?.completion_tokens ?? 0;
      const total = response.usage?.total_tokens ?? prompt + completion;
      const usage = {
        tokensIn: prompt,
        tokensOut: completion + Math.max(0, total - prompt - completion),
      };
      const choice = response.choices[0];
      if (!choice) throw new ProviderOutputError("no choice in the answer", usage);
      if (choice.message.refusal) throw new ProviderRefusalError("refused by the model", usage);
      if (choice.finish_reason === "content_filter") {
        throw new ProviderRefusalError("blocked by the provider's content filter", usage);
      }
      if (choice.finish_reason === "length") {
        throw new ProviderOutputError("cut off at max_tokens", usage);
      }
      const text = choice.message.content ?? "";
      if (text.trim() === "") throw new ProviderOutputError("no text in the answer", usage);
      let output: unknown;
      try {
        output = JSON.parse(text);
      } catch {
        throw new ProviderOutputError("the answer is not JSON", usage);
      }
      return { output, ...usage, model: response.model.replace(/^models\//, "") };
    },
  };
}
