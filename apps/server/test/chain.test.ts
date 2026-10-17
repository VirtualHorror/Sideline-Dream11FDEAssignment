import { AICallTraceSchema } from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { createBudget, createLinkLedger } from "../src/ai/budget.ts";
import { createCache } from "../src/ai/cache.ts";
import { createGateway } from "../src/ai/gateway.ts";
import { type ChainLink, createChainProvider, quotaDay } from "../src/ai/providers/chain.ts";
import { createChatProvider } from "../src/ai/providers/chat.ts";
import { createOpenAiProvider } from "../src/ai/providers/openai.ts";
import {
  ChainExhaustedError,
  ProviderOutputError,
  ProviderRefusalError,
  type ProviderRequest,
} from "../src/ai/providers/types.ts";
import { teaserSkill } from "../src/ai/skills/spoilerNudge.ts";
import { openDatabase } from "../src/db/database.ts";
import { createTraceSink } from "../src/telemetry/collector.ts";
import { fakeClock, teaserFactsAt } from "./helpers.ts";

// The links are the real adapters (the openai SDK included); only the network is scripted, one
// response per request, so a 429 is the SDK's own RateLimitError with its headers.
type Reply =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | "network down"
  | "hang";

function scriptedNetwork(replies: Reply[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    const reply = replies.shift();
    if (reply === undefined) throw new Error("the test scripted no more replies");
    if (reply === "network down") throw new TypeError("fetch failed");
    if (reply === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const answer = (
  model: string,
  content: string | null = '{"nudge":"Everything rides on this."}',
  message: Record<string, unknown> = {},
) => ({
  status: 200,
  body: {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, ...message },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 330, completion_tokens: 24, total_tokens: 354 },
  },
});

// Groq's own 429 body and header (seen on the free tier: 8,000 tokens a minute per model).
const rateLimited = (retryAfter: string | null): Reply => ({
  status: 429,
  body: {
    error: {
      message: "Rate limit reached for model in organization org_SECRET on tokens per minute",
      type: "tokens",
      code: "rate_limit_exceeded",
    },
  },
  headers: retryAfter === null ? {} : { "retry-after": retryAfter },
});

const failure = (status: number, code?: string) => ({
  status,
  body: { error: { message: `upstream said ${status} with private details`, code } },
});

function groq(model: string, replies: Reply[]) {
  const net = scriptedNetwork(replies);
  const provider = createChatProvider({
    name: "groq",
    apiKey: "gsk_test",
    baseURL: "https://groq.example.test/openai/v1",
    fetch: net.fetch,
  });
  return { link: { provider, models: { fast: model, smart: model }, dailyCap: null }, net };
}

function gemini(model: string, replies: Reply[], dailyCap: number | null = null) {
  const net = scriptedNetwork(replies);
  const provider = createChatProvider({
    name: "gemini",
    apiKey: "gemini-test",
    baseURL: "https://gemini.example.test/v1beta/openai/",
    fetch: net.fetch,
  });
  return { link: { provider, models: { fast: model, smart: model }, dailyCap }, net };
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
  model: "qwen/qwen3.8-27b",
  tier: "fast",
  effort: "low",
  maxTokens: 4000,
  timeoutMs: 15_000,
  signal: new AbortController().signal,
  meta: { skill: "spoiler_nudge", key: "nudge:test" },
  ...overrides,
});

function chainOf(links: ChainLink[], clock = fakeClock()) {
  const waits: number[] = [];
  const chain = createChainProvider({
    links,
    now: clock.now,
    sleep: async (ms) => {
      waits.push(ms);
      clock.advance(ms);
    },
  });
  return { chain, clock, waits };
}

