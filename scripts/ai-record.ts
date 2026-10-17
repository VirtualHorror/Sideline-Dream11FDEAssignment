/**
 * `pnpm ai:record` (PLAN Task 7, D-066): records the AI answers a reviewer reaches into
 * data/ai-replay/<matchId>.jsonl, from real provider calls, for servers with no key (Constraint 2).
 *
 * Usage: pnpm ai:record                  the plan: the moments that need a provider call (no spend)
 *        pnpm ai:record --yes            record them with the provider in .env (spends money)
 *        pnpm ai:record --yes --fresh    re-record everything, ignoring the rows already recorded
 *        pnpm ai:record --provider scripted --out <dir>
 *                                        a dry run with the test provider, never into data/ai-replay
 *        --out <dir>                     where the rows go (default data/ai-replay)
 *
 * Without --yes nothing is sent anywhere: the plan walks the same sessions with no provider. With
 * it, every call goes through the real gateway (timeouts, schema, guards, and the daily budget of
 * SIDELINE_AI_DAILY_BUDGET_USD, which stops the calls), one at a time, and only validated answers
 * are written. Rows already in the output directory are kept and answer first, so a second run
 * only fills the gaps. Prints the calls, outcomes, tokens and cost; the key is never printed.
 * Exit 1 when some moment could not be recorded (run it again to retry only those).
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createScriptedProvider } from "../apps/server/src/ai/providers/scripted.ts";
import { loadConfig, publicConfigSummary } from "../apps/server/src/config.ts";
import { createProvider } from "../apps/server/src/runtime.ts";
import {
  type RecordRun,
  recordMoments,
  SCRIPTED_MODELS,
  scriptedAnswer,
  writeReplayFiles,
} from "./lib/record.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const replayHome = join(repoRoot, "data", "ai-replay");
const fail = (message: string): never => {
  console.error(`ai-record: ${message}`);
  process.exit(1);
};

const { values: args } = parseArgs({
  options: {
    yes: { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    provider: { type: "string" },
    out: { type: "string" },
  },
});
const out = resolve(args.out ?? replayHome);
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const config = loadConfig(process.env, repoRoot);
const log = (line: string) => console.log(`ai-record: ${line}`);

function report(run: RecordRun, label: string): void {
  const c = run.counters;
  const outcomes = Object.entries(run.outcomes)
    .map(([outcome, n]) => `${outcome} ${n}`)
    .join(", ");
  log(`${label}: ${c.aiCallsLive} provider calls${outcomes ? ` (${outcomes})` : ""}`);
  log(
    `${label}: ${c.tokensIn.toLocaleString("en-US")} tokens in, ${c.tokensOut.toLocaleString("en-US")} out, cost $${c.costUsd.toFixed(4)} (reported usage at the configured prices)`,
  );
  log(`${label}: ${run.reused} moments already recorded; ${run.dropped} old rows dropped (stale)`);
}

function write(run: RecordRun): void {
  mkdirSync(out, { recursive: true });
  for (const { file, rows } of writeReplayFiles(out, run.rows)) log(`wrote ${file} (${rows} rows)`);
}

if (args.provider !== undefined) {
  if (args.provider !== "scripted") fail(`--provider takes only "scripted" (got ${args.provider})`);
  if (args.out === undefined || out === replayHome) {
    fail(`scripted rows never go to ${replayHome}: pass --out <another directory>`);
  }
  log("provider scripted (test answers, labelled as such), no network");
  const run = await recordMoments(config, {
    provider: createScriptedProvider(scriptedAnswer),
    models: SCRIPTED_MODELS,
    replayDir: args.fresh ? null : out,
    log,
  });
  report(run, "scripted");
  write(run);
  if (run.error) fail(`stopped early: ${run.error}`);
  process.exit(run.missing.length > 0 ? 1 : 0);
}

const provider = createProvider(config);
if (!provider) fail("no AI provider is configured (.env.example): there is nothing to record with");
const summary = publicConfigSummary(config);
log(
  `provider ${summary.aiProvider}, endpoint ${summary.aiEndpointHost}, models ${summary.aiModelFast} / ${summary.aiModelSmart}`,
);
log(
  `daily budget $${config.ai.dailyBudgetUsd} (SIDELINE_AI_DAILY_BUDGET_USD): calls stop when this run has spent it`,
);

// The plan: the same walk with no provider, so nothing leaves the machine.
const plan = await recordMoments(config, {
  provider: null,
  replayDir: args.fresh ? null : out,
});
const planned = plan.missing.filter((m) => m.outcome === "fallback");
const bySkill = (skill: string) => planned.filter((m) => m.skill === skill).length;
log(
  `plan: ${planned.length} moments need a provider call (${bySkill("spoiler_nudge")} teasers, ${bySkill("catch_up")} catch-up reels); ${plan.reused} already recorded in ${out}`,
);
if (planned.length === 0) {
  log("nothing to record");
  process.exit(0);
}
if (!args.yes) {
  log("nothing was sent or spent: run `pnpm ai:record --yes` to record (it spends money)");
  process.exit(0);
}

const run = await recordMoments(config, { provider, replayDir: args.fresh ? null : out, log });
report(run, "recorded");
// Whatever was recorded is written, even after a failure: those calls are paid for.
write(run);
if (run.error) fail(`stopped early (${run.error}): run \`pnpm ai:record --yes\` again to continue`);
if (run.missing.length > 0) {
  for (const m of run.missing)
    log(`not recorded: ${m.key} (${m.outcome}${m.detail ? `: ${m.detail}` : ""})`);
  fail(
    `${run.missing.length} moments were not recorded: run \`pnpm ai:record --yes\` again to retry only those`,
  );
}
log("done: commit the files on a task branch for the audit (Constraint 2)");
