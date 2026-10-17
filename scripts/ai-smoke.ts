/**
 * AI smoke test (PLAN 5.9): one real teaser call through the gateway, with the configured provider.
 *
 * Usage: pnpm ai:smoke          (= node scripts/ai-smoke.ts; loads .env like the server)
 *        SIDELINE_AI_PROVIDER=none pnpm ai:smoke    (skips: a set variable beats .env)
 *
 * Not part of `pnpm test`: it spends real tokens (a few thousand with today's endpoint, D-033) and
 * sends match facts to the provider. It picks the highest-leverage teaser of the first manifest
 * match (from data, not a literal), runs it through the real gateway with an in-memory database (no
 * trace or spend lands in data/runtime), and prints the provider, endpoint host, model, latency,
 * tokens and cost. Exit 1 unless the answer is live, schema-valid and passes spoilerLint. The key is
 * never printed; only publicConfigSummary's fields are.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spoilerLint } from "../apps/server/src/ai/guards/spoilerLint.ts";
import { teaserSkill } from "../apps/server/src/ai/skills/spoilerNudge.ts";
import { loadConfig, publicConfigSummary } from "../apps/server/src/config.ts";
import { buildRuntime } from "../apps/server/src/runtime.ts";
import {
  applyEvent,
  createMatchState,
  type NudgeFacts,
  nudgeDetector,
} from "../packages/engine/src/index.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig(process.env, repoRoot);
const summary = publicConfigSummary(config);
if (config.ai.provider === "none") {
  console.log("ai-smoke: skipped (no AI provider configured; see .env.example)");
  process.exit(0);
}

const runtime = buildRuntime(config, { dbPath: ":memory:" });
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
  `ai-smoke: provider ${summary.aiProvider}, endpoint ${summary.aiEndpointHost}, model ${summary.aiModelFast}`,
);
console.log(
  `ai-smoke: teaser for ${matchId} innings ${best.facts.innings}, ball ${best.facts.label} (leverage ${best.facts.leverage.value.toFixed(3)})`,
);
const result = await runtime.gateway.run(teaserSkill, best.key, { nudge: best.facts, teams });
const { trace } = result;
const cost = `$${trace.costUsd.toFixed(4)}${trace.costEstimated ? " (est.)" : ""}`;
console.log(`ai-smoke: nudge ${JSON.stringify(result.payload.nudge)}`);
console.log(
  `ai-smoke: outcome ${trace.outcome}, provenance ${result.provenance}, model ${trace.model}, latency ${trace.latencyMs} ms, tokens ${trace.tokensIn} in / ${trace.tokensOut} out, cost ${cost}`,
);
const lint = spoilerLint(result.payload.nudge, best.facts);
console.log(`ai-smoke: spoilerLint ${lint.ok ? "ok" : `rejected: ${lint.reason}`}`);
runtime.db.close();
if (result.provenance !== "live" || !lint.ok) {
  console.error(`ai-smoke: FAILED (${trace.outcome}${trace.detail ? `: ${trace.detail}` : ""})`);
  process.exit(1);
}
console.log("ai-smoke: OK");
