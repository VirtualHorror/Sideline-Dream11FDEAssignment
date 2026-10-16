/**
 * Moments: the cards Sideline shows on the companion screen.
 *
 * A moment is produced by the server's orchestrator when a deterministic detector
 * fires (Phase 1-4) or a fan asks something. Its `payload` is built from the
 * engine's deterministic facts plus, when needed, a schema-validated LLM output.
 * `provenance` always says which: the UI must render it so nobody mistakes a
 * fallback template for live AI.
 *
 * Timing: `createdAt` is stadium time. The client holds the card until its own TV
 * clock reaches `revealAt` (spoiler-safe), and may show a teaser at `nudgeAt`.
 */
import { z } from "zod";
import {
  InningsNumberSchema,
  LensSchema,
  MatchTimeSchema,
  PlayerIdSchema,
  TeamCodeSchema,
} from "./primitives.ts";

// ---------------------------------------------------------------------------
// Quest rules: predictions the LLM may *phrase* but the engine *resolves*.
// The LLM picks a rule type and its parameters; the engine checks the real
// deliveries, so a prediction's outcome can never be hallucinated.
// ---------------------------------------------------------------------------

const CompareSchema = z.enum(["gte", "lte"]);
/** 1-based count of legal balls within an innings (1..120 in a T20). */
const LegalBallSchema = z.number().int().min(1).max(120);
const windowOk = (r: { fromLegalBall: number; toLegalBall: number }) =>
  r.fromLegalBall <= r.toLegalBall;
const windowMessage = { message: "window must not end before it starts", path: ["toLegalBall"] };

export const QuestRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("runs_in_over"),
    innings: InningsNumberSchema,
    over: z.number().int().min(0).max(19),
    op: CompareSchema,
    value: z.number().int().nonnegative(),
  }),
  z
    .object({
      type: z.literal("wicket_in_window"),
      innings: InningsNumberSchema,
      fromLegalBall: LegalBallSchema,
      toLegalBall: LegalBallSchema,
    })
    .refine(windowOk, windowMessage),
  z
    .object({
      type: z.literal("boundary_in_window"),
      innings: InningsNumberSchema,
      fromLegalBall: LegalBallSchema,
      toLegalBall: LegalBallSchema,
      boundary: z.union([z.literal(4), z.literal(6), z.literal("any")]),
    })
    .refine(windowOk, windowMessage),
  z
    .object({
      type: z.literal("dots_in_window"),
      innings: InningsNumberSchema,
      fromLegalBall: LegalBallSchema,
      toLegalBall: LegalBallSchema,
      op: CompareSchema,
      value: z.number().int().nonnegative(),
    })
    .refine(windowOk, windowMessage),
  z.object({
    type: z.literal("batter_runs_by"),
    innings: InningsNumberSchema,
    playerId: PlayerIdSchema,
    byLegalBall: LegalBallSchema,
    op: CompareSchema,
    value: z.number().int().nonnegative(),
  }),
]);
export type QuestRule = z.infer<typeof QuestRuleSchema>;

const OptionSchema = z.object({ id: z.string().min(1).max(8), label: z.string().min(1).max(60) });

// ---------------------------------------------------------------------------
// Payloads, one per moment kind.
// ---------------------------------------------------------------------------

/** Phase 1 (toss to lock): playing XI vs the fan's squad, with legal swaps. */
export const LineupPatchPayloadSchema = z.object({
  notPlaying: z.array(z.object({ playerId: PlayerIdSchema, team: TeamCodeSchema })),
  swaps: z.array(
    z.object({
      outId: PlayerIdSchema,
      inId: PlayerIdSchema,
      /** Squad credits after applying this swap (must stay within the budget). */
      creditsAfter: z.number().nonnegative(),
      rationale: z.string().min(1).max(280),
    }),
  ),
  captain: z.object({ playerId: PlayerIdSchema, rationale: z.string().max(280) }).nullable(),
  viceCaptain: z.object({ playerId: PlayerIdSchema, rationale: z.string().max(280) }).nullable(),
  /** One line on how conditions or the fan's request shaped the advice. */
  conditionsRead: z.string().max(280),
  /** Result of the deterministic squad validator after the suggested swaps. */
  squadValid: z.boolean(),
  /** The fan's own instruction, if they typed one ("rebalance for rain"). */
  intent: z.string().max(280).nullable(),
});

