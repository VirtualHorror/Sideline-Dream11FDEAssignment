/**
 * Fantasy point calculation from reducer state; callers supply player and rule data.
 *
 * Callers: scripts/engine-report.ts (oracle comparison), scripts/build-models.ts (player priors
 * from archive matches) and, from Tasks 5-6, the server session and the web client's live panel.
 * Everything is read from `MatchState`, so a live state scores exactly like a finished one.
 */

import type { Player } from "../contracts/match.ts";
import type { FantasySquad } from "../contracts/persona.ts";
import type { FantasyRules } from "../contracts/rules.ts";
import type { InningsState, MatchState } from "../contracts/state.ts";
import { round2 } from "../cricket/format.ts";

export interface PlayerPoints {
  playerId: string;
  total: number;
  breakdown: Record<string, number>;
}

export interface SquadPoints {
  total: number;
  perPlayer: { playerId: string; base: number; multiplier: number; points: number }[];
}

function slabPoints(
  rate: number,
  slabs: readonly { min: number | null; max: number | null; points: number }[],
): number {
  const roundedRate = round2(rate);
  return (
    slabs.find(
      (slab) =>
        (slab.min === null || roundedRate >= slab.min) &&
        (slab.max === null || roundedRate <= slab.max),
    )?.points ?? 0
  );
}

function milestonePoints(runs: number, rules: FantasyRules): number {
  const reached = rules.points.batting.milestones.filter((milestone) => runs >= milestone.runs);
  if (reached.length === 0) return 0;
  if (rules.points.batting.milestoneMode === "cumulative") {
    return reached.reduce((sum, milestone) => sum + milestone.bonus, 0);
  }
  return reached.reduce((highest, milestone) =>
    milestone.runs > highest.runs ? milestone : highest,
  ).bonus;
}

function haulPoints(wickets: number, rules: FantasyRules): number {
  const reached = rules.points.bowling.hauls.filter((haul) => wickets >= haul.wickets);
  if (reached.length === 0) return 0;
  if (rules.points.bowling.haulMode === "cumulative") {
    return reached.reduce((sum, haul) => sum + haul.bonus, 0);
  }
  return reached.reduce((highest, haul) => (haul.wickets > highest.wickets ? haul : highest)).bonus;
}

export function fantasyPoints(
  state: MatchState,
  players: readonly Player[],
  rules: FantasyRules,
): Map<string, PlayerPoints> {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const scores = new Map<string, PlayerPoints>();
  for (const playerIds of Object.values(state.playingXI)) {
    for (const playerId of playerIds ?? []) {
      if (!scores.has(playerId)) {
        scores.set(playerId, {
          playerId,
          total: rules.points.playingXI,
          breakdown: rules.points.playingXI === 0 ? {} : { playingXI: rules.points.playingXI },
        });
      }
    }
  }

  // Only the announced XI scores (DOMAIN §3, D-038). A substitute fielder credited with a catch
  // or run out has no entry here, so the credit is dropped on purpose; the oracle agrees since
  // BUG-001 was fixed.
  const add = (playerId: string, key: string, value: number): void => {
    if (value === 0) return;
    const score = scores.get(playerId);
    if (!score) return;
    score.total += value;
    score.breakdown[key] = (score.breakdown[key] ?? 0) + value;
  };

  const totalCatches = new Map<string, number>();
  for (const innings of state.innings) {
    scoreBatting(innings, playersById, rules, add);
    scoreBowling(innings, rules, add);
    scoreFielding(innings, totalCatches, rules, add);
  }

  for (const [playerId, catches] of totalCatches) {
    if (catches >= 3) add(playerId, "threeCatchBonus", rules.points.fielding.threeCatchBonus);
  }

  for (const score of scores.values()) {
    for (const [key, value] of Object.entries(score.breakdown)) {
      if (value === 0) delete score.breakdown[key];
    }
  }
  return scores;
}

