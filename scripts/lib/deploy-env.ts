/**
 * The production environment file, /etc/sideline/sideline.env, built from the repository's .env
 * (PLAN Task 7, D-025, D-033, D-066).
 *
 * Callers: scripts/deploy-env.ts, which deploy/install.sh runs as the developer (the owner of the
 * .env, mode 600) and whose output install.sh installs root-owned with mode 600 for systemd's
 * EnvironmentFile=. Only the variables the server reads are copied, so nothing else a developer
 * keeps in .env reaches the service. HOST, PORT and NODE_ENV are forced to the production values:
 * an EnvironmentFile overrides the unit's own Environment= lines, so a development .env must not be
 * able to put the server on a public interface. The data and web paths stay at the deploy
 * checkout's defaults. Values go out in systemd's double-quoted form; a report names variables and
 * never values, and the result is checked with the server's own loadConfig before it is installed.
 */
import {
  type AppConfig,
  loadConfig,
  publicConfigSummary,
  SERVER_ENV_NAMES,
} from "../../apps/server/src/config.ts";

/** Set whatever .env says: loopback only, behind Caddy, on the port install.sh chose. */
const FORCED = new Set(["HOST", "NODE_ENV", "PORT"]);

/** Server settings production leaves at their defaults: paths inside the deploy checkout. */
const CHECKOUT_PATHS = new Set(["SIDELINE_DATA_DIR", "SIDELINE_WEB_DIST"]);

/** What `--keyless` leaves out; it then sets SIDELINE_AI_PROVIDER=none, so no model is ever called. */
const AI_CHOICE = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "SIDELINE_AI_CHAIN",
  "SIDELINE_AI_PROVIDER",
]);

const HEADER = [
  "# Sideline's production settings, read by systemd for sideline.service (EnvironmentFile=).",
  "# Written by deploy/install.sh from the repository's .env: change .env and re-run install.sh",
  "# instead of editing this file. Root-only (mode 600): it holds the AI keys.",
];

export interface ProductionEnv {
  /** The file: a header, then one NAME="value" line per setting, sorted by name. */
  text: string;
  /** Names whose production value is fixed, whatever .env says. */
  forced: string[];
  /** Names copied from .env. */
  copied: string[];
  /** Names in .env that production does not take (not the server's, a checkout path, or a key). */
  skipped: string[];
  /** How the server will describe itself (publicConfigSummary): never a secret. */
  summary: ReturnType<typeof publicConfigSummary>;
}

/** systemd's double-quoted value: everything kept once \ " ` and $ are escaped. */
const quote = (value: string) => `"${value.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;

export function renderProductionEnv(
  source: Readonly<Record<string, string>>,
  opts: { repoRoot: string; port: number; keyless?: boolean },
): ProductionEnv {
  const forcedValues: Record<string, string> = {
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    PORT: String(opts.port),
    ...(opts.keyless ? { SIDELINE_AI_PROVIDER: "none" } : {}),
  };
  const values: Record<string, string> = {};
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const name of Object.keys(source).sort()) {
    const value = source[name] ?? "";
    if (FORCED.has(name)) continue;
    if (
      !SERVER_ENV_NAMES.includes(name) ||
      CHECKOUT_PATHS.has(name) ||
      (opts.keyless && AI_CHOICE.has(name))
    ) {
      skipped.push(name);
      continue;
    }
    // `KEY=` means unset, as it does for the server (config.ts).
    if (value === "") continue;
    if (/[\r\n\0]/.test(value)) {
      throw new Error(
        `${name}: a value with a line break cannot go into a systemd environment file`,
      );
    }
    values[name] = value;
    copied.push(name);
  }
  Object.assign(values, forcedValues);

  // The server's own parser: a setting it would refuse at boot is refused here, before install.
  const config: AppConfig = loadConfig(values, opts.repoRoot);
  const lines = Object.keys(values)
    .sort()
    .map((name) => `${name}=${quote(values[name] ?? "")}`);
  return {
    text: `${[...HEADER, ...lines].join("\n")}\n`,
    forced: Object.keys(forcedValues).sort(),
    copied,
    skipped,
    summary: publicConfigSummary(config),
  };
}