describe("the AI chain: links in order, the first that answers serves (D-079)", () => {
  it("answers from the first link and names the provider and model that answered", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [answer("qwen/qwen3.8-27b")]);
    const oss = groq("openai/gpt-oss-20b", []);
    const { chain } = chainOf([qwen.link, oss.link]);
    expect(chain.name).toBe("chain");
    expect(await chain.complete(request())).toEqual({
      output: { nudge: "Everything rides on this." },
      tokensIn: 330,
      tokensOut: 24,
      model: "qwen/qwen3.8-27b",
      provider: "groq",
    });
    expect(qwen.net.calls[0]?.body.model).toBe("qwen/qwen3.8-27b");
    expect(oss.net.calls).toHaveLength(0);
  });

  it("asks each link for its own model of the skill's tier", async () => {
    const net = scriptedNetwork([answer("gpt-smart")]);
    const provider = createChatProvider({
      name: "groq",
      apiKey: "gsk_test",
      baseURL: "https://groq.example.test/openai/v1",
      fetch: net.fetch,
    });
    const { chain } = chainOf([
      { provider, models: { fast: "gpt-fast", smart: "gpt-smart" }, dailyCap: null },
    ]);
    await chain.complete(request({ tier: "smart" }));
    expect(net.calls[0]?.body.model).toBe("gpt-smart");
  });

  it("passes over a rate-limited link to the next one, and says so on the answer", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [rateLimited("20")]);
    const oss = groq("openai/gpt-oss-20b", [answer("openai/gpt-oss-20b")]);
    const { chain } = chainOf([qwen.link, oss.link]);
    const result = await chain.complete(request());
    expect(result).toMatchObject({
      model: "openai/gpt-oss-20b",
      provider: "groq",
      route: "passed over groq qwen/qwen3.8-27b (429, rate_limit_exceeded)",
    });
    expect(JSON.stringify(result)).not.toMatch(/org_SECRET|Rate limit reached/);
  });

  it("skips a link for its retry-after, then asks it again", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [rateLimited("20"), answer("qwen/qwen3.8-27b")]);
    const oss = groq("openai/gpt-oss-20b", [
      answer("openai/gpt-oss-20b"),
      answer("openai/gpt-oss-20b"),
    ]);
    const { chain, clock } = chainOf([qwen.link, oss.link]);
    await chain.complete(request());
    clock.advance(19_999);
    const cooling = await chain.complete(request());
    expect(cooling.route).toBe("passed over groq qwen/qwen3.8-27b (cooling down)");
    expect(qwen.net.calls).toHaveLength(1);
    clock.advance(1);
    expect((await chain.complete(request())).model).toBe("qwen/qwen3.8-27b");
    expect(qwen.net.calls).toHaveLength(2);
  });

  it.each([
    ["a bad key (401)", failure(401), 600_000],
    ["no access (403)", failure(403, "permission_denied"), 600_000],
    ["a missing model (404)", failure(404, "model_not_found"), 600_000],
    ["a 429 without retry-after", rateLimited(null), 30_000],
    ["an outage (503)", failure(503, "service_unavailable"), 15_000],
    ["a network failure", "network down" as const, 15_000],
  ])("cools a link down after %s for %i ms", async (_name, reply, coolMs) => {
    const first = groq("qwen/qwen3.8-27b", [reply, answer("qwen/qwen3.8-27b")]);
    const next = groq("openai/gpt-oss-20b", [
      answer("openai/gpt-oss-20b"),
      answer("openai/gpt-oss-20b"),
      answer("openai/gpt-oss-20b"),
    ]);
    const { chain, clock } = chainOf([first.link, next.link]);
    await chain.complete(request());
    clock.advance(coolMs - 1);
    await chain.complete(request());
    expect(first.net.calls).toHaveLength(1);
    clock.advance(1);
    expect((await chain.complete(request())).model).toBe("qwen/qwen3.8-27b");
  });

  it.each([
    ["a request too large for the minute's tokens (413)", failure(413, "rate_limit_exceeded")],
    ["a request the model cannot take (400)", failure(400, "json_validate_failed")],
  ])("passes over %s for this request only", async (_name, reply) => {
    const first = groq("qwen/qwen3.8-27b", [reply, answer("qwen/qwen3.8-27b")]);
    const next = groq("openai/gpt-oss-20b", [answer("openai/gpt-oss-20b")]);
    const { chain } = chainOf([first.link, next.link]);
    expect((await chain.complete(request())).model).toBe("openai/gpt-oss-20b");
    expect((await chain.complete(request())).model).toBe("qwen/qwen3.8-27b");
  });

  it("ends the request on an answer it cannot use, naming the link that gave it", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [answer("qwen/qwen3.8-27b", "sure! here you go")]);
    const oss = groq("openai/gpt-oss-20b", []);
    const { chain } = chainOf([qwen.link, oss.link]);
    const error = await chain.complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderOutputError);
    expect(error).toMatchObject({
      message: "the answer is not JSON",
      usage: { tokensIn: 330, tokensOut: 24 },
      served: { provider: "groq", model: "qwen/qwen3.8-27b" },
    });
    expect(oss.net.calls).toHaveLength(0);
  });

  it("ends the request on a refusal, naming the link that refused", async () => {
    const refusal = answer("gemini-3.5-flash-lite", null, { refusal: "I can't help with that." });
    const lite = gemini("gemini-3.5-flash-lite", [refusal]);
    const { chain } = chainOf([lite.link]);
    const error = await chain.complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRefusalError);
    expect(error).toMatchObject({
      served: { provider: "gemini", model: "gemini-3.5-flash-lite" },
    });
  });

  it("waits for the soonest cooldown when every link is down and the wait leaves time to ask", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [rateLimited("3"), answer("qwen/qwen3.8-27b")]);
    const oss = groq("openai/gpt-oss-20b", [rateLimited("5")]);
    const { chain, waits } = chainOf([qwen.link, oss.link]);
    const result = await chain.complete(request({ timeoutMs: 15_000 }));
    expect(waits).toEqual([3_000]);
    expect(result.model).toBe("qwen/qwen3.8-27b");
    expect(oss.net.calls).toHaveLength(1);
  });

  it("gives up with one error naming each link's reason, never a provider's words, when no wait fits", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [rateLimited("60")]);
    const lite = gemini("gemini-3.5-flash-lite", [failure(401)]);
    const proxy = scriptedNetwork([
      { status: 403, body: { error: { message: "key expired, account 42", code: "key_expired" } } },
    ]);
    const openai = createOpenAiProvider({
      apiKey: "sk-test",
      baseURL: "https://llm-proxy.example.test/v1",
      fetch: proxy.fetch,
    });
    const { chain, waits } = chainOf([
      qwen.link,
      lite.link,
      { provider: openai, models: { fast: "gpt-6.1-sol", smart: "gpt-6.1-sol" }, dailyCap: null },
    ]);
    const error = await chain.complete(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChainExhaustedError);
    expect((error as ChainExhaustedError).summary).toBe(
      "groq qwen/qwen3.8-27b (429, rate_limit_exceeded); gemini gemini-3.5-flash-lite (401); openai gpt-6.1-sol (403, key_expired)",
    );
    expect(String((error as Error).message)).not.toMatch(/org_SECRET|account 42|private/);
    expect(waits).toEqual([]);
  });

  it("gives a hung link half the time left while another link could still answer", async () => {
    const qwen = groq("qwen/qwen3.8-27b", ["hang"]);
    const oss = groq("openai/gpt-oss-20b", [answer("openai/gpt-oss-20b")]);
    const { chain } = chainOf([qwen.link, oss.link]);
    const result = await chain.complete(request({ timeoutMs: 400 }));
    expect(result).toMatchObject({
      model: "openai/gpt-oss-20b",
      route: "passed over groq qwen/qwen3.8-27b (no answer within 200 ms)",
    });
  });

  // A share is cut by the time left, not by the link: under 2 s it says nothing about the link.
  it("does not cool down a link that only ran out of a short share of the time", async () => {
    const qwen = groq("qwen/qwen3.8-27b", ["hang", answer("qwen/qwen3.8-27b")]);
    const oss = groq("openai/gpt-oss-20b", [answer("openai/gpt-oss-20b")]);
    const { chain } = chainOf([qwen.link, oss.link]);
    await chain.complete(request({ timeoutMs: 400 }));
    expect((await chain.complete(request())).model).toBe("qwen/qwen3.8-27b");
  });

  it("stops when the gateway's timeout aborts the request: no other link is asked", async () => {
    const qwen = groq("qwen/qwen3.8-27b", ["hang"]);
    const oss = groq("openai/gpt-oss-20b", [answer("openai/gpt-oss-20b")]);
    const { chain } = chainOf([qwen.link, oss.link]);
    const controller = new AbortController();
    const pending = chain.complete(request({ signal: controller.signal, timeoutMs: 60_000 }));
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(oss.net.calls).toHaveLength(0);
  });
});

