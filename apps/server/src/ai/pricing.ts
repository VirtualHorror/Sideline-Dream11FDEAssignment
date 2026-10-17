/**
 * What a model call cost, in USD, from the usage the API reported (never estimated token counts).
 *
 * Called by ai/gateway.ts for every provider call. Built-in prices are per million tokens (PLAN
 * Task 5; the two Opus fallback targets of Anthropic's server-side refusal fallback are included
 * because they can serve a claude-opus-5-5 request, D-054). Any other model, such as an
 * OpenAI-compatible endpoint's, uses the configured SIDELINE_PRICE_*_PER_MTOK and is flagged as an
 * estimate (the UI shows "est.").
 */
const BUILT_IN: Readonly<Record<string, { inPerMTok: number; outPerMTok: number }>> = {
  "claude-opus-5-5": { inPerMTok: 4, outPerMTok: 20 },
  "claude-sonnet-5-5": { inPerMTok: 2, outPerMTok: 10 },
  "claude-haiku-5-5": { inPerMTok: 0.1, outPerMTok: 0.5 },
  "claude-opus-5": { inPerMTok: 5, outPerMTok: 25 },
  "claude-opus-4-8": { inPerMTok: 5, outPerMTok: 25 },
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
