/**
 * The guided story (Task 9, D-076): the beats a reviewer is walked through on one match, each one a
 * point the data chose (a persona's join point, a trigger the gate raised), never a hardcoded label.
 *
 * Callers: the server's GET /api/matches/:matchId/story (engine story/plan.ts builds it) and the web
 * story director (apps/web/src/story), which jumps to each beat's lead-in, waits for its moment on
 * the fan's TV clock and stops there with a callout.
 */
import { z } from "zod";
import { MatchIdSchema, MatchTimeSchema } from "./primitives.ts";
import { JumpTargetSchema } from "./session.ts";

const at = { eventId: z.string(), t: MatchTimeSchema };

export const StoryBeatSchema = z.discriminatedUnion("kind", [
  /** The XIs meet the story fan's team: jump to the toss, stop at the lineup patch. */
  z.object({ kind: z.literal("lineup"), jump: JumpTargetSchema, ...at, key: z.string() }),
  /** The story fan's captain or vice-captain falls cheaply: stop at the comeback quest. */
  z.object({ kind: z.literal("bailout"), jump: JumpTargetSchema, ...at, key: z.string() }),
  /** Jump to where a late joiner opens the app: stop at the catch-up reel. */
  z.object({
    kind: z.literal("catch_up"),
    jump: JumpTargetSchema,
    t: MatchTimeSchema,
    personaLabel: z.string(),
  }),
  /** The first big ball of the last innings' death overs: stop at its teaser and at its reveal. */
  z.object({ kind: z.literal("climax"), jump: JumpTargetSchema, ...at, key: z.string() }),
  /** The first room read from the climax ball on. */
  z.object({ kind: z.literal("room_read"), ...at, key: z.string() }),
  /** The match's end on the fan's TV. */
  z.object({ kind: z.literal("result"), ...at }),
]);
export type StoryBeat = z.infer<typeof StoryBeatSchema>;

export const StoryPlanSchema = z.object({
  matchId: MatchIdSchema,
  /** The persona the story watches as: the first pre-match fan with a fantasy team. */
  personaId: z.string(),
  personaLabel: z.string(),
  beats: z.array(StoryBeatSchema).min(1),
});
export type StoryPlan = z.infer<typeof StoryPlanSchema>;
