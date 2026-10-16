/**
 * Pre-match fantasy projections ("priors") from each player's recent real T20I form (D-013).
 *
 * Callers: scripts/build-models.ts (writes data/models/priors-<matchId>.json, storing
 * `projected` from projectedPoints below) and from Task 4 the lineup and bailout logic, which
 * compares squads before a ball is bowled. The appearances themselves are scored offline with the
 * Task 2 fantasy engine; this module only applies the shrinkage formula, so it stays pure.
 */
import { z } from "zod";
import type { FantasySquad } from "../contracts/persona.ts";
import { MatchIdSchema, PlayerIdSchema, RoleSchema } from "../contracts/primitives.ts";
import type { FantasyRules } from "../contracts/rules.ts";
import { round2 } from "../cricket/format.ts";

export const PriorsFileSchema = z.object({
  matchId: MatchIdSchema,
  /** The demo match date: every appearance is strictly earlier. */
  asOf: z.iso.date(),
  source: z.string().min(1),
  /** Pseudo-appearances at the role mean that a short record is shrunk toward. */
  k: z.number().positive(),
  /** Mean points per appearance for each role, pooled over the squad's appearances. */
  roleMean: z.object({ WK: z.number(), BAT: z.number(), AR: z.number(), BOWL: z.number() }),
  players: z.record(
    PlayerIdSchema,
    z.object({
      /** The player's role in our fixtures (D-042), which picks the role mean. */
      role: RoleSchema,
      /** Most recent first. */
      appearances: z.array(
        z.object({ matchId: MatchIdSchema, date: z.iso.date(), points: z.number() }),
      ),
      projected: z.number(),
    }),
  ),
});
export type PriorsFile = z.infer<typeof PriorsFileSchema>;

/**
 * `(Σ points + k·roleMean[role]) / (n + k)`, written as two terms so that a player with no
 * appearances gets exactly the role mean; reported to 2 decimals. Throws for a player the file
 * does not cover rather than inventing a number.
 */
export function projectedPoints(playerId: string, priors: PriorsFile): number {
  // Own keys only: `players` is a plain object, so `toString` or `constructor` would otherwise
  // look like an entry.
  const entry = Object.hasOwn(priors.players, playerId) ? priors.players[playerId] : undefined;
  if (!entry) throw new Error(`no priors for player ${playerId} in match ${priors.matchId}`);
  const n = entry.appearances.length;
  const total = entry.appearances.reduce((sum, appearance) => sum + appearance.points, 0);
  return round2(total / (n + priors.k) + (priors.k / (n + priors.k)) * priors.roleMean[entry.role]);
}

/** Projected squad total: each player's projection times their captain / vice-captain multiplier. */
export function projectSquad(
  squad: FantasySquad,
  priors: PriorsFile,
  rules: FantasyRules,
): { total: number; perPlayer: { playerId: string; projected: number; multiplier: number }[] } {
  const perPlayer = squad.playerIds.map((playerId) => ({
    playerId,
    projected: projectedPoints(playerId, priors),
    multiplier:
      playerId === squad.captainId
        ? rules.team.captainMultiplier
        : playerId === squad.viceCaptainId
          ? rules.team.viceCaptainMultiplier
          : 1,
  }));
  return {
    total: perPlayer.reduce((sum, player) => sum + player.projected * player.multiplier, 0),
    perPlayer,
  };
}
