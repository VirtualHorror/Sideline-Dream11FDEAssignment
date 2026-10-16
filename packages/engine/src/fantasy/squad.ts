/**
 * Fantasy squad validation (Dream11-style team rules).
 *
 * Callers:
 *   - scripts/verify-data.ts and test/fixtures.test.ts: prove authored personas are legal teams.
 *   - Phase 1 "Lineup Patch" (Task 9): every swap the LLM proposes is re-checked here;
 *     an illegal suggestion is discarded, never shown ("LLM proposes, rules dispose").
 *
 * Takes a loose draft (not the zod-refined FantasySquad) on purpose: it must be able
 * to describe *why* an arbitrary, possibly broken squad is invalid.
 */
import type { Player } from "../contracts/match.ts";
import type { Role } from "../contracts/primitives.ts";
import type { FantasyRules } from "../contracts/rules.ts";

export type SquadIssueCode =
  | "size"
  | "duplicate"
  | "unknown_player"
  | "credits"
  | "role_min"
  | "role_max"
  | "team_max"
  | "captain"
  | "vice_captain";

export interface SquadIssue {
  code: SquadIssueCode;
  message: string;
}

export interface SquadDraft {
  playerIds: readonly string[];
  captainId: string;
  viceCaptainId: string;
}

export interface SquadValidation {
  valid: boolean;
  issues: SquadIssue[];
  /** Sum of credits of the distinct, known players in the draft. */
  credits: number;
  roleCounts: Record<Role, number>;
  teamCounts: Record<string, number>;
}

const ROLES: readonly Role[] = ["WK", "BAT", "AR", "BOWL"];

export function validateSquad(
  squad: SquadDraft,
  pool: readonly Player[],
  team: FantasyRules["team"],
): SquadValidation {
  const byId = new Map(pool.map((player) => [player.id, player]));
  const issues: SquadIssue[] = [];

  if (squad.playerIds.length !== team.size) {
    issues.push({
      code: "size",
      message: `squad has ${squad.playerIds.length} players; it needs ${team.size}`,
    });
  }

  const unique = new Set(squad.playerIds);
  if (unique.size !== squad.playerIds.length) {
    issues.push({ code: "duplicate", message: "the same player appears more than once" });
  }

  // Composition is computed over distinct players we know; unknown ids are reported, not counted.
  const known: Player[] = [];
  for (const id of unique) {
    const player = byId.get(id);
    if (player) known.push(player);
    else issues.push({ code: "unknown_player", message: `player ${id} is not in either squad` });
  }

  // Credits are half-point multiples, which are exact in binary floating point, so no rounding.
  const credits = known.reduce((sum, player) => sum + player.credits, 0);
  if (credits > team.credits) {
    issues.push({
      code: "credits",
      message: `uses ${credits} credits; the budget is ${team.credits}`,
    });
  }

  const roleCounts: Record<Role, number> = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  const teamCounts: Record<string, number> = {};
  for (const player of known) {
    roleCounts[player.role] += 1;
    teamCounts[player.team] = (teamCounts[player.team] ?? 0) + 1;
  }

  for (const role of ROLES) {
    const [min, max] = team.roles[role];
    const count = roleCounts[role];
    if (count < min)
      issues.push({
        code: "role_min",
        message: `${role}: ${count} picked, at least ${min} needed`,
      });
    if (count > max)
      issues.push({
        code: "role_max",
        message: `${role}: ${count} picked, at most ${max} allowed`,
      });
  }

  for (const [code, count] of Object.entries(teamCounts)) {
    if (count > team.maxFromOneTeam) {
      issues.push({
        code: "team_max",
        message: `${count} players from ${code}; at most ${team.maxFromOneTeam} allowed`,
      });
    }
  }

  if (!unique.has(squad.captainId)) {
    issues.push({ code: "captain", message: "the captain must be one of the eleven" });
  }
  if (!unique.has(squad.viceCaptainId) || squad.viceCaptainId === squad.captainId) {
    issues.push({
      code: "vice_captain",
      message: "the vice-captain must be one of the eleven and differ from the captain",
    });
  }

  return { valid: issues.length === 0, issues, credits, roleCounts, teamCounts };
}