/** Phase 2 (early collapse): captain or vice-captain fell cheaply. */
export const BailoutPayloadSchema = z.object({
  trigger: z.object({
    playerId: PlayerIdSchema,
    role: z.enum(["C", "VC"]),
    runs: z.number().int().nonnegative(),
    balls: z.number().int().nonnegative(),
    label: z.string(),
    eventId: z.string(),
  }),
  projectedBefore: z.number(),
  projectedAfter: z.number(),
  quest: z.object({
    title: z.string().min(1).max(80),
    windowFromLabel: z.string(),
    windowToLabel: z.string(),
    predictions: z
      .array(
        z.object({
          id: z.string().min(1).max(8),
          prompt: z.string().min(1).max(120),
          options: z.array(OptionSchema).min(2).max(4),
          rule: QuestRuleSchema,
          rewardBucks: z.number().int().positive().max(500),
        }),
      )
      .min(1)
      .max(3),
  }),
  trivia: z
    .array(
      z
        .object({
          question: z.string().min(1).max(160),
          options: z.array(z.string().min(1).max(60)).min(2).max(4),
          answerIndex: z.number().int().nonnegative(),
          /** The deterministic fact the question was generated from (grounding). */
          fact: z.string().min(1).max(200),
        })
        .refine((q) => q.answerIndex < q.options.length, {
          message: "answerIndex out of range",
          path: ["answerIndex"],
        }),
    )
    .max(2),
  banter: z.object({
    tone: z.enum(["self_roast", "savage", "wholesome"]),
    headline: z.string().min(1).max(80),
    body: z.string().min(1).max(220),
    shareText: z.string().min(1).max(280),
  }),
});

/** Phase 3 (joining late): a short reel of what was missed. */
export const CatchUpPayloadSchema = z.object({
  innings: InningsNumberSchema,
  fromLabel: z.string(),
  toLabel: z.string(),
  lens: LensSchema,
  /** Deterministic one-liner of where the match stands now. */
  situation: z.string().min(1).max(200),
  slides: z
    .array(
      z.object({
        kind: z.enum(["plot_twist", "turning_point", "anomaly", "watch_next"]),
        headline: z.string().min(1).max(80),
        body: z.string().min(1).max(280),
        /** Event ids this slide is about; the validator rejects ids outside the window. */
        citedEventIds: z.array(z.string()),
      }),
    )
    .min(2)
    .max(5),
});

/** Phase 3: "what does that mean?" answered from the glossary (free) or by AI (contextual). */
export const ExplainerPayloadSchema = z.object({
  question: z.string().min(1).max(280),
  lens: LensSchema,
  answer: z.string().min(1).max(600),
  source: z.enum(["glossary", "ai"]),
  relatedTerms: z.array(z.string()).max(5),
});

/** Phase 4: a spoiler-free teaser for a big ball the fan's TV has not shown yet. */
export const SpoilerNudgePayloadSchema = z.object({
  eventId: z.string(),
  nudge: z.string().min(1).max(160),
  reveal: z.string().min(1).max(200),
  leverage: z.number().min(0).max(1),
  /** Time available before the fan's TV shows the ball (delay minus lead), ms. */
  budgetMs: z.number().int().nonnegative(),
  /** Time the AI call actually took, ms. */
  usedMs: z.number().int().nonnegative(),
});

/** Phase 4: the watch-along chat, clustered into debates. */
export const RoomReadPayloadSchema = z.object({
  windowFromT: MatchTimeSchema,
  windowToT: MatchTimeSchema,
  messageCount: z.number().int().nonnegative(),
  mood: z.object({ label: z.string().min(1).max(40), emoji: z.string().min(1).max(8) }),
  pods: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(60),
        stance: z.string().min(1).max(120),
        sharePct: z.number().min(0).max(100),
        sampleMessageIds: z.array(z.string()).max(3),
      }),
    )
    .min(1)
    .max(5),
  hotTake: z.object({ messageId: z.string(), why: z.string().max(160) }).nullable(),
  poll: z
    .object({
      question: z.string().min(1).max(120),
      options: z.array(OptionSchema).min(2).max(4),
      rule: QuestRuleSchema.nullable(),
    })
    .nullable(),
});