describe("a daily cap on a link (Gemini 3.5 Flash: 20 requests a day on the free tier)", () => {
  it("counts days as Google's quotas do: from midnight Pacific time", () => {
    expect(quotaDay(Date.parse("2026-10-17T06:59:59Z"))).toBe("2026-10-16");
    expect(quotaDay(Date.parse("2026-10-17T07:00:00Z"))).toBe("2026-10-17");
    expect(quotaDay(Date.parse("2026-12-01T07:59:59Z"))).toBe("2026-11-30");
    expect(quotaDay(Date.parse("2026-12-01T08:00:00Z"))).toBe("2026-12-01");
  });

  it("asks a capped link at most its cap in a day, remembered across restarts, and again the next day", async () => {
    const db = openDatabase(":memory:");
    const clock = fakeClock(Date.parse("2026-10-17T07:00:00Z"));
    const flashReplies: Reply[] = [answer("gemini-3.5-flash"), answer("gemini-3.5-flash")];
    const flash = gemini("gemini-3.5-flash", flashReplies, 2);
    const oss = groq("openai/gpt-oss-20b", [
      answer("openai/gpt-oss-20b"),
      answer("openai/gpt-oss-20b"),
    ]);
    const boot = () =>
      createChainProvider({
        links: [flash.link, oss.link],
        ledger: createLinkLedger(db),
        now: clock.now,
      });
    const first = boot();
    expect((await first.complete(request())).model).toBe("gemini-3.5-flash");
    expect((await first.complete(request())).model).toBe("gemini-3.5-flash");
    const restarted = boot();
    expect(await restarted.complete(request())).toMatchObject({
      model: "openai/gpt-oss-20b",
      route: "passed over gemini gemini-3.5-flash (2 a day used)",
    });
    expect(flash.net.calls).toHaveLength(2);
    clock.set(Date.parse("2026-10-18T07:00:00Z"));
    flashReplies.push(answer("gemini-3.5-flash"));
    expect((await restarted.complete(request())).model).toBe("gemini-3.5-flash");
    expect(flash.net.calls).toHaveLength(3);
  });

  it("counts a request that failed: the quota counts what was sent", async () => {
    const clock = fakeClock(Date.parse("2026-10-17T07:00:00Z"));
    const flash = gemini("gemini-3.5-flash", [failure(503)], 1);
    const oss = groq("openai/gpt-oss-20b", [
      answer("openai/gpt-oss-20b"),
      answer("openai/gpt-oss-20b"),
    ]);
    const { chain } = chainOf([flash.link, oss.link], clock);
    await chain.complete(request());
    clock.advance(60_000);
    expect((await chain.complete(request())).route).toBe(
      "passed over gemini gemini-3.5-flash (1 a day used)",
    );
    expect(flash.net.calls).toHaveLength(1);
  });
});

