import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AICallTraceSchema } from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createBudget } from "../src/ai/budget.ts";
import { createCache } from "../src/ai/cache.ts";
import { createGateway, type GatewayDeps } from "../src/ai/gateway.ts";
import { costOf } from "../src/ai/pricing.ts";
import { loadReplayRows } from "../src/ai/providers/replay.ts";
import { createScriptedProvider } from "../src/ai/providers/scripted.ts";
import { ProviderRefusalError } from "../src/ai/providers/types.ts";
import type { Skill } from "../src/ai/skills/types.ts";
import { openDatabase } from "../src/db/database.ts";
import { createTraceSink } from "../src/telemetry/collector.ts";
import { fakeClock } from "./helpers.ts";

// A minimal skill: the gateway is the unit under test, not a real skill's prompt or guard.
interface EchoFacts {
  word: string;
}
const echoSkill: Skill<EchoFacts, { text: string }, { text: string; from: string }> = {
  name: "echo",
  promptVersion: "echo-v1",
  tier: "fast",
  effort: "low",
  maxTokens: 200,
  timeoutMs: () => 40,
  outputSchema: z.strictObject({ text: z.string().max(40) }),
  buildPrompt: (facts) => ({ system: "Repeat the word.", user: `<facts>${facts.word}</facts>` }),
  guard: (out) =>
    out.text.includes("forbidden") ? { ok: false, reason: "forbidden word" } : { ok: true },
  toPayload: (out) => ({ text: out.text, from: "model" }),
  fallback: (facts) => ({ text: facts.word, from: "template" }),
};

function setup(
  opts: {
    script?: Parameters<typeof createScriptedProvider>[0];
    noProvider?: boolean;
    dailyUsd?: number;
    sessionCap?: number;
    model?: string;
  } = {},
) {
  const clock = fakeClock();
  const db = openDatabase(":memory:");
  const provider = createScriptedProvider(
    opts.script ?? ((req) => ({ text: `${req.user.length}` })),
    {
      tokensIn: 1000,
      tokensOut: 100,
    },
  );
  const traces = createTraceSink(db);
  const deps: GatewayDeps = {
    provider: opts.noProvider ? null : provider,
    cache: createCache(db, clock.now),
    budget: createBudget({
      db,
      dailyUsd: opts.dailyUsd ?? 3,
      sessionCap: opts.sessionCap ?? 80,
      now: clock.now,
    }),
    traces,
    models: { fast: opts.model ?? "gpt-test-fast", smart: "gpt-test" },
    pricing: { inPerMTok: 5, outPerMTok: 20 },
    now: clock.now,
  };
  const gateway = createGateway(deps);
  const rows = () =>
    db.prepare("SELECT outcome, cache, detail FROM ai_calls ORDER BY rowid").all() as {
      outcome: string;
      cache: string;
      detail: string | null;
    }[];
  return { gateway, provider, db, clock, rows };
}

