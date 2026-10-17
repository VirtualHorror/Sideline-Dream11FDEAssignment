import { describe, expect, it } from "vitest";
import { loadConfig, publicConfigSummary } from "../src/config.ts";

const ROOT = "/srv/sideline";

// An OpenAI-compatible proxy, like the one today's .env names.
const PROXY = {
  OPENAI_API_KEY: "sk-proxy-SECRET-456",
  OPENAI_BASE_URL: "https://llm-proxy.example.test/v1",
  SIDELINE_MODEL_FAST: "gpt-6.1-sol",
  SIDELINE_MODEL_SMART: "gpt-6.1-sol",
};

describe("loadConfig", () => {
  it("defaults to localhost:8787, repo-relative paths and no AI provider", () => {
    const config = loadConfig({}, ROOT);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8787);
    expect(config.dataDir).toBe("/srv/sideline/data");
    expect(config.webDistDir).toBe("/srv/sideline/apps/web/dist");
    expect(config.ai.provider).toBe("none");
  });

  it("detects the Anthropic provider from its key", () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test" }, ROOT).ai.provider).toBe("anthropic");
  });

  // Task 5 (PLAN 5.0) makes the model names required for the OpenAI-compatible provider, so the
  // two OpenAI cases below name them; what they assert (key detection, the override) is unchanged.
  const OPENAI_MODELS = { SIDELINE_MODEL_FAST: "gpt-test-fast", SIDELINE_MODEL_SMART: "gpt-test" };

  it("detects the OpenAI provider when only its key is set", () => {
    expect(loadConfig({ OPENAI_API_KEY: "sk-test", ...OPENAI_MODELS }, ROOT).ai.provider).toBe(
      "openai",
    );
  });

  it("lets SIDELINE_AI_PROVIDER override key detection", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-test",
      SIDELINE_AI_PROVIDER: "openai",
      ...OPENAI_MODELS,
    };
    expect(loadConfig(env, ROOT).ai.provider).toBe("openai");
    expect(loadConfig({ ...env, SIDELINE_AI_PROVIDER: "none" }, ROOT).ai.provider).toBe("none");
  });

  it("refuses an explicit provider whose key is missing", () => {
    expect(() => loadConfig({ SIDELINE_AI_PROVIDER: "anthropic" }, ROOT)).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("rejects a non-numeric PORT and names the variable", () => {
    expect(() => loadConfig({ PORT: "eighty" }, ROOT)).toThrow(/PORT/);
  });
});

