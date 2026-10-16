/**
 * Phase 1 (toss to lock): the moment both playing XIs are announced, does the fan's fantasy
 * squad hold players who will not play? A benched pick scores nothing (DOMAIN §3), and the fan
 * has minutes before the first ball locks the team.
 *
 * Callers: the gate (every event) and, through the trigger, the lineup-patch skill (Task 8),
 * whose guard accepts only swaps listed here. Code decides who is benched and which swaps are
 * legal (validateSquad) and how they project (the priors file); the model only explains and picks.
 */
import type { Player } from "../contracts/match.ts";
import type { FantasySquad } from "../contracts/persona.ts";
import type { FantasyRules } from "../contracts/rules.ts";
import { validateSquad } from "../fantasy/squad.ts";
import { type PriorsFile, projectedPoints } from "../models/priors.ts";
import { fnv1a32 } from "../util/hash.ts";
import { playerIndex, playerRef } from "./facts.ts";
import type { Detector, LineupFacts, LineupSquadPlayer } from "./types.ts";

/** A lineup patch suggests at most this many replacements per benched pick. */
const MAX_SWAPS = 5;

/**
 * `lineup:<match>:<squad hash>:none`. The hash covers the sorted squad ids then the captain and
 * vice-captain, so pick order does not matter but the armbands do. "none" is the fan-intent slot
 * that Task 8 fills when the fan types a request (D-015).
 */
export function lineupKey(matchId: string, squad: FantasySquad): string {
  const canonical = [...[...squad.playerIds].sort(), squad.captainId, squad.viceCaptainId].join(
    ",",
  );
  return `lineup:${matchId}:${fnv1a32(canonical).toString(16).padStart(8, "0")}:none`;
}

/**
 * Legal single swaps for `outId`: every XI player not already picked whose swap leaves a squad
 * that passes validateSquad, best projection first (ties by id), at most five. A benched captain
 * or vice-captain hands the armband to the replacement, so the squad stays valid.
 */
export function enumerateSwaps(
  squad: FantasySquad,
  outId: string,
  players: readonly Player[],
  xiIds: readonly string[],
  rules: FantasyRules,
  priors: PriorsFile,
): { inId: string; projected: number; creditsAfter: number }[] {
  if (!squad.playerIds.includes(outId)) throw new Error(`${outId} is not in the squad`);
  const picked = new Set(squad.playerIds);
  const options: { inId: string; projected: number; creditsAfter: number }[] = [];
  for (const inId of new Set(xiIds)) {
    if (picked.has(inId)) continue;
    const swapIn = (id: string) => (id === outId ? inId : id);
    const draft = {
      playerIds: squad.playerIds.map(swapIn),
      captainId: swapIn(squad.captainId),
      viceCaptainId: swapIn(squad.viceCaptainId),
    };
    const result = validateSquad(draft, players, rules.team);
    if (!result.valid) continue;
    options.push({ inId, projected: projectedPoints(inId, priors), creditsAfter: result.credits });
  }
  options.sort((a, b) => b.projected - a.projected || (a.inId < b.inId ? -1 : 1));
  return options.slice(0, MAX_SWAPS);
}

export const lineupDetector: Detector = {
  name: "lineup",
  evaluate({ before, after, event, ctx }) {
    if (event.kind !== "playing_xi") return { outcome: "deterministic", reason: "not_xi_event" };
    // Both XIs are needed to know who sits out; the reducer keys them by team code.
    if (Object.keys(after.playingXI).length < 2) {
      return { outcome: "deterministic", reason: "one_xi_announced" };
    }
    if (Object.keys(before.playingXI).length >= 2) {
      return { outcome: "deterministic", reason: "xis_already_known" };
    }
    const squad = ctx.persona.squad;
    if (!squad) return { outcome: "deterministic", reason: "no_squad" };

    const xis = Object.entries(after.playingXI).map(([team, ids]) => ({ team, ids: ids ?? [] }));
    const xiIds = xis.flatMap((xi) => xi.ids);
    const playing = new Set(xiIds);
    const benched = squad.playerIds.filter((id) => !playing.has(id));
    if (benched.length === 0) return { outcome: "deterministic", reason: "squad_all_playing" };

    const index = playerIndex(ctx.players);
    const credits = (id: string) => index.get(id)?.credits ?? 0;
    const squadPlayer = (id: string): LineupSquadPlayer => ({
      ...playerRef(index, id),
      credits: credits(id),
      projected: projectedPoints(id, ctx.priors),
      armband: id === squad.captainId ? "C" : id === squad.viceCaptainId ? "VC" : null,
      playing: playing.has(id),
    });
    const facts: LineupFacts = {
      matchId: ctx.matchId,
      squad: {
        players: squad.playerIds.map(squadPlayer),
        captainId: squad.captainId,
        viceCaptainId: squad.viceCaptainId,
        credits: validateSquad(squad, ctx.players, ctx.rules.team).credits,
        budget: ctx.rules.team.credits,
      },
      notPlaying: benched.map((id) => ({
        ...squadPlayer(id),
        swaps: enumerateSwaps(squad, id, ctx.players, xiIds, ctx.rules, ctx.priors).map((swap) => ({
          ...playerRef(index, swap.inId),
          credits: credits(swap.inId),
          projected: swap.projected,
          creditsAfter: swap.creditsAfter,
        })),
      })),
      playingXI: xis.map((xi) => ({
        team: xi.team,
        players: xi.ids.map((id) => playerRef(index, id)),
      })),
      toss: after.toss ? { winner: after.toss.winner, decision: after.toss.decision } : null,
      notes: after.notes.map((note) => ({
        noteId: note.noteId,
        category: note.category,
        title: note.title,
        text: note.text,
      })),
    };
    return {
      outcome: "ai_trigger",
      reason: "squad_player_benched",
      trigger: {
        kind: "lineup_patch",
        key: lineupKey(ctx.matchId, squad),
        scope: "session",
        facts,
      },
    };
  },
};