function scoreBatting(
  innings: InningsState,
  playersById: ReadonlyMap<string, Player>,
  rules: FantasyRules,
  add: (playerId: string, key: string, value: number) => void,
): void {
  const batting = rules.points.batting;
  const strikeRateRules = rules.points.strikeRate;
  for (const batter of innings.batters) {
    const player = playersById.get(batter.playerId);
    add(batter.playerId, "runs", batter.runs * batting.run);
    add(batter.playerId, "boundaryBonus", batter.fours * batting.boundaryBonus);
    add(batter.playerId, "sixBonus", batter.sixes * batting.sixBonus);
    add(batter.playerId, "milestone", milestonePoints(batter.runs, rules));
    if (
      batter.out &&
      batter.out.kind !== "retired hurt" &&
      batter.runs === 0 &&
      player &&
      batting.duckRoles.includes(player.role)
    ) {
      add(batter.playerId, "duck", batting.duck);
    }
    if (
      batter.balls >= strikeRateRules.minBalls &&
      player &&
      !strikeRateRules.exemptRoles.includes(player.role)
    ) {
      add(
        batter.playerId,
        "strikeRate",
        slabPoints((batter.runs * 100) / batter.balls, strikeRateRules.slabs),
      );
    }
  }
}

function scoreBowling(
  innings: InningsState,
  rules: FantasyRules,
  add: (playerId: string, key: string, value: number) => void,
): void {
  const bowling = rules.points.bowling;
  const economyRules = rules.points.economy;
  const lbwBowled = new Map<string, number>();
  for (const batter of innings.batters) {
    if (batter.out?.bowlerId && (batter.out.kind === "lbw" || batter.out.kind === "bowled")) {
      lbwBowled.set(batter.out.bowlerId, (lbwBowled.get(batter.out.bowlerId) ?? 0) + 1);
    }
  }

  for (const bowler of innings.bowlers) {
    add(bowler.playerId, "dotBall", bowler.dots * bowling.dotBall);
    add(bowler.playerId, "wicket", bowler.wickets * bowling.wicket);
    add(
      bowler.playerId,
      "lbwBowledBonus",
      (lbwBowled.get(bowler.playerId) ?? 0) * bowling.lbwBowledBonus,
    );
    add(bowler.playerId, "haul", haulPoints(bowler.wickets, rules));
    add(bowler.playerId, "maiden", bowler.maidens * bowling.maiden);
    if (bowler.legalBalls >= economyRules.minBalls) {
      add(
        bowler.playerId,
        "economy",
        slabPoints((bowler.runsConceded * 6) / bowler.legalBalls, economyRules.slabs),
      );
    }
  }
}

function scoreFielding(
  innings: InningsState,
  totalCatches: Map<string, number>,
  rules: FantasyRules,
  add: (playerId: string, key: string, value: number) => void,
): void {
  const fielding = rules.points.fielding;
  for (const batter of innings.batters) {
    const out = batter.out;
    if (!out) continue;
    if (out.kind === "caught") {
      const fielderId = out.fielderIds[0];
      if (fielderId) {
        totalCatches.set(fielderId, (totalCatches.get(fielderId) ?? 0) + 1);
        add(fielderId, "catch", fielding.catch);
      }
    } else if (out.kind === "caught and bowled" && out.bowlerId) {
      totalCatches.set(out.bowlerId, (totalCatches.get(out.bowlerId) ?? 0) + 1);
      add(out.bowlerId, "catch", fielding.catch);
    } else if (out.kind === "stumped") {
      const fielderId = out.fielderIds[0];
      if (fielderId) add(fielderId, "stumping", fielding.stumping);
    } else if (out.kind === "run out") {
      if (out.fielderIds.length === 1 && out.fielderIds[0]) {
        add(out.fielderIds[0], "runOutDirect", fielding.runOutDirect);
      } else if (out.fielderIds.length > 1) {
        for (const fielderId of out.fielderIds.slice(-2))
          add(fielderId, "runOutIndirect", fielding.runOutIndirect);
      }
    }
  }
}

export function squadPoints(
  points: Map<string, PlayerPoints>,
  squad: FantasySquad,
  rules: FantasyRules,
): SquadPoints {
  const perPlayer = squad.playerIds.map((playerId) => {
    const base = points.get(playerId)?.total ?? 0;
    const multiplier =
      playerId === squad.captainId
        ? rules.team.captainMultiplier
        : playerId === squad.viceCaptainId
          ? rules.team.viceCaptainMultiplier
          : 1;
    return { playerId, base, multiplier, points: base * multiplier };
  });
  return { total: perPlayer.reduce((sum, player) => sum + player.points, 0), perPlayer };
}
