/** Minimal permissive Cricsheet contracts consumed by the timeline normalizer. */
import { z } from "zod";

const CricsheetFielderSchema = z.object({ name: z.string().min(1) }).passthrough();
const CricsheetWicketSchema = z
  .object({
    player_out: z.string().min(1),
    kind: z.string().min(1),
    fielders: z.array(CricsheetFielderSchema).optional(),
  })
  .passthrough();

const CricsheetDeliverySchema = z
  .object({
    batter: z.string().min(1),
    non_striker: z.string().min(1),
    bowler: z.string().min(1),
    runs: z
      .object({
        batter: z.number().int().nonnegative(),
        extras: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        non_boundary: z.boolean().optional(),
      })
      .passthrough(),
    extras: z.record(z.string(), z.number().int().nonnegative()).optional(),
    wickets: z.array(CricsheetWicketSchema).optional(),
  })
  .passthrough();

const CricsheetOverSchema = z
  .object({
    over: z.number().int().nonnegative(),
    deliveries: z.array(CricsheetDeliverySchema).min(1),
  })
  .passthrough();

const CricsheetInningsSchema = z
  .object({
    team: z.string().min(1),
    overs: z.array(CricsheetOverSchema).min(1),
    target: z
      .object({ runs: z.number().int().positive(), overs: z.number().positive() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const CricsheetMatchSchema = z
  .object({
    info: z
      .object({
        dates: z.array(z.iso.date()).min(1),
        venue: z.string().min(1),
        city: z.string().min(1).nullable().optional(),
        teams: z.array(z.string().min(1)).length(2),
        players: z.record(z.string(), z.array(z.string().min(1))),
        registry: z.object({ people: z.record(z.string(), z.string().min(1)) }).passthrough(),
        toss: z
          .object({ winner: z.string().min(1), decision: z.enum(["bat", "field"]) })
          .passthrough(),
        outcome: z
          .object({
            winner: z.string().min(1).optional(),
            result: z.string().optional(),
            by: z
              .object({
                runs: z.number().int().nonnegative().optional(),
                wickets: z.number().int().nonnegative().optional(),
              })
              .passthrough()
              .optional(),
            method: z.string().optional(),
          })
          .passthrough()
          .optional(),
        player_of_match: z.array(z.string().min(1)).optional(),
      })
      .passthrough(),
    innings: z.array(CricsheetInningsSchema).length(2),
  })
  .passthrough();

export type CricsheetMatch = z.infer<typeof CricsheetMatchSchema>;