describe("gateway: the happy path and the cache (PLAN 5.4)", () => {
  it("makes one live call, validates it, caches it and writes one trace", async () => {
    const { gateway, provider, rows } = setup();
    const result = await gateway.run(echoSkill, "echo:a", { word: "a" });
    expect(result.provenance).toBe("live");
    expect(result.payload).toEqual({ text: "16", from: "model" });
    expect(AICallTraceSchema.parse(result.trace)).toMatchObject({
      skill: "echo",
      momentKey: "echo:a",
      provider: "scripted",
      model: "gpt-test-fast",
      cache: "miss",
      outcome: "ok",
      tokensIn: 1000,
      tokensOut: 100,
      // 1000 in at $5/M + 100 out at $20/M (the configured prices: an unknown model is an estimate)
      costUsd: 0.007,
      costEstimated: true,
      promptVersion: "echo-v1",
      startedAtWall: "2026-10-16T12:00:00.000Z",
      budgetMs: null,
      detail: null,
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({ skill: "echo", key: "echo:a", effort: "low" });
    expect(rows()).toEqual([{ outcome: "ok", cache: "miss", detail: null }]);
  });

  it("serves a cache hit with no provider call", async () => {
    const { gateway, provider, rows } = setup();
    await gateway.run(echoSkill, "echo:a", { word: "a" });
    const again = await gateway.run(echoSkill, "echo:a", { word: "a" });
    expect(again.provenance).toBe("cache");
    expect(again.payload).toEqual({ text: "16", from: "model" });
    expect(again.trace).toMatchObject({ cache: "hit", outcome: "ok", tokensIn: 0, costUsd: 0 });
    expect(provider.requests).toHaveLength(1);
    expect(rows().map((r) => r.cache)).toEqual(["miss", "hit"]);
    expect(gateway.counters()).toMatchObject({ aiCallsLive: 1, aiCacheHits: 1, aiFallbacks: 0 });
  });

  it("makes one provider call for two concurrent runs of one key", async () => {
    let release: (value: { text: string }) => void = () => {};
    const { gateway, provider, rows } = setup({
      script: () => new Promise((resolve) => (release = resolve)),
    });
    const first = gateway.run(echoSkill, "echo:b", { word: "b" });
    const second = gateway.run(echoSkill, "echo:b", { word: "b" });
    await Promise.resolve();
    release({ text: "bee" });
    const [a, b] = await Promise.all([first, second]);
    expect(provider.requests).toHaveLength(1);
    expect([a.provenance, b.provenance]).toEqual(["live", "cache"]);
    expect(b.payload).toEqual({ text: "bee", from: "model" });
    expect(rows()).toHaveLength(2);
    expect(b.trace.tokensIn).toBe(0);
  });

  it("prices a model with a built-in price exactly, from reported usage", async () => {
    const { gateway } = setup({ model: "claude-opus-5-5" });
    const result = await gateway.run(echoSkill, "echo:c", { word: "c" });
    // 1000 × $4/M + 100 × $20/M
    expect(result.trace).toMatchObject({ costUsd: 0.006, costEstimated: false });
    expect(
      costOf("claude-haiku-5-5", 1_000_000, 1_000_000, { inPerMTok: 5, outPerMTok: 20 }),
    ).toEqual({ usd: 0.6, estimated: false });
  });
});

describe("gateway: what providers see, and which rows answer", () => {
  it("sends a JSON schema without the keywords strict modes reject; zod still enforces them", async () => {
    const { gateway, provider } = setup({ script: () => ({ text: "x".repeat(41) }) });
    const result = await gateway.run(echoSkill, "echo:long", { word: "long" });
    expect(provider.requests[0]?.jsonSchema).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    });
    // 41 characters against max(40): refused by zod, though the provider never saw the limit.
    expect(result.trace.outcome).toBe("error");
  });

  it("serves a live row only for the configured model, a replay row for any model", async () => {
    const { gateway, provider, db, clock } = setup();
    const cache = createCache(db, clock.now);
    cache.putLive("echo:other", "echo-v1", "some-other-model", { text: "stale" });
    const other = await gateway.run(echoSkill, "echo:other", { word: "other" });
    expect(other.provenance).toBe("live");
    expect(provider.requests).toHaveLength(1);
    cache.putReplay("echo:rec", "echo-v1", "recorded-model", { text: "recorded" });
    const replayed = await gateway.run(echoSkill, "echo:rec", { word: "rec" });
    expect(replayed.provenance).toBe("replay");
    cache.putLive("echo:both", "echo-v1", "gpt-test-fast", { text: "live row" });
    cache.putReplay("echo:both", "echo-v1", "recorded-model", { text: "replay row" });
    const both = await gateway.run(echoSkill, "echo:both", { word: "both" });
    expect([both.provenance, both.payload.text]).toEqual(["cache", "live row"]);
    expect(provider.requests).toHaveLength(1);
  });

  // D-079: a chain's link, or Anthropic's server-side fallback, can answer with another model than
  // the configured one. The row stays keyed by the configured model and remembers the one that wrote it.
  it("remembers which model wrote a cached answer, and a cache hit names it", async () => {
    const clock = fakeClock();
    const db = openDatabase(":memory:");
    const gateway = createGateway({
      provider: {
        name: "anthropic",
        complete: async () => ({
          output: { text: "ok" },
          tokensIn: 10,
          tokensOut: 1,
          model: "claude-opus-5",
        }),
      },
      cache: createCache(db, clock.now),
      budget: createBudget({ db, dailyUsd: 3, sessionCap: 80, now: clock.now }),
      traces: createTraceSink(db),
      models: { fast: "claude-opus-5-5", smart: "claude-opus-5-5" },
      pricing: { inPerMTok: 5, outPerMTok: 20 },
      now: clock.now,
    });
    const live = await gateway.run(echoSkill, "echo:served", { word: "served" });
    expect(live.trace.model).toBe("claude-opus-5");
    const hit = await gateway.run(echoSkill, "echo:served", { word: "served" });
    expect([hit.provenance, hit.trace.model]).toEqual(["cache", "claude-opus-5"]);
    expect(db.prepare("SELECT model, served_model FROM ai_cache").all()).toEqual([
      { model: "claude-opus-5-5", served_model: "claude-opus-5" },
    ]);
  });
});

