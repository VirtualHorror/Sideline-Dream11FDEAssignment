/**
 * Server configuration, parsed once at boot from environment variables.
 *
 * Called by src/index.ts (production/dev boot), scripts/ai-smoke.ts, and by tests with explicit env
 * objects. Secrets (API keys) live only in the returned config object; anything that leaves the
 * process (health endpoint, logs, SSE hello) must go through publicConfigSummary().
 *
 * Provider selection, in order: SIDELINE_AI_PROVIDER if set, else Anthropic if its key is
 * present, else OpenAI if its key is present, else "none" (deterministic + replay only), D-033.
 * Model names: Anthropic defaults to claude-opus-5-5 for both tiers; an OpenAI-compatible endpoint
 * names its models its own way (today's proxy: gpt-6.1-sol), so both tiers must be set for it.
 */
import { join } from "node:path";
import { z } from "zod";

export type AiProviderChoice = "anthropic" | "openai" | "none";

/** The Anthropic default for both tiers (PLAN Task 5); SIDELINE_MODEL_FAST/SMART override it. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";
/** The SDKs' own endpoints, passed explicitly so no stray *_BASE_URL variable can redirect them. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

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
    /** OpenAI-compatible endpoint; null means the SDK's default (api.openai.com). */
    openaiBaseUrl: string | null;
    /** Model per skill tier; null when no provider is configured (replay rows match any model). */
    models: { fast: string; smart: string } | null;
    /** USD per million tokens for models without a built-in price (costs flagged as estimates). */
    pricing: { inPerMTok: number; outPerMTok: number };
    /** Daily cap on model spend; above it the gateway serves replay rows and fallbacks only. */
    dailyBudgetUsd: number;
    /** Fan questions per minute per IP (token bucket, see http/middleware/rateLimit.ts). */
    askPerMinute: number;
    /** Provider calls one session may start (shared moments are cached for everyone else). */
    sessionAiCap: number;
  };
}

const nonNegative = z.coerce.number().nonnegative();
const positiveInt = z.coerce.number().int().positive();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  SIDELINE_DATA_DIR: z.string().min(1).optional(),
  SIDELINE_WEB_DIST: z.string().min(1).optional(),
  SIDELINE_AI_PROVIDER: z.enum(["anthropic", "openai", "none"]).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  SIDELINE_MODEL_FAST: z.string().min(1).optional(),
  SIDELINE_MODEL_SMART: z.string().min(1).optional(),
  SIDELINE_PRICE_IN_PER_MTOK: nonNegative.default(5),
  SIDELINE_PRICE_OUT_PER_MTOK: nonNegative.default(20),
  SIDELINE_AI_DAILY_BUDGET_USD: nonNegative.default(3),
  SIDELINE_ASK_PER_MINUTE: positiveInt.default(12),
  SIDELINE_SESSION_AI_CAP: positiveInt.default(80),
});

/** Every variable the server reads: deploy/install.sh copies only these from .env (D-066). */
export const SERVER_ENV_NAMES: readonly string[] = Object.keys(EnvSchema.shape);

type EnvInput = Record<string, string | undefined>;

function modelsFor(
  provider: AiProviderChoice,
  fast: string | undefined,
  smart: string | undefined,
): AppConfig["ai"]["models"] {
  if (provider === "none") return null;
  if (provider === "anthropic") {
    // The model variables are shared with the OpenAI-compatible provider (.env.example), so a
    // leftover endpoint-specific name would fail every call: refuse it at boot instead.
    for (const [name, value] of [
      ["SIDELINE_MODEL_FAST", fast],
      ["SIDELINE_MODEL_SMART", smart],
    ] as const) {
      if (value !== undefined && !value.startsWith("claude-")) {
        throw new Error(
          `${name}=${value} is not a Claude model, but the provider is anthropic: unset it or set SIDELINE_AI_PROVIDER=openai`,
        );
      }
    }
    return { fast: fast ?? ANTHROPIC_DEFAULT_MODEL, smart: smart ?? ANTHROPIC_DEFAULT_MODEL };
  }
  if (!fast) throw new Error("SIDELINE_AI_PROVIDER=openai needs SIDELINE_MODEL_FAST");
  if (!smart) throw new Error("SIDELINE_AI_PROVIDER=openai needs SIDELINE_MODEL_SMART");
  return { fast, smart };
}

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
    ai: {
      provider,
      anthropicApiKey,
      openaiApiKey,
      openaiBaseUrl: e.OPENAI_BASE_URL ?? null,
      models: modelsFor(provider, e.SIDELINE_MODEL_FAST, e.SIDELINE_MODEL_SMART),
      pricing: {
        inPerMTok: e.SIDELINE_PRICE_IN_PER_MTOK,
        outPerMTok: e.SIDELINE_PRICE_OUT_PER_MTOK,
      },
      dailyBudgetUsd: e.SIDELINE_AI_DAILY_BUDGET_USD,
      askPerMinute: e.SIDELINE_ASK_PER_MINUTE,
      sessionAiCap: e.SIDELINE_SESSION_AI_CAP,
    },
  };
}

/**
 * What kind of endpoint the provider calls: the vendor's own API, or "openai-compatible" for any
 * other OpenAI base URL. Its host is configuration and is never published (D-068).
 */
export type AiEndpointKind = "anthropic" | "openai" | "openai-compatible";

export function aiEndpointKind(config: AppConfig): AiEndpointKind | null {
  if (config.ai.provider === "anthropic") return "anthropic";
  if (config.ai.provider !== "openai") return null;
  const base = config.ai.openaiBaseUrl;
  return base === null || new URL(base).hostname === new URL(OPENAI_DEFAULT_BASE_URL).hostname
    ? "openai"
    : "openai-compatible";
}

/** The only view of config that may leave the process: no secrets, no hosts, no paths, ever. */
export function publicConfigSummary(config: AppConfig): {
  nodeEnv: string;
  aiProvider: AiProviderChoice;
  aiModelFast: string | null;
  aiModelSmart: string | null;
  aiEndpoint: AiEndpointKind | null;
} {
  return {
    nodeEnv: config.nodeEnv,
    aiProvider: config.ai.provider,
    aiModelFast: config.ai.models?.fast ?? null,
    aiModelSmart: config.ai.models?.smart ?? null,
    aiEndpoint: aiEndpointKind(config),
  };
}
