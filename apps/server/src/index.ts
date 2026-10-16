/**
 * Process entry point. Run directly with Node 24 (native TypeScript type stripping):
 *   node --env-file-if-exists=.env apps/server/src/index.ts      (or `pnpm start` from the repo root)
 *
 * Boot order: resolve repo root -> parse config (fails fast on bad env) -> build app -> listen.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { loadConfig, publicConfigSummary } from "./config.ts";
import { createApp } from "./http/app.ts";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  version: string;
};

const config = loadConfig(process.env, repoRoot);
const app = createApp({ config, version, startedAt: Date.now() });

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `[sideline] v${version} listening on http://${info.address}:${info.port}`,
    publicConfigSummary(config),
  );
});