describe("pricing the AI chain's models (D-079)", () => {
  // Paid-tier list prices per million tokens (Groq's model pages and Gemini's pricing page, read
  // 2026-10-19); the free tiers bill nothing, so these say what the traffic would cost if paid.
  it.each([
    ["qwen/qwen3.8-27b", 0.8 + 4],
    ["openai/gpt-oss-20b", 0.075 + 0.3],
    ["openai/gpt-oss-120b", 0.15 + 0.6],
    ["gemini-3.5-flash-lite", 0.3 + 2.5],
    ["gemini-3.5-flash", 0.75 + 3.75],
    ["gemini-3.6-flash", 0.75 + 3.75],
  ])("prices %s at its list price, not as an estimate", (model, perMillionEach) => {
    const cost = costOf(model, 1_000_000, 1_000_000, { inPerMTok: 5, outPerMTok: 20 });
    expect(cost.usd).toBeCloseTo(perMillionEach, 10);
    expect(cost.estimated).toBe(false);
  });
});

describe("gateway: every failure falls back, labelled, with one matching trace (Review focus 2)", () => {
  const fellBack = (result: { payload: unknown; provenance: string }, word: string) => {
    expect(result.provenance).toBe("fallback");
    expect(result.payload).toEqual({ text: word, from: "template" });
  };

  it("timeout: a provider that never answers", async () => {
    const { gateway, rows } = setup({ script: () => new Promise(() => {}) });
    const result = await gateway.run(echoSkill, "echo:t", { word: "t" });
    fellBack(result, "t");
    expect(result.trace).toMatchObject({ outcome: "timeout", detail: "no answer within 40 ms" });
    expect(rows()).toHaveLength(1);
    expect(gateway.counters()).toMatchObject({ aiCallsLive: 1, aiFallbacks: 1 });
  });

  it("refusal: the model declined, and its tokens still count", async () => {
    const { gateway } = setup({
      script: () => {
        throw new ProviderRefusalError("refused (category: cyber)", {
          tokensIn: 900,
          tokensOut: 0,
        });
      },
    });
    const result = await gateway.run(echoSkill, "echo:r", { word: "r" });
    fellBack(result, "r");
    expect(result.trace).toMatchObject({
      outcome: "refused",
      tokensIn: 900,
      detail: "refused (category: cyber)",
    });
    expect(gateway.counters()).toMatchObject({ aiFallbacks: 1, tokensIn: 900 });
  });

  it("schema-invalid output", async () => {
    const { gateway } = setup({ script: () => ({ text: 42 }) });
    const result = await gateway.run(echoSkill, "echo:i", { word: "i" });
    fellBack(result, "i");
    expect(result.trace.outcome).toBe("error");
    expect(result.trace.detail).toMatch(/^invalid output: text: /);
  });

  it("guard failure, which is not cached: the next run asks again", async () => {
    const { gateway, provider } = setup({ script: () => ({ text: "forbidden" }) });
    const result = await gateway.run(echoSkill, "echo:g", { word: "g" });
    fellBack(result, "g");
    expect(result.trace).toMatchObject({ outcome: "fallback", detail: "guard: forbidden word" });
    await gateway.run(echoSkill, "echo:g", { word: "g" });
    expect(provider.requests).toHaveLength(2);
  });

  it("missing provider", async () => {
    const { gateway, rows } = setup({ noProvider: true });
    const result = await gateway.run(echoSkill, "echo:n", { word: "n" });
    fellBack(result, "n");
    expect(result.trace).toMatchObject({
      provider: "none",
      model: null,
      outcome: "fallback",
      detail: "no provider configured and no recorded output",
    });
    expect(rows()).toHaveLength(1);
    expect(gateway.mode()).toBe("replay");
  });

  it("exhausted daily budget: no call, aiMode replay", async () => {
    const { gateway, provider } = setup({ dailyUsd: 0 });
    const result = await gateway.run(echoSkill, "echo:d", { word: "d" });
    fellBack(result, "d");
    expect(result.trace).toMatchObject({
      outcome: "budget",
      detail: "daily budget of $0.00 spent",
    });
    expect(provider.requests).toHaveLength(0);
    expect(gateway.mode()).toBe("replay");
  });

  it("the daily budget counts spend already recorded today and cuts off once it is reached", async () => {
    // Each call costs $0.007 at the configured prices: a $0.01 budget allows two calls.
    const { gateway, provider } = setup({ dailyUsd: 0.01 });
    await gateway.run(echoSkill, "echo:1", { word: "1" });
    await gateway.run(echoSkill, "echo:2", { word: "2" });
    const third = await gateway.run(echoSkill, "echo:3", { word: "3" });
    expect(provider.requests).toHaveLength(2);
    expect(third.trace.outcome).toBe("budget");
  });

  it("a session over its call cap falls back; other sessions and cached keys are unaffected", async () => {
    const { gateway, provider } = setup({ sessionCap: 1 });
    await gateway.run(echoSkill, "echo:s1", { word: "s1" }, { sessionId: "A" });
    const capped = await gateway.run(echoSkill, "echo:s2", { word: "s2" }, { sessionId: "A" });
    expect(capped.trace).toMatchObject({
      outcome: "budget",
      detail: "session cap of 1 calls reached",
    });
    const cached = await gateway.run(echoSkill, "echo:s1", { word: "s1" }, { sessionId: "A" });
    expect(cached.provenance).toBe("cache");
    const other = await gateway.run(echoSkill, "echo:s2", { word: "s2" }, { sessionId: "B" });
    expect(other.provenance).toBe("live");
    expect(provider.requests).toHaveLength(2);
  });

  it("a provider that ignores the abort signal still times out", async () => {
    const { gateway } = setup({
      script: () => new Promise((resolve) => setTimeout(() => resolve({ text: "late" }), 400)),
    });
    const started = Date.now();
    const result = await gateway.run(echoSkill, "echo:slow", { word: "slow" });
    expect(result.trace.outcome).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("records the caller's latency budget on the trace", async () => {
    const { gateway } = setup();
    const result = await gateway.run(echoSkill, "echo:b", { word: "b" }, { deadlineMs: 1234 });
    expect(result.trace.budgetMs).toBe(1234);
  });
});

describe("replay rows (keyless mode)", () => {
  it("serves recorded outputs with provenance replay and falls back on a miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sideline-replay-"));
    writeFileSync(
      join(dir, "echo.jsonl"),
      `${JSON.stringify({ key: "echo:rec", promptVersion: "echo-v1", model: "gpt-x", output: { text: "recorded" } })}\n`,
    );
    const { gateway, db } = setup({ noProvider: true });
    expect(
      loadReplayRows(
        dir,
        createCache(db, () => 0),
      ),
    ).toBe(1);
    const hit = await gateway.run(echoSkill, "echo:rec", { word: "rec" });
    expect(hit.provenance).toBe("replay");
    expect(hit.payload).toEqual({ text: "recorded", from: "model" });
    expect(hit.trace).toMatchObject({ provider: "replay", cache: "hit", outcome: "ok" });
    const miss = await gateway.run(echoSkill, "echo:none", { word: "none" });
    expect(miss.provenance).toBe("fallback");
  });

  it("refuses a malformed replay file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sideline-replay-"));
    writeFileSync(join(dir, "bad.jsonl"), '{"key":"k"}\n');
    const { db } = setup({ noProvider: true });
    const load = () =>
      loadReplayRows(
        dir,
        createCache(db, () => 0),
      );
    expect(load).toThrow(/bad\.jsonl:1/);
    writeFileSync(join(dir, "bad.jsonl"), '\n{"key":"k", oops\n');
    expect(load).toThrow(/bad\.jsonl:2: invalid replay row: not JSON/);
  });
});

