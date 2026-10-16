import { describe, expect, it } from "vitest";
import { loadConfig, publicConfigSummary } from "../src/config.ts";

const ROOT = "/srv/sideline";

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
  const proxy = {
    OPENAI_API_KEY: "sk-kk-SECRET-456",
    OPENAI_BASE_URL: "https://api.proxy.pro/v1",
    SIDELINE_MODEL_FAST: "gpt-6.1-sol",
    SIDELINE_MODEL_SMART: "gpt-6.1-sol",
  };

  it("uses an OpenAI-compatible endpoint with its base URL and both model names", () => {
    const { ai } = loadConfig(proxy, ROOT);
    expect(ai.provider).toBe("openai");
    expect(ai.openaiBaseUrl).toBe("https://api.proxy.pro/v1");
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
    const forced = { ...proxy, ANTHROPIC_API_KEY: "sk-ant-test", SIDELINE_AI_PROVIDER: "openai" };
    expect(loadConfig(forced, ROOT).ai.provider).toBe("openai");
  });

  // Today's .env names gpt-6.1-sol for proxy: adding an Anthropic key must not send that name to
  // Anthropic (a 404 on every call); boot fails and says what to change.
  it("refuses a non-Claude model name for the Anthropic provider and names the variable", () => {
    expect(() => loadConfig({ ...proxy, ANTHROPIC_API_KEY: "sk-ant-test" }, ROOT)).toThrow(
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

describe("publicConfigSummary", () => {
  it("never includes API key values", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-SECRET-123" }, ROOT);
    const summary = JSON.stringify(publicConfigSummary(config));
    expect(summary).not.toContain("SECRET");
    expect(JSON.parse(summary)).toMatchObject({ aiProvider: "anthropic" });
  });

  it("shows models and the endpoint's host name only: no key, no path", () => {
    const config = loadConfig(
      {
        OPENAI_API_KEY: "sk-kk-SECRET-456",
        OPENAI_BASE_URL: "https://api.proxy.pro/v1",
        SIDELINE_MODEL_FAST: "gpt-6.1-sol",
        SIDELINE_MODEL_SMART: "gpt-6.1-sol",
      },
      ROOT,
    );
    const summary = publicConfigSummary(config);
    expect(summary).toEqual({
      nodeEnv: "development",
      aiProvider: "openai",
      aiModelFast: "gpt-6.1-sol",
      aiModelSmart: "gpt-6.1-sol",
      aiEndpointHost: "api.proxy.pro",
    });
    expect(JSON.stringify(summary)).not.toMatch(/SECRET|sk-|\/v1/);
  });

  it.each([
    [{ ANTHROPIC_API_KEY: "sk-ant-test" }, "api.anthropic.com"],
    [
      { OPENAI_API_KEY: "sk-test", SIDELINE_MODEL_FAST: "m", SIDELINE_MODEL_SMART: "m" },
      "api.openai.com",
    ],
    [{}, null],
  ])("names the default endpoint host for %j", (env, host) => {
    expect(publicConfigSummary(loadConfig(env, ROOT)).aiEndpointHost).toBe(host);
  });
});
