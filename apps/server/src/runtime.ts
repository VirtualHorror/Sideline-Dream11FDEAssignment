/**
 * Assembles the server's runtime from its config: data bundles, the glossary, SQLite (analytics
 * rebuilt, replay rows loaded), the provider the config names, the gateway, telemetry, the
 * orchestrator and the session manager.
 *
 * Callers: src/index.ts (boot), scripts/ai-smoke.ts and scripts/lib/record.ts (`pnpm ai:record`,
 * with its own provider and replay directory). Everything that touches data/ fails here,
 * at boot, with the file named; nothing below this is started (the ticker and the HTTP server
 * belong to index.ts).
 */
import { join } from "node:path";
import { createBudget } from "./ai/budget.ts";
import { createCache } from "./ai/cache.ts";
import { createGateway } from "./ai/gateway.ts";
import { createAnthropicProvider } from "./ai/providers/anthropic.ts";
import { createOpenAiProvider } from "./ai/providers/openai.ts";
import { loadReplayRows } from "./ai/providers/replay.ts";
import type { LlmProvider } from "./ai/providers/types.ts";
import type { AppConfig } from "./config.ts";
import { loadMatchBundles } from "./data/bundle.ts";
import { loadGlossary } from "./data/glossary.ts";
import { openDatabase, rebuildAnalytics } from "./db/database.ts";
import { createOrchestrator } from "./orchestrator/orchestrator.ts";
import { createSessionManager } from "./sessions/manager.ts";
import { createTelemetry, createTraceSink } from "./telemetry/collector.ts";

/** The provider the config selected, or null (no key: replay rows and labelled fallbacks). */
export function createProvider(config: AppConfig): LlmProvider | null {
  const { ai } = config;
  if (ai.provider === "anthropic" && ai.anthropicApiKey) {
    return createAnthropicProvider({ apiKey: ai.anthropicApiKey });
  }
  if (ai.provider === "openai" && ai.openaiApiKey) {
    return createOpenAiProvider({ apiKey: ai.openaiApiKey, baseURL: ai.openaiBaseUrl });
  }
  return null;
}

export function buildRuntime(
  config: AppConfig,
  opts: {
    now?: () => number;
    dbPath?: string;
    /** Overrides the provider the config names (scripts/lib/record.ts: none, or the scripted one). */
    provider?: LlmProvider | null;
    /** Where recorded rows are read from (default data/ai-replay); null reads none. */
    replayDir?: string | null;
  } = {},
) {
  const now = opts.now ?? Date.now;
  const bundles = loadMatchBundles(config.dataDir);
  const glossary = loadGlossary(config.dataDir);
  const db = openDatabase(opts.dbPath ?? join(config.dataDir, "runtime", "sideline.db"));
  const analytics = rebuildAnalytics(db, bundles);
  const cache = createCache(db, now);
  const replayDir =
    opts.replayDir === undefined ? join(config.dataDir, "ai-replay") : opts.replayDir;
  const replayRows = replayDir === null ? 0 : loadReplayRows(replayDir, cache);
  const traces = createTraceSink(db);
  const telemetry = createTelemetry({
    traces,
    eventsPerMatch: new Map([...bundles].map(([id, bundle]) => [id, bundle.events.length])),
  });
  const gateway = createGateway({
    provider: opts.provider === undefined ? createProvider(config) : opts.provider,
    cache,
    budget: createBudget({
      db,
      dailyUsd: config.ai.dailyBudgetUsd,
      sessionCap: config.ai.sessionAiCap,
      now,
    }),
    traces,
    models: config.ai.models,
    pricing: config.ai.pricing,
    now,
  });
  const orchestrator = createOrchestrator({ gateway, glossary, telemetry, bundles });
  const manager = createSessionManager({
    bundles,
    orchestrator,
    telemetry,
    aiMode: () => gateway.mode(),
    now,
  });
  return {
    bundles,
    glossary,
    db,
    analytics,
    replayRows,
    gateway,
    telemetry,
    orchestrator,
    manager,
  };
}
