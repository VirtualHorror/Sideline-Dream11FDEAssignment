import { describe, expect, it } from "vitest";
import { type PriorsFile, PriorsFileSchema, projectedPoints, projectSquad } from "../src/index.ts";
import { loadMatch, loadPriors, MATCH_IDS } from "./helpers/data.ts";

/** A hand-made priors file: k = 3 and round role means, so projections can be worked by hand. */
function handPriors(players: PriorsFile["players"]): PriorsFile {
  return PriorsFileSchema.parse({
    matchId: "1234567",
    asOf: "2026-01-01",
    source: "hand-checked",
    k: 3,
    roleMean: { WK: 31.25, BAT: 37.5, AR: 42.75, BOWL: 33.5 },
    players,
  });
}

const appearance = (points: number, index: number) => ({
  matchId: String(1_000_000 + index),
  date: `2025-12-${String(20 - index).padStart(2, "0")}`,
  points,
});

describe("projectedPoints (shrinkage toward the role mean)", () => {
  it("projects exactly the role mean for a player with no appearances", () => {
    const priors = handPriors({ "0000000a": { role: "AR", appearances: [], projected: 42.75 } });
    expect(projectedPoints("0000000a", priors)).toBe(42.75);
  });

  it("blends a short record with k role-mean pseudo-appearances", () => {
    // (60 + 20 + 3 × 37.5) / (2 + 3) = 192.5 / 5
    const priors = handPriors({
      "0000000b": { role: "BAT", appearances: [60, 20].map(appearance), projected: 38.5 },
    });
    expect(projectedPoints("0000000b", priors)).toBe(38.5);
  });

  it("leans on the player's own record when there are ten appearances", () => {
    // (10 + 20 + … + 100 + 3 × 33.5) / 13 = 650.5 / 13 = 50.038…, reported to 2 decimals
    const points = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    const priors = handPriors({
      "0000000c": { role: "BOWL", appearances: points.map(appearance), projected: 50.04 },
    });
    expect(projectedPoints("0000000c", priors)).toBe(50.04);
  });

  it("fails loudly for a player the priors file does not cover", () => {
    expect(() => projectedPoints("0000000d", handPriors({}))).toThrow(/0000000d/);
  });
});

const MATCH_DATES = { "1298150": "2022-10-23", "1415755": "2024-06-29" } as const;

describe.each(MATCH_IDS)("committed priors for %s", (id) => {
  it("covers every squad player with their own role and up to ten earlier appearances", () => {
    const priors = loadPriors(id);
    const { players } = loadMatch(id);
    expect(priors.matchId).toBe(id);
    expect(priors.asOf).toBe(MATCH_DATES[id]);
    expect(priors.k).toBe(3);
    expect(Object.keys(priors.players).sort()).toEqual(players.players.map((p) => p.id).sort());
    for (const player of players.players) {
      const entry = priors.players[player.id];
      expect(entry?.role).toBe(player.role);
      expect(entry?.appearances.length).toBeLessThanOrEqual(10);
      const dates = entry?.appearances.map((a) => a.date) ?? [];
      for (const date of dates) expect(date < priors.asOf).toBe(true);
      expect(dates).toEqual([...dates].sort().reverse());
    }
  });

  it("stores projections that the engine formula reproduces, all within 0-200", () => {
    const priors = loadPriors(id);
    for (const [playerId, entry] of Object.entries(priors.players)) {
      expect(entry.projected).toBeGreaterThanOrEqual(0);
      expect(entry.projected).toBeLessThanOrEqual(200);
      expect(projectedPoints(playerId, priors)).toBe(entry.projected);
    }
  });
});

describe("committed priors against the pre-Task-3 archive survey (HANDOFF4)", () => {
  it("finds ten appearances for all but the players with short T20I records", () => {
    const count = (id: (typeof MATCH_IDS)[number]) =>
      Object.values(loadPriors(id).players).filter((entry) => entry.appearances.length === 10)
        .length;
    expect(count("1298150")).toBe(29);
    expect(count("1415755")).toBe(27);
    expect(loadPriors("1298150").players["9c9af282"]?.appearances).toHaveLength(8); // Naseem Shah
    const final = loadPriors("1415755").players;
    expect(final["6b9eb501"]?.appearances).toHaveLength(6); // Ottneil Baartman
    expect(final["3204c99f"]?.appearances).toHaveLength(6); // Gerald Coetzee
    expect(final.e66732f8?.appearances).toHaveLength(3); // Ryan Rickelton
  });
});

describe("projectSquad", () => {
  it("equals the hand sum of projections times captain and vice-captain multipliers (babar-believer)", () => {
    const { personas, rules } = loadMatch("1298150");
    const priors = loadPriors("1298150");
    const squad = personas.personas.find((persona) => persona.id === "babar-believer")?.squad;
    if (!squad) throw new Error("babar-believer has no squad");
    const projection = projectSquad(squad, priors, rules);
    const multiplierOf = (playerId: string) =>
      playerId === "8a75e999" ? 2 : playerId === "2f26ac1a" ? 1.5 : 1; // captain Babar, vice Rizwan
    let handSum = 0;
    for (const playerId of squad.playerIds) {
      handSum += (priors.players[playerId]?.projected ?? Number.NaN) * multiplierOf(playerId);
    }
    expect(projection.total).toBe(handSum);
    expect(projection.perPlayer.map((p) => [p.playerId, p.multiplier])).toEqual(
      squad.playerIds.map((playerId) => [playerId, multiplierOf(playerId)]),
    );
    expect(projection.perPlayer.map((p) => p.projected)).toEqual(
      squad.playerIds.map((playerId) => priors.players[playerId]?.projected),
    );
  });
});
