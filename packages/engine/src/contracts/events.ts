/**
 * The canonical match event stream ("stadium timeline").
 *
 * Flow: the normalizer (engine/cricket, Task 2) turns a raw Cricsheet file plus the
 * authored fixtures into an ordered MatchEvent[]; the server's session clock releases
 * events whose `t` has been reached; every consumer (reducer, detectors, web client)
 * folds the same events, so state is always `fold(events up to t)` (event sourcing).
 *
 * Ids are stable across runs: `${matchId}:${seq padded to 4}`. AI cache keys and
 * catch-up citations reference these ids, so the normalizer must be deterministic.
 */
import { z } from "zod";
import { NoteCategorySchema } from "./match.ts";
import {
  InningsNumberSchema,
  MatchIdSchema,
  MatchTimeSchema,
  PlayerIdSchema,
  TeamCodeSchema,
} from "./primitives.ts";

const EventIdSchema = z.string().regex(/^\d{5,9}:\d{4}$/, "event id must be <matchId>:<seq4>");

const base = {
  id: EventIdSchema,
  /** Position in the stream, 0-based, strictly increasing. */
  seq: z.number().int().nonnegative(),
  /** Stadium time of the event (ms since coverage start). */
  t: MatchTimeSchema,
};

/** The id's numeric suffix must be the zero-padded seq, or citations and cache keys drift. */
function idMatchesSeq(e: { id: string; seq: number }): boolean {
  return e.id.split(":")[1] === String(e.seq).padStart(4, "0");
}
const idSeqMessage = { message: "id suffix must equal zero-padded seq", path: ["id"] };

export const WicketKindSchema = z.enum([
  "bowled",
  "caught",
  "caught and bowled",
  "lbw",
  "stumped",
  "run out",
  "hit wicket",
  "retired hurt",
  "retired out",
  "obstructing the field",
  "handled the ball",
  "hit the ball twice",
  "timed out",
]);
export type WicketKind = z.infer<typeof WicketKindSchema>;

export const WicketSchema = z.object({
  kind: WicketKindSchema,
  playerOut: PlayerIdSchema,
  /** Fielders involved (catcher, keeper, run-out throwers), as registry ids. */
  fielders: z.array(PlayerIdSchema),
  /** True when the bowler is credited with the wicket (not run outs, retirements, etc.). */
  creditedToBowler: z.boolean(),
});
export type Wicket = z.infer<typeof WicketSchema>;

const ExtrasSchema = z.object({
  wides: z.number().int().nonnegative(),
  noballs: z.number().int().nonnegative(),
  byes: z.number().int().nonnegative(),
  legbyes: z.number().int().nonnegative(),
  penalty: z.number().int().nonnegative(),
});
export type Extras = z.infer<typeof ExtrasSchema>;

