/**
 * Prints the production environment file for deploy/install.sh (PLAN Task 7, D-066): the file on
 * stdout, a report of variable names (never values) on stderr.
 *
 * Usage: node scripts/deploy-env.ts --port <port> [--env-file <path>] [--keyless]
 *   --port       the server's loopback port, the one the Caddyfile proxies to (install.sh's PORT)
 *   --env-file   the .env to read (default: this repository's .env; none means a keyless install)
 *   --keyless    leave the AI keys out and set SIDELINE_AI_PROVIDER=none: recorded AI and labelled
 *                fallbacks only, never a paid call
 *
 * The .env is parsed with Node's own parser, the one `--env-file` uses for `pnpm dev`, so
 * production reads what development reads. Exit 1 (naming the variable, never its value) when a
 * setting cannot be written or the server would refuse it at boot.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { describeAiChain } from "../apps/server/src/config.ts";
import { renderProductionEnv } from "./lib/deploy-env.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    "env-file": { type: "string" },
    keyless: { type: "boolean", default: false },
    port: { type: "string" },
  },
});
const envFile = args["env-file"] ?? join(repoRoot, ".env");

try {
  const parsed = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const source = Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`--port needs the server's port (got ${args.port ?? "nothing"})`);
  }
  const out = renderProductionEnv(source, { repoRoot, port, keyless: args.keyless });
  process.stdout.write(out.text);
  const list = (names: string[]) => (names.length > 0 ? names.join(", ") : "none");
  console.error(`deploy-env: from ${existsSync(envFile) ? envFile : "no .env (keyless)"}`);
  console.error(`deploy-env: forced ${list(out.forced)}`);
  console.error(`deploy-env: copied ${list(out.copied)}`);
  console.error(`deploy-env: not copied ${list(out.skipped)}`);
  console.error(
    `deploy-env: the server will run with provider ${out.summary.aiProvider}, models ${out.summary.aiModelFast ?? "none"} / ${out.summary.aiModelSmart ?? "none"}, endpoint ${out.summary.aiEndpoint ?? "none"}`,
  );
  if (out.summary.aiChain) {
    console.error(`deploy-env: AI chain ${describeAiChain(out.summary.aiChain)}`);
  }
} catch (error) {
  console.error(`deploy-env: ${(error as Error).message}`);
  process.exit(1);
}
