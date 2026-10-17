/**
 * The orchestrator: turns the engine's triggers, a late joiner's catch-up and a fan's question into
 * moments, through the AI gateway, and stamps each with its spoiler-safe timing.
 *
 * Callers: sessions/session.ts (teasers from gate triggers, catch-up reels on joining or skipping
 * ahead, questions from POST /ask). Lineup patches, bailouts and room reads have no skill until
 * Task 8: the session keeps their gate decisions and never sends them here. Moment timing (PLAN
 * Task 5): a teaser reveals at its ball and may show from six seconds before it, but only if it was
 * ready before the fan's TV got there (Review focus 3); a catch-up reel reveals when the TV reaches
 * the point the fan joined at (it covers balls still in the fan's delay); an answer shows at once.
 */
import { randomUUID } from "node:crypto";
import {
  type CatchUpFacts,
  catchUpKey,
  type Lens,
  type Moment,
  MomentSchema,
  type MomentTrigger,
} from "@sideline/engine";
import type { Gateway } from "../ai/gateway.ts";
import { catchUpSkill, catchUpSkillFacts } from "../ai/skills/catchUp.ts";
import { type ExplainerContext, explain, explainerKey } from "../ai/skills/explainer.ts";
import type { TeamName } from "../ai/skills/format.ts";
import { teaserSkill } from "../ai/skills/spoilerNudge.ts";
import type { MatchBundle } from "../data/bundle.ts";
import type { Glossary } from "../data/glossary.ts";
import type { Telemetry } from "../telemetry/collector.ts";

/** A teaser may show this long before its ball on the fan's TV (nudgeAt = ball − 6 s). */
export const NUDGE_LEAD_MS = 6_000;

export type NudgeTrigger = Extract<MomentTrigger, { kind: "spoiler_nudge" }>;

export interface Orchestrator {
  teaser(input: {
    sessionId: string;
    trigger: NudgeTrigger;
    /** The ball's stadium time. */
    ballT: number;
    /** Wall ms until the fan's TV reaches the nudge time, when the trigger fired. */
    budgetMs: number;
    /** The fan's TV time now (read again when the teaser is ready). */
    tvNow: () => number;
  }): Promise<Moment>;
  catchUp(input: { sessionId: string; facts: CatchUpFacts; at: number }): Promise<Moment>;
  ask(input: {
    sessionId: string;
    matchId: string;
    question: string;
    lens: Lens;
    /** The last event the fan's TV has shown (-1 before coverage starts). */
    tvSeq: number;
    context: ExplainerContext;
    /** Stadium time when the question was asked. */
    at: number;
  }): Promise<Moment>;
}

export function createOrchestrator(deps: {
  gateway: Gateway;
  glossary: Glossary;
  telemetry: Telemetry;
  bundles: ReadonlyMap<string, MatchBundle>;
  newId?: () => string;
}): Orchestrator {
  const newId = deps.newId ?? randomUUID;
  const teamsOf = (matchId: string): TeamName[] =>
    (deps.bundles.get(matchId)?.context.teams ?? []).map((t) => ({ code: t.code, name: t.name }));

  return {
    async teaser({ sessionId, trigger, ballT, budgetMs, tvNow }) {
      const result = await deps.gateway.run(
        teaserSkill,
        trigger.key,
        { nudge: trigger.facts, teams: teamsOf(trigger.facts.matchId) },
        { deadlineMs: budgetMs, sessionId },
      );
      const nudgeAt = ballT - NUDGE_LEAD_MS;
      // Late for this fan: the card goes straight to the reveal; the cached teaser serves others.
      const inTime = tvNow() < nudgeAt;
      return MomentSchema.parse({
        id: newId(),
        key: trigger.key,
        kind: "spoiler_nudge",
        phase: "climax",
        createdAt: ballT,
        revealAt: ballT,
        nudgeAt: inTime ? nudgeAt : null,
        provenance: result.provenance,
        traceId: result.trace.id,
        scope: "shared",
        payload: { ...result.payload, budgetMs, usedMs: result.trace.latencyMs },
      });
    },

    async catchUp({ sessionId, facts, at }) {
      const { window } = facts;
      const key = catchUpKey(
        facts.matchId,
        window.innings,
        window.fromOver,
        window.toOver,
        facts.lens,
      );
      deps.telemetry.recordKey(sessionId, key, "shared");
      const result = await deps.gateway.run(
        catchUpSkill,
        key,
        catchUpSkillFacts(facts, teamsOf(facts.matchId)),
        { sessionId },
      );
      return MomentSchema.parse({
        id: newId(),
        key,
        kind: "catch_up",
        phase: "mid_match",
        createdAt: at,
        revealAt: at,
        nudgeAt: null,
        provenance: result.provenance,
        traceId: result.trace.id,
        scope: "shared",
        payload: result.payload,
      });
    },

    async ask({ sessionId, matchId, question, lens, tvSeq, context, at }) {
      const key = explainerKey(matchId, tvSeq, lens, question);
      const result = await explain({
        question,
        lens,
        context,
        key,
        glossary: deps.glossary,
        gateway: deps.gateway,
        sessionId,
      });
      // A glossary answer costs nothing; a model answer is a personal moment for the projection.
      if (result.provenance !== "deterministic")
        deps.telemetry.recordKey(sessionId, key, "session");
      return MomentSchema.parse({
        id: newId(),
        key,
        kind: "explainer",
        phase: "any",
        createdAt: at,
        revealAt: null,
        nudgeAt: null,
        provenance: result.provenance,
        traceId: result.trace?.id ?? null,
        scope: "session",
        payload: result.payload,
      });
    },
  };
}
