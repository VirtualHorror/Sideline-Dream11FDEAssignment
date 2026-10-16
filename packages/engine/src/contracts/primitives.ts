/**
 * Primitive value schemas shared by every contract.
 *
 * Why these exist: ids and time units travel between the engine (pure TS),
 * the server (Node) and the web app (browser). Pinning their shape here means
 * a wrong unit (seconds vs ms) or a wrong id kind (a player *name* where a
 * registry *id* belongs) fails validation at the boundary instead of silently
 * producing a wrong scorecard three layers later.
 */
import { z } from "zod";

/** Cricsheet match id (equals the ESPNcricinfo match id), e.g. "1298150". */
export const MatchIdSchema = z
  .string()
  .regex(/^\d{5,9}$/, "match id must be a Cricsheet numeric id");
export type MatchId = z.infer<typeof MatchIdSchema>;

/**
 * Cricsheet people-register identifier: 8 lowercase hex characters, e.g. "ba607b88".
 * Never a display name: names collide (two "Mohammad Wasim"s exist in the register).
 */
export const PlayerIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}$/, "player id must be an 8-char Cricsheet registry id");
export type PlayerId = z.infer<typeof PlayerIdSchema>;

/** Short uppercase team code used across the UI, e.g. "IND", "PAK", "SA". */
export const TeamCodeSchema = z
  .string()
  .regex(/^[A-Z]{2,4}$/, "team code must be 2-4 uppercase letters");
export type TeamCode = z.infer<typeof TeamCodeSchema>;

/** Dream11-style fantasy roles: wicket-keeper, batter, all-rounder, bowler. */
export const RoleSchema = z.enum(["WK", "BAT", "AR", "BOWL"]);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Match-clock time in integer milliseconds since coverage start.
 * This is the "stadium" timeline: the moment something happens at the ground.
 * A viewer's TV shows the same instant later, at `t + delayMs` of their clock.
 */
export const MatchTimeSchema = z.number().int().nonnegative();
export type MatchTime = z.infer<typeof MatchTimeSchema>;

/** How Sideline explains the game: plain English, tactical, or cross-sport analogies. */
export const LensSchema = z.enum(["casual", "analyst", "f1", "football", "engineer"]);
export type Lens = z.infer<typeof LensSchema>;

/** CSS hex colour, "#RRGGBB". */
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colour must be #RRGGBB");

/** Innings number in a T20 match (super overs are out of scope). */
export const InningsNumberSchema = z.union([z.literal(1), z.literal(2)]);
export type InningsNumber = z.infer<typeof InningsNumberSchema>;
