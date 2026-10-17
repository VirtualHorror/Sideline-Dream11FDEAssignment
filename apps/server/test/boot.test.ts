import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";
import { buildRuntime, createProvider } from "../src/runtime.ts";
import { DATA_DIR } from "./helpers.ts";

const env = { SIDELINE_DATA_DIR: DATA_DIR };

describe("buildRuntime: what src/index.ts boots", () => {
  it("loads data/, rebuilds the analytics tables and runs in replay mode without a key", () => {
    const runtime = buildRuntime(loadConfig(env, "/srv/sideline"), { dbPath: ":memory:" });
    expect([...runtime.bundles.keys()]).toEqual(["1298150", "1415755"]);
    expect(runtime.analytics).toEqual({ deliveries: 251 + 251, players: 60 });
    expect(runtime.replayRows).toBe(0);
    expect(runtime.gateway.mode()).toBe("replay");
    const session = runtime.manager.create({ matchId: "1415755", personaId: "football-fan" });
    expect(runtime.manager.get(session.id)).toBe(session);
  });

  it("serves the API over the booted runtime", async () => {
    const config = loadConfig(env, "/srv/sideline");
    const runtime = buildRuntime(config, { dbPath: ":memory:" });
    const app = createApp({
      config,
      version: "9.9.9",
      startedAt: Date.now(),
      runtime: { ...runtime, askPerMinute: config.ai.askPerMinute },
    });
    const res = await app.request("/api/matches");
    expect(res.status).toBe(200);
  });

  it.each([
    [{ ANTHROPIC_API_KEY: "sk-ant-test" }, "anthropic"],
    [
      {
        OPENAI_API_KEY: "sk-test",
        OPENAI_BASE_URL: "https://api.proxy.pro/v1",
        SIDELINE_MODEL_FAST: "gpt-6.1-sol",
        SIDELINE_MODEL_SMART: "gpt-6.1-sol",
      },
      "openai",
    ],
    [{}, null],
  ])("picks the provider the config names (%j)", (vars, name) => {
    expect(createProvider(loadConfig(vars, "/srv/sideline"))?.name ?? null).toBe(name);
  });
});
