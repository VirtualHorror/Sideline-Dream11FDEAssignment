import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScriptedProvider } from "../src/ai/providers/scripted.ts";
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

  it("a key whose last call failed boots in replay mode, read from the database (D-071)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sideline-boot-"));
    const dbPath = join(dir, "sideline.db");
    const keyed = loadConfig(
      {
        ...env,
        OPENAI_API_KEY: "sk-test",
        OPENAI_BASE_URL: "https://llm-proxy.example.test/v1",
        SIDELINE_MODEL_FAST: "model-fast",
        SIDELINE_MODEL_SMART: "model-smart",
      },
      "/srv/sideline",
    );
    const failing = createScriptedProvider(() => {
      throw Object.assign(new Error("403"), { status: 403 });
    });
    const first = buildRuntime(keyed, { dbPath, provider: failing, replayDir: null });
    expect(first.gateway.mode()).toBe("live");
    const session = first.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    await session.settle();
    expect(first.gateway.mode()).toBe("replay");
    first.db.close();
    const answering = createScriptedProvider(() => ({}));
    const restarted = buildRuntime(keyed, { dbPath, provider: answering, replayDir: null });
    expect(restarted.gateway.mode()).toBe("replay");
    restarted.db.close();
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
        OPENAI_BASE_URL: "https://llm-proxy.example.test/v1",
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
