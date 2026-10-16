/**
 * Static match metadata contracts.
 *
 * Two sources feed these shapes:
 *   1. data/raw/cricsheet/<id>.json  - real ball-by-ball data (ODC-By 1.0), read by the normalizer.
 *   2. data/matches/<id>/{players,context}.json - small authored fixtures that Cricsheet
 *      does not carry: full squads incl. benched players, display names, fantasy roles,
 *      illustrative credits, team colours and sourced pre-match notes.
 * The server's data loader validates both fixtures against these schemas at boot.
 */
import { z } from "zod";
import {
  HexColorSchema,
  MatchIdSchema,
  PlayerIdSchema,
  RoleSchema,
  TeamCodeSchema,
} from "./primitives.ts";

/** Fantasy credits are authored in half-point steps (Dream11 convention), 6.0 to 11.0. */
const CreditsSchema = z
  .number()
  .min(6)
  .max(11)
  .refine((c) => Number.isInteger(c * 2), "credits move in 0.5 steps");

export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  /** Name exactly as it appears in the Cricsheet file (scorecard short form, e.g. "V Kohli"). */
  cricsheetName: z.string().min(1),
  /** Full display name, e.g. "Virat Kohli". */
  displayName: z.string().min(1),
  /** What commentary and cards call the player, e.g. "Kohli". */
  shortName: z.string().min(1),
  team: TeamCodeSchema,
  role: RoleSchema,
  credits: CreditsSchema,
});
export type Player = z.infer<typeof PlayerSchema>;

/** data/matches/<id>/players.json: the full squads (playing XI + bench) for both teams. */
export const PlayersFileSchema = z.object({
  matchId: MatchIdSchema,
  creditsNote: z.string(),
  players: z.array(PlayerSchema).min(22),
});
export type PlayersFile = z.infer<typeof PlayersFileSchema>;

export const TeamSchema = z.object({
  code: TeamCodeSchema,
  name: z.string().min(1),
  /** Team name exactly as Cricsheet writes it (used to map raw data to `code`). */
  cricsheetName: z.string().min(1),
  color: HexColorSchema,
  colorAlt: HexColorSchema,
});
export type Team = z.infer<typeof TeamSchema>;

export const NoteCategorySchema = z.enum(["weather", "injury", "pitch", "team_news", "context"]);

/** A sourced pre-match note (weather, injury, venue). Delivered as a `note` event before the toss. */
export const PreMatchNoteSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: NoteCategorySchema,
  title: z.string().min(1),
  text: z.string().min(1),
  /** Public URLs backing the note. Empty only for general, uncontested venue facts. */
  sources: z.array(z.url()),
});
export type PreMatchNote = z.infer<typeof PreMatchNoteSchema>;

/** data/matches/<id>/context.json */
export const MatchContextFileSchema = z.object({
  matchId: MatchIdSchema,
  title: z.string().min(1),
  competition: z.string().min(1),
  stage: z.string().min(1),
  teams: z.tuple([TeamSchema, TeamSchema]),
  notes: z.array(PreMatchNoteSchema),
});
export type MatchContextFile = z.infer<typeof MatchContextFileSchema>;

/** Compact description of a match for menus and the SSE `hello` message. */
export const MatchSummarySchema = z.object({
  id: MatchIdSchema,
  title: z.string(),
  competition: z.string(),
  stage: z.string(),
  venue: z.string(),
  city: z.string().nullable(),
  /** ISO date of the match, e.g. "2022-10-23". */
  date: z.iso.date(),
  teams: z.tuple([TeamSchema, TeamSchema]),
});
export type MatchSummary = z.infer<typeof MatchSummarySchema>;
