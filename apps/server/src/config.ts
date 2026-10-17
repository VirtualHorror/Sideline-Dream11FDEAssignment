/**
 * Server configuration, parsed once at boot from environment variables.
 *
 * Called by src/index.ts (production/dev boot), scripts/ai-smoke.ts, and by tests with explicit env
 * objects. Secrets (API keys) live only in the returned config object; anything that leaves the
 * process (health endpoint, logs, SSE hello) must go through publicConfigSummary().
 *
 * Provider selection, in order: SIDELINE_AI_PROVIDER if set, else the AI chain if a Groq or Gemini
 * key is present (D-079), else Anthropic if its key is present, else OpenAI if its key is present,
 * else "none" (deterministic + replay only), D-033.
 * Model names: Anthropic defaults to claude-opus-5-5 for both tiers; an OpenAI-compatible endpoint
 * names its models its own way (today's proxy: gpt-6.1-sol), so both tiers must be set for it. The
 * chain's links name their own models (SIDELINE_AI_CHAIN, default DEFAULT_AI_CHAIN); its openai link
 * takes the two tier names, and its first link's models are the configured ones.
 */
import { join } from "node:path";
import { z } from "zod";

export type AiProviderChoice = "anthropic" | "openai" | "chain" | "none";

/** The Anthropic default for both tiers (PLAN Task 5); SIDELINE_MODEL_FAST/SMART override it. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";
/** The SDKs' own endpoints, passed explicitly so no stray *_BASE_URL variable can redirect them. */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
/** Groq's and Gemini's OpenAI-compatible Chat Completions endpoints (D-079), fixed the same way. */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/**
 * The owner's order for the AI chain (D-079): Groq's and Gemini's free tiers first, the
 * OpenAI-compatible key last ("openai" alone: SIDELINE_MODEL_FAST/SMART). `@20` caps a link at 20
 * requests a day, Gemini 3.5 Flash's free-tier quota. Links whose key is missing are left out.
 */
export const DEFAULT_AI_CHAIN =
  "groq:qwen/qwen3.8-27b, groq:openai/gpt-oss-20b, gemini:gemini-3.5-flash-lite, groq:openai/gpt-oss-120b, gemini:gemini-3.5-flash@20, openai";

export type ChainProviderName = "groq" | "gemini" | "openai";

/** One link of the AI chain: whose API, its model per tier, and its daily request cap. */
export interface ChainLinkConfig {
  provider: ChainProviderName;
  models: { fast: string; smart: string };
  /** At most this many requests a day (Pacific time, the day Google's quotas use); null: no cap. */
  dailyCap: number | null;
}

const CHAIN_KEY: Readonly<Record<ChainProviderName, string>> = {
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
};

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
    groqApiKey: string | null;
    geminiApiKey: string | null;
    /** The AI chain's links in order when the provider is "chain" (D-079); null otherwise. */
    chain: ChainLinkConfig[] | null;
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
  SIDELINE_AI_PROVIDER: z.enum(["anthropic", "openai", "chain", "none"]).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  SIDELINE_AI_CHAIN: z.string().min(1).optional(),
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

/** One SIDELINE_AI_CHAIN entry: `provider`, `provider:model` or `provider:model@cap`. */
const CHAIN_LINK = /^(groq|gemini|openai)(?::([A-Za-z0-9._/-]+))?(?:@([1-9][0-9]*))?$/;

/**
 * The chain's links in order, from SIDELINE_AI_CHAIN (or the default). A link whose key is missing
 * is left out of the default chain and refused in one the owner wrote; errors name the variable and
 * the link's position, never the value (a key pasted into the wrong variable stays out of logs).
 */
