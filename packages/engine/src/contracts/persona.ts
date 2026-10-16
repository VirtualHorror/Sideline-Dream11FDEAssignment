/**
 * Fan personas (data/matches/<id>/personas.json).
 *
 * Reviewers have no Dream11 account, so the demo lets them "be" a fan: a persona
 * carries a pre-toss fantasy squad (or none), a team affinity, a preferred
 * explanation lens, the delay of the stream they watch, and when they open the app.
 * Everything a detector personalises on comes from here, never from code.
 */
import { z } from "zod";
import {
  InningsNumberSchema,
  LensSchema,
  MatchIdSchema,
  PlayerIdSchema,
  TeamCodeSchema,
} from "./primitives.ts";

export const MAX_DELAY_MS = 60_000;

export const FantasySquadSchema = z
  .object({
    playerIds: z.array(PlayerIdSchema).length(11),
    captainId: PlayerIdSchema,
    viceCaptainId: PlayerIdSchema,
  })
  .refine((s) => new Set(s.playerIds).size === s.playerIds.length, {
    message: "a squad cannot contain the same player twice",
    path: ["playerIds"],
  })
  .refine((s) => s.playerIds.includes(s.captainId), {
    message: "captain must be in the squad",
    path: ["captainId"],
  })
  .refine((s) => s.playerIds.includes(s.viceCaptainId), {
    message: "vice-captain must be in the squad",
    path: ["viceCaptainId"],
  })
  .refine((s) => s.captainId !== s.viceCaptainId, {
    message: "captain and vice-captain must be different players",
    path: ["viceCaptainId"],
  });
export type FantasySquad = z.infer<typeof FantasySquadSchema>;

/** When the fan opens the app: before the toss, or after N completed overs of an innings. */
export const JoinAtSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pre_match") }),
  z.object({
    kind: z.literal("over"),
    innings: InningsNumberSchema,
    /** Join at the scoreboard label `${afterOvers}.0` of that innings. */
    afterOvers: z.number().int().min(0).max(19),
  }),
]);
export type JoinAt = z.infer<typeof JoinAtSchema>;

export const PersonaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(40),
  blurb: z.string().min(1).max(240),
  affinity: z.union([TeamCodeSchema, z.literal("neutral")]),
  lens: LensSchema,
  /** How far the fan's TV/stream lags the stadium, in ms (0 = at the ground). */
  delayMs: z.number().int().min(0).max(MAX_DELAY_MS),
  joinAt: JoinAtSchema,
  squad: FantasySquadSchema.nullable(),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const PersonasFileSchema = z.object({
  matchId: MatchIdSchema,
  personas: z.array(PersonaSchema).min(1).max(6),
});
export type PersonasFile = z.infer<typeof PersonasFileSchema>;
