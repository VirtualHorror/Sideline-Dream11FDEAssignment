/**
 * Process entry point. Run directly with Node 24 (native TypeScript type stripping):
 *   node --env-file-if-exists=.env apps/server/src/index.ts      (or `pnpm start` from the repo root)
 *
 * Boot order: resolve repo root -> parse config (fails fast on bad env) -> build the runtime (data,
 * glossary, SQLite, provider, gateway, sessions; fails fast on bad data) -> start the one session
 * ticker -> build the app -> listen. SIGINT/SIGTERM stop the ticker, close open streams and the
 * database, then exit.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { describeAiChain, loadConfig, publicConfigSummary } from "./config.ts";
import { createApp } from "./http/app.ts";
import { buildRuntime } from "./runtime.ts";
import { startTicker } from "./sessions/ticker.ts";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};

const config = loadConfig(process.env, repoRoot);
const runtime = buildRuntime(config);
const stopTicker = startTicker(runtime.manager);
const app = createApp({
  config,
  version,
  startedAt: Date.now(),
  runtime: {
    bundles: runtime.bundles,
    manager: runtime.manager,
    telemetry: runtime.telemetry,
    askPerMinute: config.ai.askPerMinute,
  },
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `[sideline] v${version} listening on http://${info.address}:${info.port}`,
    publicConfigSummary(config),
    {
      matches: [...runtime.bundles.keys()].length,
      analyticsRows: runtime.analytics.deliveries,
      replayRows: runtime.replayRows,
      aiMode: runtime.gateway.mode(),
    },
  );
  const { aiChain } = publicConfigSummary(config);
  if (aiChain) console.log(`[sideline] AI chain ${describeAiChain(aiChain)}`);
});

function shutdown(signal: string): void {
  console.log(`[sideline] ${signal}: shutting down`);
  stopTicker();
  // SSE streams never end on their own: close them so the server can stop.
  if ("closeAllConnections" in server) server.closeAllConnections();
  server.close(() => {
    runtime.db.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
