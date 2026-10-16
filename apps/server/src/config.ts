/**
 * Server configuration, parsed once at boot from environment variables.
 *
 * Called by src/index.ts (production/dev boot) and by tests with explicit env objects.
 * Secrets (API keys) live only in the returned config object; anything that leaves the
 * process (health endpoint, logs, SSE hello) must go through publicConfigSummary().
 *
 * Provider selection, in order: SIDELINE_AI_PROVIDER if set, else Anthropic if its key is
 * present, else OpenAI if its key is present, else "none" (deterministic + replay only).
 */
import { join } from "node:path";
import { z } from "zod";

export type AiProviderChoice = "anthropic" | "openai" | "none";

export interface AppConfig {
  nodeEnv: "development" | "production" | "test";
  host: string;
  port: number;
  repoRoot: string;
  dataDir: string;
  webDistDir: string;
  ai: {
    provider: AiProviderChoice;
    anthropicApiKey: string | null;
    openaiApiKey: string | null;
  };
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  SIDELINE_DATA_DIR: z.string().min(1).optional(),
  SIDELINE_WEB_DIST: z.string().min(1).optional(),
  SIDELINE_AI_PROVIDER: z.enum(["anthropic", "openai", "none"]).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
});

type EnvInput = Record<string, string | undefined>;

export function loadConfig(env: EnvInput, repoRoot: string): AppConfig {
  // `KEY=` in a .env file means "unset", not "empty string".
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  const e = parsed.data;

  const anthropicApiKey = e.ANTHROPIC_API_KEY ?? null;
  const openaiApiKey = e.OPENAI_API_KEY ?? null;
  const provider: AiProviderChoice =
    e.SIDELINE_AI_PROVIDER ?? (anthropicApiKey ? "anthropic" : openaiApiKey ? "openai" : "none");

  if (provider === "anthropic" && !anthropicApiKey) {
    throw new Error("SIDELINE_AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
  }
  if (provider === "openai" && !openaiApiKey) {
    throw new Error("SIDELINE_AI_PROVIDER=openai but OPENAI_API_KEY is not set");
  }

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    repoRoot,
    dataDir: e.SIDELINE_DATA_DIR ?? join(repoRoot, "data"),
    webDistDir: e.SIDELINE_WEB_DIST ?? join(repoRoot, "apps", "web", "dist"),
    ai: { provider, anthropicApiKey, openaiApiKey },
  };
}

/** The only view of config that may leave the process. No secrets, ever. */
export function publicConfigSummary(config: AppConfig): {
  nodeEnv: string;
  aiProvider: AiProviderChoice;
} {
  return { nodeEnv: config.nodeEnv, aiProvider: config.ai.provider };
}