describe("the AI mode follows the provider's last answer (D-071, F07 follow-up 3)", () => {
  /** What the OpenAI SDK throws when the account has no credit: an error with a status and a code. */
  const outOfCredit = () =>
    Object.assign(new Error("403 key_expired"), { status: 403, code: "key_expired" });

  it("a provider error turns the mode to replay, and its next answer turns it back to live", async () => {
    let failing = true;
    const { gateway } = setup({
      script: () => {
        if (failing) throw outOfCredit();
        return { text: "back" };
      },
    });
    expect(gateway.mode()).toBe("live");
    const failed = await gateway.run(echoSkill, "echo:h1", { word: "h1" });
    expect(failed.provenance).toBe("fallback");
    expect(failed.trace.detail).toBe("provider error: Error (403, key_expired)");
    expect(gateway.mode()).toBe("replay");
    failing = false;
    const answered = await gateway.run(echoSkill, "echo:h2", { word: "h2" });
    expect(answered.provenance).toBe("live");
    expect(gateway.mode()).toBe("live");
  });

  it("an answer the guard rejects, a refusal or invalid output still means the provider answered", async () => {
    const answers: (() => unknown)[] = [
      () => {
        throw outOfCredit();
      },
      () => ({ text: "forbidden" }),
      () => {
        throw outOfCredit();
      },
      () => {
        throw new ProviderRefusalError("declined", { tokensIn: 10, tokensOut: 0 });
      },
      () => {
        throw outOfCredit();
      },
      () => ({ text: 42 }),
    ];
    let next = 0;
    const { gateway } = setup({ script: () => answers[next++]?.() });
    const modes: string[] = [];
    for (const word of ["a", "b", "c", "d", "e", "f"]) {
      await gateway.run(echoSkill, `echo:${word}`, { word });
      modes.push(gateway.mode());
    }
    expect(modes).toEqual(["replay", "live", "replay", "live", "replay", "live"]);
  });

  it("a timeout says nothing about the provider: the mode stays as it was", async () => {
    let first = true;
    const { gateway } = setup({
      script: (_req, signal) => {
        if (first) {
          first = false;
          throw outOfCredit();
        }
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      },
    });
    await gateway.run(echoSkill, "echo:t1", { word: "t1" });
    expect(gateway.mode()).toBe("replay");
    const slow = await gateway.run(echoSkill, "echo:t2", { word: "t2" });
    expect(slow.trace.outcome).toBe("timeout");
    expect(gateway.mode()).toBe("replay");
  });

  it("starts from the provider's last answer on record, so a restart keeps a failing key in replay mode", () => {
    const { db, clock } = setup();
    const base = {
      provider: createScriptedProvider(() => ({ text: "x" })),
      cache: createCache(db, clock.now),
      budget: createBudget({ db, dailyUsd: 3, sessionCap: 80, now: clock.now }),
      traces: createTraceSink(db),
      models: { fast: "gpt-test-fast", smart: "gpt-test" },
      pricing: { inPerMTok: 5, outPerMTok: 20 },
      now: clock.now,
    };
    expect(createGateway({ ...base, providerAnswering: false }).mode()).toBe("replay");
    expect(createGateway({ ...base, providerAnswering: true }).mode()).toBe("live");
    expect(createGateway({ ...base, providerAnswering: null }).mode()).toBe("live");
  });
});

