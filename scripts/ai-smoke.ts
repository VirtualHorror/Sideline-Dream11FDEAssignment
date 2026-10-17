/**
 * AI smoke test (PLAN 5.9): one real teaser call through the gateway, with the configured provider.
 *
 * Usage: pnpm ai:smoke          (= node scripts/ai-smoke.ts; loads .env like the server)
 *        pnpm ai:smoke --each-link    then the same teaser to every link of the AI chain, one
 *                                     request each (D-079): which links answer, how fast
 *        SIDELINE_AI_PROVIDER=none pnpm ai:smoke    (skips: a set variable beats .env)
 *
 * Not part of `pnpm test`: it spends real tokens (a few thousand with the proxy's endpoint, D-033;
 * a few hundred on Groq) and sends match facts to the provider. It picks the highest-leverage teaser
 * of the first manifest match (from data, not a literal), runs it through the real gateway with an
 * in-memory database (no trace or spend lands in data/runtime) and none of the recorded answers in
 * data/ai-replay (a recorded moment would be served from the cache), and prints the provider, endpoint
 * kind, model, latency, tokens and cost; with the chain, the link that answered and the ones passed
 * over. Exit 1 unless the answer is live, schema-valid and passes spoilerLint (the per-link check
 * only reports). The key is never printed; only publicConfigSummary's fields are.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { providerJsonSchema } from "../apps/server/src/ai/gateway.ts";
import { spoilerLint } from "../apps/server/src/ai/guards/spoilerLint.ts";
import { describeProviderError } from "../apps/server/src/ai/providers/types.ts";
import { teaserSkill } from "../apps/server/src/ai/skills/spoilerNudge.ts";
import { describeAiChain, loadConfig, publicConfigSummary } from "../apps/server/src/config.ts";
import { buildRuntime, createChainLinks } from "../apps/server/src/runtime.ts";
import {
  applyEvent,
  createMatchState,
  type NudgeFacts,
  nudgeDetector,
} from "../packages/engine/src/index.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: { "each-link": { type: "boolean", default: false } },
});
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig(process.env, repoRoot);
const summary = publicConfigSummary(config);
if (config.ai.provider === "none") {
  console.log("ai-smoke: skipped (no AI provider configured; see .env.example)");
  process.exit(0);
}

// No recorded rows: data/ai-replay holds answers for this match's moments, and a cache hit would
// answer the teaser without asking the provider this script is here to check.
const runtime = buildRuntime(config, { dbPath: ":memory:", replayDir: null });
const [matchId, bundle] = [...runtime.bundles][0] ?? [];
if (!matchId || !bundle) throw new Error("no match bundles in data/");

// The match's biggest ball by the model's own leverage: a real teaser trigger.
const persona = bundle.personas[0];
if (!persona) throw new Error(`${matchId} has no personas`);
const ctx = {
  matchId,
  players: bundle.players,
  rules: bundle.rules,
  persona,
  winprob: bundle.winprob,
  priors: bundle.priors,
};
const state = createMatchState(matchId);
let best: { key: string; facts: NudgeFacts } | null = null;
for (const event of bundle.events) {
  const before = structuredClone(state);
  applyEvent(state, event);
  const verdict = nudgeDetector.evaluate({
    before,
    after: state,
    event,
    events: bundle.events,
    ctx,
  });
  if (verdict.outcome === "ai_trigger" && verdict.trigger.kind === "spoiler_nudge") {
    const { key, facts } = verdict.trigger;
    if (!best || facts.leverage.value > best.facts.leverage.value) best = { key, facts };
  }
}
if (!best) throw new Error(`${matchId} has no teaser triggers`);

const teams = bundle.context.teams.map((t) => ({ code: t.code, name: t.name }));
console.log(
  `ai-smoke: provider ${summary.aiProvider}, endpoint ${summary.aiEndpoint}, model ${summary.aiModelFast}`,
);
if (summary.aiChain) console.log(`ai-smoke: AI chain ${describeAiChain(summary.aiChain)}`);
console.log(
  `ai-smoke: teaser for ${matchId} innings ${best.facts.innings}, ball ${best.facts.label} (leverage ${best.facts.leverage.value.toFixed(3)})`,
);
const facts = { nudge: best.facts, teams };
const result = await runtime.gateway.run(teaserSkill, best.key, facts);
const { trace } = result;
const cost = `$${trace.costUsd.toFixed(4)}${trace.costEstimated ? " (est.)" : ""}`;
console.log(`ai-smoke: nudge ${JSON.stringify(result.payload.nudge)}`);
console.log(
  `ai-smoke: outcome ${trace.outcome}, provenance ${result.provenance}, provider ${trace.provider}, model ${trace.model}, latency ${trace.latencyMs} ms, tokens ${trace.tokensIn} in / ${trace.tokensOut} out, cost ${cost}`,
);
if (trace.detail) console.log(`ai-smoke: detail ${trace.detail}`);
const lint = spoilerLint(result.payload.nudge, best.facts);
console.log(`ai-smoke: spoilerLint ${lint.ok ? "ok" : `rejected: ${lint.reason}`}`);
runtime.db.close();

// --each-link: the same teaser request to every link of the chain on its own (no chain, no
// gateway), so a link that is down shows here even when an earlier one answered above.
if (args["each-link"] && config.ai.provider === "chain") {
  const { system, user } = teaserSkill.buildPrompt(facts);
  for (const [index, link] of createChainLinks(config).entries()) {
    const model = link.models[teaserSkill.tier];
    const started = Date.now();
    const timeoutMs = 15_000;
    try {
      const answer = await link.provider.complete({
        system,
        user,
        jsonSchema: providerJsonSchema(teaserSkill.outputSchema),
        model,
        tier: teaserSkill.tier,
        effort: teaserSkill.effort,
        maxTokens: teaserSkill.maxTokens,
        timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        meta: { skill: teaserSkill.name, key: best.key },
      });
      const valid = teaserSkill.outputSchema.safeParse(answer.output).success;
      console.log(
        `ai-smoke: link ${index + 1} ${link.provider.name} ${model}: answered by ${answer.model} in ${Date.now() - started} ms, ${answer.tokensIn} in / ${answer.tokensOut} out, ${valid ? "schema-valid" : "NOT schema-valid"}`,
      );
    } catch (error) {
      console.log(
        `ai-smoke: link ${index + 1} ${link.provider.name} ${model}: no answer after ${Date.now() - started} ms (${describeProviderError(error)})`,
      );
    }
  }
}
if (result.provenance !== "live" || !lint.ok) {
  console.error(`ai-smoke: FAILED (${trace.outcome}${trace.detail ? `: ${trace.detail}` : ""})`);
  process.exit(1);
}
console.log("ai-smoke: OK");