describe("the gateway over the chain: one trace per run, for the link that served", () => {
  function gatewayOver(links: ChainLink[]) {
    const clock = fakeClock();
    const db = openDatabase(":memory:");
    const chain = createChainProvider({ links, now: clock.now, sleep: async () => {} });
    const gateway = createGateway({
      provider: chain,
      cache: createCache(db, clock.now),
      budget: createBudget({ db, dailyUsd: 3, sessionCap: 80, now: clock.now }),
      traces: createTraceSink(db),
      models: links[0]?.models ?? null,
      pricing: { inPerMTok: 5, outPerMTok: 20 },
      now: clock.now,
    });
    return { gateway, db };
  }
  const facts = () => teaserFactsAt("1298150", 2, "1.5");

  it("names the link that served and the links passed over, and prices the served model", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [rateLimited("20")]);
    const oss = groq("openai/gpt-oss-20b", [answer("openai/gpt-oss-20b")]);
    const { gateway } = gatewayOver([qwen.link, oss.link]);
    const result = await gateway.run(teaserSkill, "nudge:chain", facts());
    expect(result.provenance).toBe("live");
    expect(AICallTraceSchema.parse(result.trace)).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-20b",
      outcome: "ok",
      tokensIn: 330,
      tokensOut: 24,
      // 330 × $0.075/M + 24 × $0.30/M: Groq's list price for gpt-oss-20b, not an estimate
      costUsd: expect.closeTo(0.00003195, 12),
      costEstimated: false,
      detail: "passed over groq qwen/qwen3.8-27b (429, rate_limit_exceeded)",
    });
  });

  it("serves the next fan from the cache, saying which model wrote the answer", async () => {
    const oss = groq("openai/gpt-oss-20b", [answer("openai/gpt-oss-20b")]);
    const qwen = groq("qwen/qwen3.8-27b", [rateLimited("20")]);
    const { gateway } = gatewayOver([qwen.link, oss.link]);
    await gateway.run(teaserSkill, "nudge:shared", facts());
    const next = await gateway.run(teaserSkill, "nudge:shared", facts());
    expect(next.provenance).toBe("cache");
    expect(next.trace).toMatchObject({
      provider: "chain",
      model: "openai/gpt-oss-20b",
      cache: "hit",
    });
  });

  it("falls back, labelled, when no link answers: one trace, every link's reason, aiMode replay", async () => {
    const qwen = groq("qwen/qwen3.8-27b", [rateLimited("60")]);
    const lite = gemini("gemini-3.5-flash-lite", [failure(401)]);
    const { gateway } = gatewayOver([qwen.link, lite.link]);
    const result = await gateway.run(teaserSkill, "nudge:down", facts());
    expect(result.provenance).toBe("fallback");
    expect(result.trace).toMatchObject({
      provider: "chain",
      outcome: "error",
      tokensIn: 0,
      costUsd: 0,
      detail:
        "provider error: no link answered: groq qwen/qwen3.8-27b (429, rate_limit_exceeded); gemini gemini-3.5-flash-lite (401)",
    });
    expect(gateway.mode()).toBe("replay");
  });
});
