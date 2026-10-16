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

  it("detects the OpenAI provider when only its key is set", () => {
    expect(loadConfig({ OPENAI_API_KEY: "sk-test" }, ROOT).ai.provider).toBe("openai");
  });

  it("lets SIDELINE_AI_PROVIDER override key detection", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-test",
      SIDELINE_AI_PROVIDER: "openai",
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

describe("publicConfigSummary", () => {
  it("never includes API key values", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-SECRET-123" }, ROOT);
    const summary = JSON.stringify(publicConfigSummary(config));
    expect(summary).not.toContain("SECRET");
    expect(JSON.parse(summary)).toMatchObject({ aiProvider: "anthropic" });
  });
});
