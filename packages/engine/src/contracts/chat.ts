/**
 * Watch-along chat messages.
 *
 * In the demo the crowd is synthetic (engine/crowd, seeded and labelled as such);
 * the fan's own messages are real. Messages are stamped in stadium time, so the
 * client's delay buffer holds them back exactly like match events: a creator's
 * "OUT!" never reaches a fan before their own TV shows the wicket.
 */
import { z } from "zod";
import { MatchTimeSchema, TeamCodeSchema } from "./primitives.ts";

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  t: MatchTimeSchema,
  handle: z.string().min(1).max(24),
  affinity: z.union([TeamCodeSchema, z.literal("neutral")]),
  text: z.string().min(1).max(280),
  lang: z.enum(["en", "hinglish", "hi"]),
  /** Stance tag from the crowd corpus (e.g. "pro-batter"); null for real fan messages. */
  stance: z.string().nullable(),
  /** True for simulated crowd messages. The UI labels them. */
  synthetic: z.boolean(),
  /** True for messages the current fan typed. */
  fromYou: z.boolean(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