/** "Stat-back my take": a fan's claim checked against the match database. */
export const TakeCardPayloadSchema = z.object({
  take: z.string().min(1).max(280),
  verdict: z.enum(["backed", "busted", "mixed", "unclear"]),
  statLine: z.string().min(1).max(280),
  sql: z.string().nullable(),
  rows: z.array(z.record(z.string(), z.unknown())).max(50).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

// ---------------------------------------------------------------------------
// The Moment envelope.
// ---------------------------------------------------------------------------

export const MomentPhaseSchema = z.enum([
  "toss_to_lock",
  "early_collapse",
  "mid_match",
  "climax",
  "any",
]);
export type MomentPhase = z.infer<typeof MomentPhaseSchema>;

/**
 * Where a moment's words came from:
 * - deterministic: computed by the engine, no LLM involved
 * - live: a fresh LLM call made for this moment
 * - cache: an earlier LLM result for the same moment key (shared across fans)
 * - replay: an LLM result recorded earlier by `pnpm ai:record` (no API key at runtime)
 * - fallback: the LLM was unavailable/invalid; a deterministic template was used
 */
export const ProvenanceSchema = z.enum(["deterministic", "live", "cache", "replay", "fallback"]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

const momentBase = {
  id: z.string().min(1),
  /** Moment/cache key, e.g. "nudge:1298150:1298150:0414". Same key = same content for everyone. */
  key: z.string().min(1),
  phase: MomentPhaseSchema,
  /** Stadium time at which the moment was produced. */
  createdAt: MatchTimeSchema,
  /** Do not show before the fan's TV clock reaches this time (null = show immediately). */
  revealAt: MatchTimeSchema.nullable(),
  /** Optional teaser time, <= revealAt. */
  nudgeAt: MatchTimeSchema.nullable(),
  provenance: ProvenanceSchema,
  /** Links to the AICallTrace that produced the words (null for deterministic moments). */
  traceId: z.string().nullable(),
  /** shared = same for every fan at this moment; session = personal to one fan. */
  scope: z.enum(["shared", "session"]),
};

const nudgeBeforeReveal = (m: { revealAt: number | null; nudgeAt: number | null }) =>
  m.nudgeAt === null || m.revealAt === null || m.nudgeAt <= m.revealAt;
const nudgeMessage = { message: "nudgeAt must not be after revealAt", path: ["nudgeAt"] };

export const MomentSchema = z.discriminatedUnion("kind", [
  z
    .object({ ...momentBase, kind: z.literal("lineup_patch"), payload: LineupPatchPayloadSchema })
    .refine(nudgeBeforeReveal, nudgeMessage),
  z
    .object({ ...momentBase, kind: z.literal("bailout"), payload: BailoutPayloadSchema })
    .refine(nudgeBeforeReveal, nudgeMessage),
  z
    .object({ ...momentBase, kind: z.literal("catch_up"), payload: CatchUpPayloadSchema })
    .refine(nudgeBeforeReveal, nudgeMessage),
  z
    .object({ ...momentBase, kind: z.literal("explainer"), payload: ExplainerPayloadSchema })
    .refine(nudgeBeforeReveal, nudgeMessage),
  z
    .object({ ...momentBase, kind: z.literal("spoiler_nudge"), payload: SpoilerNudgePayloadSchema })
    .refine(nudgeBeforeReveal, nudgeMessage),
  z
    .object({ ...momentBase, kind: z.literal("room_read"), payload: RoomReadPayloadSchema })
    .refine(nudgeBeforeReveal, nudgeMessage),
  z
    .object({ ...momentBase, kind: z.literal("take_card"), payload: TakeCardPayloadSchema })
    .refine(nudgeBeforeReveal, nudgeMessage),
]);
export type Moment = z.infer<typeof MomentSchema>;
export type MomentKind = Moment["kind"];
export type LineupPatchPayload = z.infer<typeof LineupPatchPayloadSchema>;
export type BailoutPayload = z.infer<typeof BailoutPayloadSchema>;
export type CatchUpPayload = z.infer<typeof CatchUpPayloadSchema>;
export type ExplainerPayload = z.infer<typeof ExplainerPayloadSchema>;
export type SpoilerNudgePayload = z.infer<typeof SpoilerNudgePayloadSchema>;
export type RoomReadPayload = z.infer<typeof RoomReadPayloadSchema>;
export type TakeCardPayload = z.infer<typeof TakeCardPayloadSchema>;