export const DeliveryEventSchema = z
  .object({
    ...base,
    kind: z.literal("delivery"),
    innings: InningsNumberSchema,
    /** 0-based over index (0..19 in a T20). */
    over: z.number().int().min(0).max(19),
    /**
     * The legal-ball number this delivery is labelled with (1..6). A wide or no-ball
     * carries the number of the legal ball still to come, so "19.4 nb", "19.4 wd" and
     * "19.4 3b" can all share a label, as on any scorecard.
     */
    ballInOver: z.number().int().min(1).max(6),
    /** 1-based position of this delivery within the over, counting extras. */
    deliveryInOver: z.number().int().min(1),
    /** Scoreboard label, always `${over}.${ballInOver}`, e.g. "18.5". */
    label: z.string().regex(/^\d{1,2}\.[1-6]$/),
    batter: PlayerIdSchema,
    nonStriker: PlayerIdSchema,
    bowler: PlayerIdSchema,
    runs: z.object({
      batter: z.number().int().nonnegative(),
      extras: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    extras: ExtrasSchema,
    /** False for wides and no-balls: they do not count towards the six-ball over. */
    isLegal: z.boolean(),
    /** This delivery was a free hit (a no-ball preceded it; a wide carries it over). */
    isFreeHit: z.boolean(),
    /** 4 or 6 when the batter's runs came from a boundary; 0 otherwise (incl. all-run fours). */
    boundary: z.union([z.literal(0), z.literal(4), z.literal(6)]),
    wickets: z.array(WicketSchema).max(2),
  })
  .refine(idMatchesSeq, idSeqMessage)
  .refine((d) => d.isLegal === (d.extras.wides === 0 && d.extras.noballs === 0), {
    message: "isLegal must be false exactly when the delivery has wides or no-balls",
    path: ["isLegal"],
  })
  .refine((d) => d.runs.total === d.runs.batter + d.runs.extras, {
    message: "runs.total must equal runs.batter + runs.extras",
    path: ["runs", "total"],
  })
  .refine(
    (d) =>
      d.runs.extras ===
      d.extras.wides + d.extras.noballs + d.extras.byes + d.extras.legbyes + d.extras.penalty,
    { message: "runs.extras must equal the sum of the extras breakdown", path: ["runs", "extras"] },
  )
  .refine((d) => d.label === `${d.over}.${d.ballInOver}`, {
    message: "label must be <over>.<ballInOver>",
    path: ["label"],
  })
  .refine((d) => d.boundary === 0 || d.runs.batter === d.boundary, {
    message: "a boundary flag requires the batter to have scored exactly that many runs",
    path: ["boundary"],
  });
export type DeliveryEvent = z.infer<typeof DeliveryEventSchema>;

export const CoverageStartEventSchema = z
  .object({ ...base, kind: z.literal("coverage_start"), matchId: MatchIdSchema })
  .refine(idMatchesSeq, idSeqMessage);

/** Full squads (XI + bench) are public before the toss. */
export const SquadsEventSchema = z
  .object({
    ...base,
    kind: z.literal("squads"),
    squads: z
      .array(z.object({ team: TeamCodeSchema, playerIds: z.array(PlayerIdSchema).min(11) }))
      .length(2),
  })
  .refine(idMatchesSeq, idSeqMessage);

export const NoteEventSchema = z
  .object({
    ...base,
    kind: z.literal("note"),
    noteId: z.string(),
    category: NoteCategorySchema,
    title: z.string(),
    text: z.string(),
    sources: z.array(z.url()),
  })
  .refine(idMatchesSeq, idSeqMessage);

export const TossEventSchema = z
  .object({
    ...base,
    kind: z.literal("toss"),
    winner: TeamCodeSchema,
    decision: z.enum(["bat", "field"]),
  })
  .refine(idMatchesSeq, idSeqMessage);

export const PlayingXIEventSchema = z
  .object({
    ...base,
    kind: z.literal("playing_xi"),
    team: TeamCodeSchema,
    playerIds: z.array(PlayerIdSchema).length(11),
  })
  .refine(idMatchesSeq, idSeqMessage);

export const InningsStartEventSchema = z
  .object({
    ...base,
    kind: z.literal("innings_start"),
    innings: InningsNumberSchema,
    battingTeam: TeamCodeSchema,
    bowlingTeam: TeamCodeSchema,
    /** Present for the chasing innings: runs needed to win within `balls` legal balls. */
    target: z
      .object({ runs: z.number().int().positive(), balls: z.number().int().positive() })
      .nullable(),
  })
  .refine(idMatchesSeq, idSeqMessage);

export const InningsEndEventSchema = z
  .object({
    ...base,
    kind: z.literal("innings_end"),
    innings: InningsNumberSchema,
    runs: z.number().int().nonnegative(),
    wickets: z.number().int().min(0).max(10),
    legalBalls: z.number().int().min(0).max(120),
    reason: z.enum(["overs_complete", "all_out", "target_reached"]),
  })
  .refine(idMatchesSeq, idSeqMessage);

export const MatchEndEventSchema = z
  .object({
    ...base,
    kind: z.literal("match_end"),
    winner: TeamCodeSchema.nullable(),
    /** Human result line, e.g. "India won by 4 wickets". */
    resultText: z.string(),
    playerOfMatch: z.array(PlayerIdSchema),
  })
  .refine(idMatchesSeq, idSeqMessage);

export const MatchEventSchema = z.discriminatedUnion("kind", [
  CoverageStartEventSchema,
  SquadsEventSchema,
  NoteEventSchema,
  TossEventSchema,
  PlayingXIEventSchema,
  InningsStartEventSchema,
  DeliveryEventSchema,
  InningsEndEventSchema,
  MatchEndEventSchema,
]);
export type MatchEvent = z.infer<typeof MatchEventSchema>;
export type MatchEventKind = MatchEvent["kind"];
export type NoteEvent = z.infer<typeof NoteEventSchema>;
export type TossEvent = z.infer<typeof TossEventSchema>;
export type PlayingXIEvent = z.infer<typeof PlayingXIEventSchema>;
export type InningsStartEvent = z.infer<typeof InningsStartEventSchema>;
export type InningsEndEvent = z.infer<typeof InningsEndEventSchema>;
export type MatchEndEvent = z.infer<typeof MatchEndEventSchema>;
export type SquadsEvent = z.infer<typeof SquadsEventSchema>;
