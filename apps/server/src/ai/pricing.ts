/**
 * What a model call cost, in USD, from the usage the API reported (never estimated token counts).
 *
 * Called by ai/gateway.ts for every provider call. Built-in prices are per million tokens (PLAN
 * Task 5; the two Opus fallback targets of Anthropic's server-side refusal fallback are included
 * because they can serve a claude-opus-5-5 request, D-054). The AI chain's models (D-079) carry
 * their providers' paid-tier list prices as read on 2026-10-19 (Groq's model pages, Gemini's pricing
 * page): the free tiers bill nothing, so for them a cost says what the same traffic would cost on a
 * paid key, which is what the scale projection needs. gemini-3.5-flash requests are served by
 * gemini-3.6-flash (Gemini's deprecations page), whose price holds until 2026-12-31 ($1.50 / $7.50
 * from 2027). Any other model, such as an OpenAI-compatible endpoint's, uses the configured
 * SIDELINE_PRICE_*_PER_MTOK and is flagged as an estimate (the UI shows "est.").
 */
const BUILT_IN: Readonly<Record<string, { inPerMTok: number; outPerMTok: number }>> = {
  "claude-opus-5-5": { inPerMTok: 4, outPerMTok: 20 },
  "claude-sonnet-5-5": { inPerMTok: 2, outPerMTok: 10 },
  "claude-haiku-5-5": { inPerMTok: 0.1, outPerMTok: 0.5 },
  "claude-opus-5": { inPerMTok: 5, outPerMTok: 25 },
  "claude-opus-4-8": { inPerMTok: 5, outPerMTok: 25 },
  "qwen/qwen3.8-27b": { inPerMTok: 0.8, outPerMTok: 4 },
  "openai/gpt-oss-20b": { inPerMTok: 0.075, outPerMTok: 0.3 },
  "openai/gpt-oss-120b": { inPerMTok: 0.15, outPerMTok: 0.6 },
  "gemini-3.5-flash-lite": { inPerMTok: 0.3, outPerMTok: 2.5 },
  "gemini-3.5-flash": { inPerMTok: 0.75, outPerMTok: 3.75 },
  "gemini-3.6-flash": { inPerMTok: 0.75, outPerMTok: 3.75 },
};

export function costOf(
  model: string,
  tokensIn: number,
  tokensOut: number,
  configured: { inPerMTok: number; outPerMTok: number },
): { usd: number; estimated: boolean } {
  const known = Object.hasOwn(BUILT_IN, model) ? BUILT_IN[model] : undefined;
  const price = known ?? configured;
  return {
    usd: (tokensIn * price.inPerMTok + tokensOut * price.outPerMTok) / 1_000_000,
    estimated: known === undefined,
  };
}