describe("TraceSink.lastProviderAnswer: the provider's last answer, read back from ai_calls (D-071)", () => {
  it("is null before any call, false after a provider error, true after an answer; other runs do not count", async () => {
    let failing = true;
    const { gateway, db } = setup({
      script: () => {
        if (failing) throw Object.assign(new Error("down"), { status: 503 });
        return { text: "ok" };
      },
    });
    const sink = createTraceSink(db);
    expect(sink.lastProviderAnswer()).toBeNull();
    await gateway.run(echoSkill, "echo:s1", { word: "s1" });
    expect(sink.lastProviderAnswer()).toBe(false);
    failing = false;
    await gateway.run(echoSkill, "echo:s2", { word: "s2" });
    expect(sink.lastProviderAnswer()).toBe(true);
    failing = true;
    await gateway.run(echoSkill, "echo:s3", { word: "s3" });
    // A cache hit and a run sharing another's call make no call of their own: the error still stands.
    await gateway.run(echoSkill, "echo:s2", { word: "s2" });
    await Promise.all([
      gateway.run(echoSkill, "echo:s4", { word: "s4" }),
      gateway.run(echoSkill, "echo:s4", { word: "s4" }),
    ]);
    expect(sink.lastProviderAnswer()).toBe(false);
  });
});