describe("AI configuration (PLAN 5.0)", () => {
  it("uses an OpenAI-compatible endpoint with its base URL and both model names", () => {
    const { ai } = loadConfig(PROXY, ROOT);
    expect(ai.provider).toBe("openai");
    expect(ai.openaiBaseUrl).toBe("https://llm-proxy.example.test/v1");
    expect(ai.models).toEqual({ fast: "gpt-6.1-sol", smart: "gpt-6.1-sol" });
  });

  it.each([
    ["SIDELINE_MODEL_FAST", { SIDELINE_MODEL_SMART: "gpt-x" }],
    ["SIDELINE_MODEL_SMART", { SIDELINE_MODEL_FAST: "gpt-x" }],
  ])("refuses the OpenAI provider without %s and names it", (name, models) => {
    expect(() => loadConfig({ OPENAI_API_KEY: "sk-test", ...models }, ROOT)).toThrow(name);
  });

  it("prefers Anthropic when both keys are set, with claude-opus-5-5 for both tiers", () => {
    const both = { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test" };
    const { ai } = loadConfig(both, ROOT);
    expect(ai.provider).toBe("anthropic");
    expect(ai.models).toEqual({ fast: "claude-opus-5-5", smart: "claude-opus-5-5" });
    const overridden = loadConfig({ ...both, SIDELINE_MODEL_FAST: "claude-haiku-5-5" }, ROOT);
    expect(overridden.ai.models).toEqual({ fast: "claude-haiku-5-5", smart: "claude-opus-5-5" });
    const forced = { ...PROXY, ANTHROPIC_API_KEY: "sk-ant-test", SIDELINE_AI_PROVIDER: "openai" };
    expect(loadConfig(forced, ROOT).ai.provider).toBe("openai");
  });

  // Today's .env names the proxy's gpt-6.1-sol: adding an Anthropic key must not send that name to
  // Anthropic (a 404 on every call); boot fails and says what to change.
  it("refuses a non-Claude model name for the Anthropic provider and names the variable", () => {
    expect(() => loadConfig({ ...PROXY, ANTHROPIC_API_KEY: "sk-ant-test" }, ROOT)).toThrow(
      /SIDELINE_MODEL_FAST.*gpt-6\.1-sol/,
    );
  });

  it("defaults prices, budget and limits from the PLAN, and parses overrides", () => {
    expect(loadConfig({}, ROOT).ai).toMatchObject({
      models: null,
      openaiBaseUrl: null,
      pricing: { inPerMTok: 5, outPerMTok: 20 },
      dailyBudgetUsd: 3,
      askPerMinute: 12,
      sessionAiCap: 80,
    });
    const tuned = loadConfig(
      {
        SIDELINE_PRICE_IN_PER_MTOK: "1.5",
        SIDELINE_PRICE_OUT_PER_MTOK: "6",
        SIDELINE_AI_DAILY_BUDGET_USD: "0.25",
        SIDELINE_ASK_PER_MINUTE: "30",
        SIDELINE_SESSION_AI_CAP: "5",
      },
      ROOT,
    );
    expect(tuned.ai).toMatchObject({
      pricing: { inPerMTok: 1.5, outPerMTok: 6 },
      dailyBudgetUsd: 0.25,
      askPerMinute: 30,
      sessionAiCap: 5,
    });
  });

  it.each([
    ["OPENAI_BASE_URL", { OPENAI_BASE_URL: "not a url" }],
    ["SIDELINE_AI_DAILY_BUDGET_USD", { SIDELINE_AI_DAILY_BUDGET_USD: "-1" }],
    ["SIDELINE_SESSION_AI_CAP", { SIDELINE_SESSION_AI_CAP: "1.5" }],
  ])("rejects a bad %s and names it", (name, env) => {
    expect(() => loadConfig(env, ROOT)).toThrow(name);
  });
});

// The owner's free-tier keys (Groq, Gemini) with today's proxy key last (D-079).
const CHAIN_KEYS = { GROQ_API_KEY: "gsk_SECRET_groq", GEMINI_API_KEY: "SECRET-gemini", ...PROXY };
const one = (model: string, dailyCap: number | null = null) => ({
  models: { fast: model, smart: model },
  dailyCap,
});

describe("the AI chain (D-079)", () => {
  it("is the provider when a Groq or Gemini key is set: the owner's order, the proxy key last", () => {
    const { ai } = loadConfig(CHAIN_KEYS, ROOT);
    expect(ai.provider).toBe("chain");
    expect(ai.chain).toEqual([
      { provider: "groq", ...one("qwen/qwen3.8-27b") },
      { provider: "groq", ...one("openai/gpt-oss-20b") },
      { provider: "gemini", ...one("gemini-3.5-flash-lite") },
      { provider: "groq", ...one("openai/gpt-oss-120b") },
      { provider: "gemini", ...one("gemini-3.5-flash", 20) },
      { provider: "openai", ...one("gpt-6.1-sol") },
    ]);
    // The first link's models are the configured ones (the cache's key, /api/health).
    expect(ai.models).toEqual({ fast: "qwen/qwen3.8-27b", smart: "qwen/qwen3.8-27b" });
    expect(ai).toMatchObject({ groqApiKey: "gsk_SECRET_groq", geminiApiKey: "SECRET-gemini" });
  });

  it("leaves out the default chain's links whose key is missing", () => {
    expect(loadConfig({ GROQ_API_KEY: "gsk_test" }, ROOT).ai.chain).toEqual([
      { provider: "groq", ...one("qwen/qwen3.8-27b") },
      { provider: "groq", ...one("openai/gpt-oss-20b") },
      { provider: "groq", ...one("openai/gpt-oss-120b") },
    ]);
    expect(loadConfig({ GEMINI_API_KEY: "g-test" }, ROOT).ai.chain).toEqual([
      { provider: "gemini", ...one("gemini-3.5-flash-lite") },
      { provider: "gemini", ...one("gemini-3.5-flash", 20) },
    ]);
  });

  it("reads SIDELINE_AI_CHAIN: provider:model, a daily cap after @, openai with the tier models", () => {
    const { ai } = loadConfig(
      {
        ...CHAIN_KEYS,
        SIDELINE_MODEL_FAST: "gpt-fast",
        SIDELINE_MODEL_SMART: "gpt-smart",
        SIDELINE_AI_CHAIN: " gemini:gemini-3.6-flash@15 ,openai, groq:openai/gpt-oss-120b",
      },
      ROOT,
    );
    expect(ai.chain).toEqual([
      { provider: "gemini", ...one("gemini-3.6-flash", 15) },
      { provider: "openai", models: { fast: "gpt-fast", smart: "gpt-smart" }, dailyCap: null },
      { provider: "groq", ...one("openai/gpt-oss-120b") },
    ]);
  });

  it.each([
    ["an unknown provider", "mistral:large"],
    ["a Groq link without a model", "groq"],
    ["a cap that is not a whole number of requests", "gemini:gemini-3.5-flash@1.5"],
    ["an empty link", "groq:openai/gpt-oss-20b,,openai"],
    ["the same link twice", "groq:openai/gpt-oss-20b,groq:openai/gpt-oss-20b"],
  ])("refuses SIDELINE_AI_CHAIN with %s, naming the variable", (_name, chain) => {
    expect(() => loadConfig({ ...CHAIN_KEYS, SIDELINE_AI_CHAIN: chain }, ROOT)).toThrow(
      /^SIDELINE_AI_CHAIN/,
    );
  });

  it("refuses a link the owner named explicitly when its key is missing", () => {
    expect(() =>
      loadConfig({ GROQ_API_KEY: "gsk_test", SIDELINE_AI_CHAIN: "gemini:gemini-3.5-flash" }, ROOT),
    ).toThrow("SIDELINE_AI_CHAIN link 1 (gemini) needs GEMINI_API_KEY");
  });

  it("refuses the chain's openai link without both model names", () => {
    expect(() => loadConfig({ GROQ_API_KEY: "gsk_test", OPENAI_API_KEY: "sk-test" }, ROOT)).toThrow(
      "SIDELINE_MODEL_FAST",
    );
  });

  it("refuses SIDELINE_AI_PROVIDER=chain when no link has a key", () => {
    expect(() => loadConfig({ SIDELINE_AI_PROVIDER: "chain" }, ROOT)).toThrow(
      "SIDELINE_AI_PROVIDER=chain but no link has a key (GROQ_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY)",
    );
  });

  it("stays out of the way of an explicit provider, and of a configuration without its keys", () => {
    const forced = loadConfig({ ...CHAIN_KEYS, SIDELINE_AI_PROVIDER: "openai" }, ROOT).ai;
    expect([forced.provider, forced.chain]).toEqual(["openai", null]);
    expect(loadConfig(PROXY, ROOT).ai.chain).toBeNull();
  });
});

describe("publicConfigSummary", () => {
  it("never includes API key values", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-SECRET-123" }, ROOT);
    const summary = JSON.stringify(publicConfigSummary(config));
    expect(summary).not.toContain("SECRET");
    expect(JSON.parse(summary)).toMatchObject({ aiProvider: "anthropic" });
  });

  it("shows the chain's links and kinds of endpoint, never a key or a host", () => {
    const summary = publicConfigSummary(loadConfig(CHAIN_KEYS, ROOT));
    const link = (endpoint: string, model: string, dailyCap: number | null = null) => ({
      endpoint,
      fast: model,
      smart: model,
      dailyCap,
    });
    expect(summary).toEqual({
      nodeEnv: "development",
      aiProvider: "chain",
      aiModelFast: "qwen/qwen3.8-27b",
      aiModelSmart: "qwen/qwen3.8-27b",
      aiEndpoint: "chain",
      aiChain: [
        link("groq", "qwen/qwen3.8-27b"),
        link("groq", "openai/gpt-oss-20b"),
        link("gemini", "gemini-3.5-flash-lite"),
        link("groq", "openai/gpt-oss-120b"),
        link("gemini", "gemini-3.5-flash", 20),
        link("openai-compatible", "gpt-6.1-sol"),
      ],
    });
    expect(JSON.stringify(summary)).not.toMatch(/SECRET|gsk_|sk-|llm-proxy|example|googleapis/);
  });

  // D-068: a custom base URL is configuration, not something /api/health publishes.
  it("shows the models and the kind of endpoint only: no key, no host, no path", () => {
    const summary = publicConfigSummary(loadConfig(PROXY, ROOT));
    expect(summary).toEqual({
      nodeEnv: "development",
      aiProvider: "openai",
      aiModelFast: "gpt-6.1-sol",
      aiModelSmart: "gpt-6.1-sol",
      aiEndpoint: "openai-compatible",
      aiChain: null,
    });
    expect(JSON.stringify(summary)).not.toMatch(/SECRET|sk-|\/v1|llm-proxy|example/);
  });

  it.each([
    [{ ANTHROPIC_API_KEY: "sk-ant-test" }, "anthropic"],
    [{ OPENAI_API_KEY: "sk-test", SIDELINE_MODEL_FAST: "m", SIDELINE_MODEL_SMART: "m" }, "openai"],
    [
      {
        OPENAI_API_KEY: "sk-test",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        SIDELINE_MODEL_FAST: "m",
        SIDELINE_MODEL_SMART: "m",
      },
      "openai",
    ],
    [{}, null],
  ])("names the kind of endpoint for %j", (env, kind) => {
    expect(publicConfigSummary(loadConfig(env, ROOT)).aiEndpoint).toBe(kind);
  });
});
