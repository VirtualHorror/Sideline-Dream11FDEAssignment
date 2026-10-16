/**
 * Fantasy rules configuration (data/rules/t20-fantasy.json).
 *
 * Team-building constraints and the points table are data, not code, so they can be
 * swapped for Dream11's official values without touching the scoring engine. The
 * shipped values are an illustrative Dream11-style T20 table (see the file's
 * `disclaimer` and docs/Decisions.md D-012).
 */
import { z } from "zod";
import { RoleSchema } from "./primitives.ts";

const RangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([min, max]) => min <= max, "range min must be <= max");

/**
 * A rate slab: matches when (min === null || rate >= min) && (max === null || rate <= max),
 * comparing the rate rounded to 2 decimals. Gaps between slabs score 0.
 */
const SlabSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  points: z.number(),
});

export const FantasyRulesSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  disclaimer: z.string().min(1),
  team: z.object({
    size: z.literal(11),
    credits: z.number().positive(),
    maxFromOneTeam: z.number().int().min(1).max(11),
    roles: z.object({ WK: RangeSchema, BAT: RangeSchema, AR: RangeSchema, BOWL: RangeSchema }),
    captainMultiplier: z.number().positive(),
    viceCaptainMultiplier: z.number().positive(),
  }),
  points: z.object({
    playingXI: z.number(),
    batting: z.object({
      run: z.number(),
      boundaryBonus: z.number(),
      sixBonus: z.number(),
      milestones: z.array(z.object({ runs: z.number().int().positive(), bonus: z.number() })),
      /** "highest": only the top milestone reached scores; "cumulative": every one reached scores. */
      milestoneMode: z.enum(["highest", "cumulative"]),
      duck: z.number(),
      duckRoles: z.array(RoleSchema),
    }),
    bowling: z.object({
      dotBall: z.number(),
      wicket: z.number(),
      lbwBowledBonus: z.number(),
      hauls: z.array(z.object({ wickets: z.number().int().positive(), bonus: z.number() })),
      haulMode: z.enum(["highest", "cumulative"]),
      maiden: z.number(),
    }),
    fielding: z.object({
      catch: z.number(),
      threeCatchBonus: z.number(),
      stumping: z.number(),
      runOutDirect: z.number(),
      runOutIndirect: z.number(),
    }),
    economy: z.object({ minBalls: z.number().int().positive(), slabs: z.array(SlabSchema) }),
    strikeRate: z.object({
      minBalls: z.number().int().positive(),
      exemptRoles: z.array(RoleSchema),
      slabs: z.array(SlabSchema),
    }),
  }),
});
export type FantasyRules = z.infer<typeof FantasyRulesSchema>;
