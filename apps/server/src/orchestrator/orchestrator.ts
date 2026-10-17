/**
 * The orchestrator: turns the engine's triggers, a late joiner's catch-up and a fan's question into
 * moments, through the AI gateway, and stamps each with its spoiler-safe timing.
 *
 * Callers: sessions/session.ts (teasers, lineup patches, bailouts and room reads from gate triggers;
 * catch-up reels on joining or skipping ahead; questions from POST /ask; a fan's lineup request).
 * Moment timing (PLAN Task 5): a teaser reveals at its ball and may show from six seconds before it,
 * but only if it was ready before the fan's TV got there (Review focus 3); a catch-up reel reveals
 * when the TV reaches the point the fan joined at (it covers balls still in the fan's delay); a
 * lineup patch, a bailout and a room read reveal when the TV shows what triggered them (the XIs, the
 * wicket, the over's last ball); an answer to the fan shows at once.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type CatchUpFacts,
  catchUpKey,
  type InspectorRequest,
  type InspectorResult,
  type Lens,
  type LineupFacts,
  type Moment,
  MomentSchema,
  type MomentTrigger,
  type Situation,
} from "@sideline/engine";
import type { Gateway } from "../ai/gateway.ts";
import { bailoutSkill, bailoutSkillFacts } from "../ai/skills/bailout.ts";
import { catchUpSkill, catchUpSkillFacts } from "../ai/skills/catchUp.ts";
import { type ExplainerContext, explain, explainerKey } from "../ai/skills/explainer.ts";
import type { TeamName } from "../ai/skills/format.ts";
import { inspect } from "../ai/skills/inspector.ts";
import { lineupSkill } from "../ai/skills/lineupPatch.ts";
import { roomReadSkill } from "../ai/skills/roomRead.ts";
import { teaserSkill } from "../ai/skills/spoilerNudge.ts";
import { runStatBack, statBackKey } from "../ai/skills/statBack.ts";
import type { MatchBundle } from "../data/bundle.ts";
import type { Glossary } from "../data/glossary.ts";
import { inspectorTables, statBackTables } from "../sql/views.ts";
import type { Telemetry } from "../telemetry/collector.ts";

/** A teaser may show this long before its ball on the fan's TV (nudgeAt = ball − 6 s). */
export const NUDGE_LEAD_MS = 6_000;