function chainLinks(
  e: { SIDELINE_AI_CHAIN?: string; SIDELINE_MODEL_FAST?: string; SIDELINE_MODEL_SMART?: string },
  keys: Readonly<Record<ChainProviderName, string | null>>,
): ChainLinkConfig[] {
  const explicit = e.SIDELINE_AI_CHAIN !== undefined;
  const links: ChainLinkConfig[] = [];
  const seen = new Set<string>();
  const entries = (e.SIDELINE_AI_CHAIN ?? DEFAULT_AI_CHAIN).split(",").map((entry) => entry.trim());
  for (const [index, entry] of entries.entries()) {
    const at = `SIDELINE_AI_CHAIN link ${index + 1}`;
    const match = CHAIN_LINK.exec(entry);
    if (!match) {
      throw new Error(
        `${at} is not provider[:model][@requests a day] (provider groq, gemini or openai)`,
      );
    }
    const provider = match[1] as ChainProviderName;
    const model = match[2] ?? null;
    if (model === null && provider !== "openai")
      throw new Error(`${at} (${provider}) needs a model`);
    if (seen.has(entry.replace(/@.*/, ""))) throw new Error(`${at} repeats an earlier link`);
    seen.add(entry.replace(/@.*/, ""));
    if (keys[provider] === null) {
      if (explicit) throw new Error(`${at} (${provider}) needs ${CHAIN_KEY[provider]}`);
      continue;
    }
    let models = model === null ? null : { fast: model, smart: model };
    if (models === null) {
      // The OpenAI-compatible link: the endpoint names its models its own way (as for "openai").
      const { SIDELINE_MODEL_FAST: fast, SIDELINE_MODEL_SMART: smart } = e;
      if (!fast || !smart) {
        throw new Error(
          "the AI chain's openai link needs SIDELINE_MODEL_FAST and SIDELINE_MODEL_SMART",
        );
      }
      models = { fast, smart };
    }
    links.push({ provider, models, dailyCap: match[3] === undefined ? null : Number(match[3]) });
  }
  return links;
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
  const groqApiKey = e.GROQ_API_KEY ?? null;
  const geminiApiKey = e.GEMINI_API_KEY ?? null;
  const provider: AiProviderChoice =
    e.SIDELINE_AI_PROVIDER ??
    (groqApiKey || geminiApiKey
      ? "chain"
      : anthropicApiKey
        ? "anthropic"
        : openaiApiKey
          ? "openai"
          : "none");

  if (provider === "anthropic" && !anthropicApiKey) {
    throw new Error("SIDELINE_AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
  }
  if (provider === "openai" && !openaiApiKey) {
    throw new Error("SIDELINE_AI_PROVIDER=openai but OPENAI_API_KEY is not set");
  }
  const chain =
    provider === "chain"
      ? chainLinks(e, { groq: groqApiKey, gemini: geminiApiKey, openai: openaiApiKey })
      : null;
  if (chain !== null && chain.length === 0) {
    throw new Error(
      "SIDELINE_AI_PROVIDER=chain but no link has a key (GROQ_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY)",
    );
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
      groqApiKey,
      geminiApiKey,
      chain,
      models:
        chain !== null
          ? (chain[0]?.models ?? null)
          : modelsFor(provider, e.SIDELINE_MODEL_FAST, e.SIDELINE_MODEL_SMART),
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
 * What kind of endpoint the provider calls: the vendor's own API, "openai-compatible" for any other
 * OpenAI base URL, or "chain" for the AI chain (each link says its own). A host is configuration and
 * is never published (D-068).
 */
export type AiEndpointKind =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "groq"
  | "gemini"
  | "chain";

function openaiEndpointKind(config: AppConfig): "openai" | "openai-compatible" {
  const base = config.ai.openaiBaseUrl;
  return base === null || new URL(base).hostname === new URL(OPENAI_DEFAULT_BASE_URL).hostname
    ? "openai"
    : "openai-compatible";
}

export function aiEndpointKind(config: AppConfig): AiEndpointKind | null {
  if (config.ai.provider === "anthropic") return "anthropic";
  if (config.ai.provider === "chain") return "chain";
  if (config.ai.provider !== "openai") return null;
  return openaiEndpointKind(config);
}

/** The only view of config that may leave the process: no secrets, no hosts, no paths, ever. */
export function publicConfigSummary(config: AppConfig): {
  nodeEnv: string;
  aiProvider: AiProviderChoice;
  aiModelFast: string | null;
  aiModelSmart: string | null;
  aiEndpoint: AiEndpointKind | null;
  /** The AI chain's links in order (D-079); null for any other provider. */
  aiChain:
    | { endpoint: AiEndpointKind; fast: string; smart: string; dailyCap: number | null }[]
    | null;
} {
  return {
    nodeEnv: config.nodeEnv,
    aiProvider: config.ai.provider,
    aiModelFast: config.ai.models?.fast ?? null,
    aiModelSmart: config.ai.models?.smart ?? null,
    aiEndpoint: aiEndpointKind(config),
    aiChain:
      config.ai.chain?.map((link) => ({
        endpoint: link.provider === "openai" ? openaiEndpointKind(config) : link.provider,
        fast: link.models.fast,
        smart: link.models.smart,
        dailyCap: link.dailyCap,
      })) ?? null,
  };
}

/**
 * The AI chain as one line for logs and scripts (index.ts boot log, deploy-env, ai:smoke, ai:record):
 * "groq qwen/qwen3.8-27b → … → gemini gemini-3.5-flash (20 a day) → openai-compatible gpt-6.1-sol".
 */
export function describeAiChain(
  chain: NonNullable<ReturnType<typeof publicConfigSummary>["aiChain"]>,
): string {
  return chain
    .map(({ endpoint, fast, smart, dailyCap }) => {
      const models = fast === smart ? fast : `${fast} / ${smart}`;
      return `${endpoint} ${models}${dailyCap === null ? "" : ` (${dailyCap} a day)`}`;
    })
    .join(" → ");
}
