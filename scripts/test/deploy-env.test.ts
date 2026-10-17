import { describe, expect, it } from "vitest";
import { renderProductionEnv } from "../lib/deploy-env.ts";

// loadConfig derives only default paths from the root; any absolute path will do.
const repoRoot = "/srv/sideline";
// install.sh's loopback port (not 8787: `pnpm dev` uses that on the same host).
const port = 8780;
const models = { SIDELINE_MODEL_FAST: "model-a", SIDELINE_MODEL_SMART: "model-b" };

describe("the production environment file (deploy/install.sh, D-066)", () => {
  it("forces the production host, port and mode over whatever .env says", () => {
    const out = renderProductionEnv(
      { HOST: "0.0.0.0", PORT: "9999", NODE_ENV: "development" },
      { repoRoot, port },
    );
    expect(out.text).toContain('\nHOST="127.0.0.1"\n');
    expect(out.text).toContain('\nNODE_ENV="production"\n');
    expect(out.text).toContain('\nPORT="8780"\n');
    expect(out.text).not.toMatch(/0\.0\.0\.0|9999|development/);
    expect(out.forced).toEqual(["HOST", "NODE_ENV", "PORT"]);
    expect(out.copied).toEqual([]);
  });

  it("copies Sideline's own settings and nothing else a developer keeps in .env", () => {
    const out = renderProductionEnv(
      {
        OPENAI_API_KEY: "sk-test-not-a-real-key",
        OPENAI_BASE_URL: "https://llm.example.test/v1",
        ...models,
        SIDELINE_AI_DAILY_BUDGET_USD: "2",
        SIDELINE_DATA_DIR: "/home/dev/elsewhere",
        AWS_SECRET_ACCESS_KEY: "do-not-copy",
        proxy_API_KEY: "do-not-copy-either",
        SIDELINE_ASK_PER_MINUTE: "",
      },
      { repoRoot, port },
    );
    expect(out.copied).toEqual([
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "SIDELINE_AI_DAILY_BUDGET_USD",
      "SIDELINE_MODEL_FAST",
      "SIDELINE_MODEL_SMART",
    ]);
    expect(out.skipped).toEqual(["AWS_SECRET_ACCESS_KEY", "proxy_API_KEY", "SIDELINE_DATA_DIR"]);
    expect(out.text).not.toMatch(/do-not-copy|elsewhere|SIDELINE_ASK_PER_MINUTE/);
    expect(out.text).toContain('\nOPENAI_API_KEY="sk-test-not-a-real-key"\n');
    expect(out.summary).toEqual({
      nodeEnv: "production",
      aiProvider: "openai",
      aiModelFast: "model-a",
      aiModelSmart: "model-b",
      aiEndpointHost: "llm.example.test",
    });
  });

  // systemd's double-quoted form keeps every character once \ " ` $ are escaped (checked against
  // systemd 255 itself with `systemd-run --user -p EnvironmentFile=…`, F07 log).
  it("escapes quotes, backslashes, dollars and backticks, and keeps spaces and #", () => {
    const out = renderProductionEnv(
      { OPENAI_API_KEY: 'a"b\\c$d`e f#g;h', ...models },
      { repoRoot, port },
    );
    expect(out.text).toContain('\nOPENAI_API_KEY="a\\"b\\\\c\\$d\\`e f#g;h"\n');
  });

  it("refuses a value with a line break, naming the variable but not the value", () => {
    const render = () =>
      renderProductionEnv({ OPENAI_API_KEY: "secret-part\nmore", ...models }, { repoRoot, port });
    expect(render).toThrow(/^OPENAI_API_KEY: /);
    expect(render).not.toThrow(/secret-part/);
  });

  it("leaves the keys out with --keyless: recorded AI and labelled fallbacks only", () => {
    const out = renderProductionEnv(
      {
        OPENAI_API_KEY: "sk-test-openai",
        ANTHROPIC_API_KEY: "sk-ant-test",
        SIDELINE_AI_PROVIDER: "openai",
        ...models,
      },
      { repoRoot, port, keyless: true },
    );
    expect(out.text).not.toContain("sk-");
    expect(out.text).toContain('\nSIDELINE_AI_PROVIDER="none"\n');
    expect(out.forced).toEqual(["HOST", "NODE_ENV", "PORT", "SIDELINE_AI_PROVIDER"]);
    expect(out.skipped).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "SIDELINE_AI_PROVIDER"]);
    expect(out.summary.aiProvider).toBe("none");
  });

  it("refuses settings the server would refuse at boot, before systemd ever starts it", () => {
    expect(() =>
      renderProductionEnv({ SIDELINE_AI_PROVIDER: "openai" }, { repoRoot, port }),
    ).toThrow("SIDELINE_AI_PROVIDER=openai but OPENAI_API_KEY is not set");
    expect(() => renderProductionEnv({ PORT: "not-a-port" }, { repoRoot, port })).not.toThrow();
    expect(() =>
      renderProductionEnv({ SIDELINE_AI_DAILY_BUDGET_USD: "lots" }, { repoRoot, port }),
    ).toThrow(/^Invalid environment: SIDELINE_AI_DAILY_BUDGET_USD/);
  });

  it("is keyless when there is no .env, and the same text on every run", () => {
    const first = renderProductionEnv({}, { repoRoot, port });
    expect(first.copied).toEqual([]);
    expect(first.summary.aiProvider).toBe("none");
    expect(renderProductionEnv({}, { repoRoot, port }).text).toBe(first.text);
    expect(first.text.startsWith("# ")).toBe(true);
    expect(first.text.endsWith('PORT="8780"\n')).toBe(true);
  });
});