export type NudgeTrigger = Extract<MomentTrigger, { kind: "spoiler_nudge" }>;
export type BailoutTrigger = Extract<MomentTrigger, { kind: "bailout" }>;
export type RoomTrigger = Extract<MomentTrigger, { kind: "room_read" }>;

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
  /** The room's debates over the last five minutes; revealed with the ball that closed the over. */
  roomRead(input: { sessionId: string; trigger: RoomTrigger; ballT: number }): Promise<Moment>;
  /** A comeback quest for the cohort whose armband just fell; revealed with the wicket. */
  bailout(input: { sessionId: string; trigger: BailoutTrigger; ballT: number }): Promise<Moment>;
  /** The XIs' patch (intent null, revealed when the TV shows the XIs) or a fan's request (at once). */
  lineupPatch(input: {
    sessionId: string;
    key: string;
    facts: LineupFacts;
    intent: string | null;
    createdAt: number;
    revealAt: number | null;
  }): Promise<Moment>;
  /** A fan's take checked against the deliveries their TV has shown: a personal take card. */
  statBack(input: {
    sessionId: string;
    matchId: string;
    take: string;
    /** The fan's TV time and the last event it has shown (-1 before coverage starts). */
    tvT: number;
    tvSeq: number;
    situation: Situation | null;
    at: number;
  }): Promise<Moment>;
  /** The control plane's inspector, over the views at the fan's TV time (not a moment). */
  inspect(input: {
    sessionId: string;
    matchId: string;
    tvT: number;
    request: InspectorRequest;
  }): Promise<InspectorResult>;
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
  /** The server's database: the inspector's ai_calls view is read from it. */
  db: DatabaseSync;
  newId?: () => string;
}): Orchestrator {
  const newId = deps.newId ?? randomUUID;
  const teamsOf = (matchId: string): TeamName[] =>
    (deps.bundles.get(matchId)?.context.teams ?? []).map((t) => ({ code: t.code, name: t.name }));
  const bundleOf = (matchId: string): MatchBundle => {
    const bundle = deps.bundles.get(matchId);
    if (!bundle) throw new Error(`no bundle for match ${matchId}`);
    return bundle;
  };

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

    async roomRead({ sessionId, trigger, ballT }) {
      const result = await deps.gateway.run(
        roomReadSkill,
        trigger.key,
        { room: trigger.facts, teams: teamsOf(trigger.facts.matchId) },
        { sessionId },
      );
      return MomentSchema.parse({
        id: newId(),
        key: trigger.key,
        kind: "room_read",
        phase: "climax",
        createdAt: ballT,
        revealAt: ballT,
        nudgeAt: null,
        provenance: result.provenance,
        traceId: result.trace.id,
        scope: "shared",
        payload: result.payload,
      });
    },

    async bailout({ sessionId, trigger, ballT }) {
      const result = await deps.gateway.run(
        bailoutSkill,
        trigger.key,
        bailoutSkillFacts(trigger.facts, teamsOf(trigger.facts.matchId)),
        { sessionId },
      );
      return MomentSchema.parse({
        id: newId(),
        key: trigger.key,
        kind: "bailout",
        phase: "early_collapse",
        createdAt: ballT,
        revealAt: ballT,
        nudgeAt: null,
        provenance: result.provenance,
        traceId: result.trace.id,
        scope: "shared",
        payload: result.payload,
      });
    },

    async lineupPatch({ sessionId, key, facts, intent, createdAt, revealAt }) {
      const bundle = deps.bundles.get(facts.matchId);
      if (!bundle) throw new Error(`no bundle for match ${facts.matchId}`);
      // The XIs' own patch is counted by the gate (a personal trigger); a fan's request is a new one.
      if (intent !== null) deps.telemetry.recordKey(sessionId, key, "session");
      const result = await deps.gateway.run(
        lineupSkill,
        key,
        {
          lineup: facts,
          teams: teamsOf(facts.matchId),
          intent,
          players: bundle.players,
          team: bundle.rules.team,
        },
        { sessionId },
      );
      return MomentSchema.parse({
        id: newId(),
        key,
        kind: "lineup_patch",
        phase: "toss_to_lock",
        createdAt,
        revealAt,
        nudgeAt: null,
        provenance: result.provenance,
        traceId: result.trace.id,
        scope: "session",
        payload: result.payload,
      });
    },

    async statBack({ sessionId, matchId, take, tvT, tvSeq, situation, at }) {
      const key = statBackKey(matchId, tvSeq, take);
      deps.telemetry.recordKey(sessionId, key, "session");
      const result = await runStatBack({
        gateway: deps.gateway,
        key,
        take,
        tables: statBackTables(bundleOf(matchId), tvT),
        teams: teamsOf(matchId),
        situation,
        sessionId,
      });
      return MomentSchema.parse({
        id: newId(),
        key,
        kind: "take_card",
        phase: "any",
        createdAt: at,
        revealAt: null,
        nudgeAt: null,
        provenance: result.provenance,
        traceId: result.trace.id,
        scope: "session",
        payload: result.payload,
      });
    },

    async inspect({ sessionId, matchId, tvT, request }) {
      const tables = inspectorTables(bundleOf(matchId), tvT, deps.db);
      return "question" in request
        ? inspect({ gateway: deps.gateway, tables, sessionId, question: request.question })
        : inspect({ gateway: deps.gateway, tables, sessionId, sql: request.sql });
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
