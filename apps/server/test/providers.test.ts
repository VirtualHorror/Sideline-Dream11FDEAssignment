import { describe, expect, it } from "vitest";
import { createBudget } from "../src/ai/budget.ts";
import { createCache } from "../src/ai/cache.ts";
import { createGateway } from "../src/ai/gateway.ts";
import { createAnthropicProvider } from "../src/ai/providers/anthropic.ts";
import { createOpenAiProvider } from "../src/ai/providers/openai.ts";
import {
  type LlmProvider,
  ProviderOutputError,
  ProviderRefusalError,
  type ProviderRequest,
} from "../src/ai/providers/types.ts";
import { teaserSkill } from "../src/ai/skills/spoilerNudge.ts";
import { openDatabase } from "../src/db/database.ts";
import { createTraceSink } from "../src/telemetry/collector.ts";
import { fakeClock, teaserFactsAt } from "./helpers.ts";

// The SDKs are real; only the network is replaced: each test hands them a fetch that records the
// request and answers with a canned API response.
function fakeFetch(answer: { status?: number; body: unknown }) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  system: "SYSTEM PROMPT",
  user: "<facts>{}</facts>",
  jsonSchema: {
    type: "object",
    properties: { nudge: { type: "string" } },
    required: ["nudge"],
    additionalProperties: false,
  },
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 4000,
  signal: new AbortController().signal,
  meta: { skill: "spoiler_nudge", key: "nudge:test" },
  ...overrides,
});

const anthropicMessage = (fields: Record<string, unknown>) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: '{"nudge":"Everything rides on this."}' }],
  stop_reason: "end_turn",
  stop_sequence: null,
  stop_details: null,
  usage: { input_tokens: 812, output_tokens: 64 },
  ...fields,
});

describe("Anthropic provider (@anthropic-ai/sdk, D-014, D-052)", () => {
  it("sends one system prompt and user message with effort and a JSON-schema format, and the default refusal fallback", async () => {
    const net = fakeFetch({ body: anthropicMessage({}) });
    const provider = createAnthropicProvider({ apiKey: "sk-ant-test-key", fetch: net.fetch });
    const result = await provider.complete(request());
    expect(result).toEqual({
      output: { nudge: "Everything rides on this." },
      tokensIn: 812,
      tokensOut: 64,
      model: "claude-opus-5-5",
    });
    const call = net.calls[0];
    expect(call?.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(call?.headers.get("x-api-key")).toBe("sk-ant-test-key");
    expect(call?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call?.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system: "SYSTEM PROMPT",
      messages: [{ role: "user", content: "<facts>{}</facts>" }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: request().jsonSchema },
      },
      fallbacks: "default",
    });
    // Rejected by Opus 5.5 (PLAN Task 5): never sent.
    expect(Object.keys(call?.body ?? {})).not.toEqual(
      expect.arrayContaining(["thinking", "tool_choice", "temperature"]),
    );
  });

  it("reports the model that answered after a server-side fallback", async () => {
    const net = fakeFetch({ body: anthropicMessage({ model: "claude-opus-5" }) });
    const provider = createAnthropicProvider({ apiKey: "k", fetch: net.fetch });
    expect((await provider.complete(request())).model).toBe("claude-opus-5");
  });

  it("checks stop_reason before reading content: a refusal throws with its usage", async () => {
    const net = fakeFetch({
      body: anthropicMessage({
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
        usage: { input_tokens: 700, output_tokens: 0 },
      }),
    });
    const provider = createAnthropicProvider({ apiKey: "k", fetch: net.fetch });
    const error = await provider.complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRefusalError);
    expect(error).toMatchObject({
      message: "refused (category: cyber)",
      usage: { tokensIn: 700, tokensOut: 0 },
    });
  });

  it.each([
    [
      "text that is not JSON",
      { content: [{ type: "text", text: "sure! here" }] },
      "the answer is not JSON",
    ],
    ["an answer cut off at max_tokens", { stop_reason: "max_tokens" }, "cut off at max_tokens"],
    ["no text block", { content: [] }, "no text in the answer"],
  ])("treats %s as unusable output", async (_name, fields, message) => {
    const net = fakeFetch({ body: anthropicMessage(fields) });
    const provider = createAnthropicProvider({ apiKey: "k", fetch: net.fetch });
    const error = await provider.complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderOutputError);
    expect((error as Error).message).toBe(message);
  });

  it("surfaces an HTTP 429 as the SDK's typed error; the gateway records its class, not its text", async () => {
    const net = fakeFetch({
      status: 429,
      body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
    });
    const provider = createAnthropicProvider({ apiKey: "k", fetch: net.fetch });
    const result = await gatewayWith(provider).run(teaserSkill, "nudge:test", teaserFacts());
    expect(result.provenance).toBe("fallback");
    expect(result.trace).toMatchObject({
      outcome: "error",
      detail: "provider error: RateLimitError (429)",
    });
    expect(net.calls).toHaveLength(1); // no hidden retries: the gateway owns the policy
  });
});

const openAiResponse = (fields: Record<string, unknown>) => ({
  id: "resp_test",
  object: "response",
  created_at: 0,
  status: "completed",
  model: "gpt-6.1-sol",
  output: [
    {
      type: "message",
      id: "msg_test",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: '{"nudge":"Six balls left."}', annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 4440,
    output_tokens: 30,
    total_tokens: 4470,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
  ...fields,
});

describe("OpenAI-compatible provider (openai SDK, Responses API, D-033)", () => {
  it("calls the configured endpoint with a strict JSON-schema text format and no reasoning options", async () => {
    const net = fakeFetch({ body: openAiResponse({}) });
    const provider = createOpenAiProvider({
      apiKey: "sk-kk-test",
      baseURL: "https://api.proxy.pro/v1",
      fetch: net.fetch,
    });
    const result = await provider.complete(request({ model: "gpt-6.1-sol" }));
    expect(result).toEqual({
      output: { nudge: "Six balls left." },
      tokensIn: 4440,
      tokensOut: 30,
      model: "gpt-6.1-sol",
    });
    const call = net.calls[0];
    expect(call?.url).toBe("https://api.proxy.pro/v1/responses");
    expect(call?.headers.get("authorization")).toBe("Bearer sk-kk-test");
    expect(call?.body).toEqual({
      model: "gpt-6.1-sol",
      input: [
        { role: "system", content: "SYSTEM PROMPT" },
        { role: "user", content: "<facts>{}</facts>" },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "spoiler_nudge",
          schema: request().jsonSchema,
          strict: true,
        },
      },
      max_output_tokens: 4000,
    });
  });

  it("uses api.openai.com when no base URL is configured", async () => {
    const net = fakeFetch({ body: openAiResponse({}) });
    await createOpenAiProvider({ apiKey: "k", baseURL: null, fetch: net.fetch }).complete(
      request(),
    );
    expect(net.calls[0]?.url).toBe("https://api.openai.com/v1/responses");
  });

  it("turns a refusal item into a refusal, with the tokens it cost", async () => {
    const net = fakeFetch({
      body: openAiResponse({
        output: [
          {
            type: "message",
            id: "msg_test",
            status: "completed",
            role: "assistant",
            content: [{ type: "refusal", refusal: "I can't help with that." }],
          },
        ],
      }),
    });
    const provider = createOpenAiProvider({ apiKey: "k", baseURL: null, fetch: net.fetch });
    const error = await provider.complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRefusalError);
    expect(error).toMatchObject({ message: "refused by the model", usage: { tokensIn: 4440 } });
  });

  it("treats an incomplete response as unusable output", async () => {
    const net = fakeFetch({
      body: openAiResponse({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    });
    const provider = createOpenAiProvider({ apiKey: "k", baseURL: null, fetch: net.fetch });
    const error = await provider.complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderOutputError);
    expect((error as Error).message).toBe("incomplete (max_output_tokens)");
  });
});

function gatewayWith(provider: LlmProvider) {
  const clock = fakeClock();
  const db = openDatabase(":memory:");
  return createGateway({
    provider,
    cache: createCache(db, clock.now),
    budget: createBudget({ db, dailyUsd: 3, sessionCap: 80, now: clock.now }),
    traces: createTraceSink(db),
    models: { fast: "claude-opus-5-5", smart: "claude-opus-5-5" },
    pricing: { inPerMTok: 5, outPerMTok: 20 },
    now: clock.now,
  });
}

/** Facts for one real teaser: the first big ball of 1298150's chase (1.5, F05 spot-check list). */
function teaserFacts() {
  return teaserFactsAt("1298150", 2, "1.5");
}
