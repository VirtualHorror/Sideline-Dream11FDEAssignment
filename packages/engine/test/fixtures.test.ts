/**
 * Data-integrity tests for the authored fixtures in data/ against the real Cricsheet files.
 * These are the guard rails for every later task: if a fixture drifts from the raw data
 * (wrong registry id, a missing squad member, an illegal persona team), detectors would
 * silently fire at the wrong balls. Expected values below are hand-derived from the raw
 * files and public squad lists, never computed by the code under test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FantasyRulesSchema,
  MatchContextFileSchema,
  PersonasFileSchema,
  PlayersFileSchema,
  validateSquad,
} from "../src/index.ts";

const DATA = join(import.meta.dirname, "..", "..", "..", "data");
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(join(DATA, ...parts), "utf8"));

interface RawCricsheet {
  info: {
    teams: string[];
    players: Record<string, string[]>;
    registry: { people: Record<string, string> };
  };
}

const rules = FantasyRulesSchema.parse(readJson("rules", "t20-fantasy.json"));

// Hand-checked: who sat out in each match (public squad lists vs Cricsheet info.players).
const benchByMatch: Record<string, string[]> = {
  // Pant, Hooda, Chahal, Harshal Patel / Fakhar Zaman, Khushdil Shah, Mohammad Wasim Jr, Mohammad Hasnain
  "1298150": [
    "919a3be2",
    "73ad96ed",
    "57ee1fde",
    "f986ca1a",
    "1777c020",
    "fce581b5",
    "9e9af5f2",
    "8596fe80",
  ],
  // Jaiswal, Samson, Chahal, Siraj / Baartman, Coetzee, Fortuin, Rickelton
  "1415755": [
    "6c19c6e5",
    "a4cc73aa",
    "57ee1fde",
    "2f49c897",
    "6b9eb501",
    "3204c99f",
    "9a2fc964",
    "e66732f8",
  ],
};

describe.each(Object.keys(benchByMatch))("fixtures for match %s", (matchId) => {
  const raw = readJson("raw", "cricsheet", `${matchId}.json`) as RawCricsheet;
  const players = PlayersFileSchema.parse(readJson("matches", matchId, "players.json"));
  const context = MatchContextFileSchema.parse(readJson("matches", matchId, "context.json"));
  const personas = PersonasFileSchema.parse(readJson("matches", matchId, "personas.json"));
  const byId = new Map(players.players.map((pl) => [pl.id, pl]));

  it("maps both Cricsheet team names to team codes", () => {
    expect(context.teams.map((t) => t.cricsheetName).sort()).toEqual([...raw.info.teams].sort());
  });

  it("contains every real playing-XI player under the same registry id and team", () => {
    for (const team of context.teams) {
      const xi = raw.info.players[team.cricsheetName] ?? [];
      expect(xi).toHaveLength(11);
      for (const name of xi) {
        const id = raw.info.registry.people[name];
        const player = id ? byId.get(id) : undefined;
        expect(player, `${name} (${id}) missing from players.json`).toBeDefined();
        expect(player?.cricsheetName).toBe(name);
        expect(player?.team).toBe(team.code);
      }
    }
  });

  it("lists full 15-player squads whose non-XI members are exactly the known bench", () => {
    for (const team of context.teams) {
      expect(players.players.filter((pl) => pl.team === team.code)).toHaveLength(15);
    }
    const xiIds = new Set(
      Object.values(raw.info.players)
        .flat()
        .map((name) => raw.info.registry.people[name]),
    );
    const bench = players.players.filter((pl) => !xiIds.has(pl.id)).map((pl) => pl.id);
    expect(bench.sort()).toEqual([...(benchByMatch[matchId] ?? [])].sort());
  });

  it("gives every persona with a fantasy team a legal Dream11-style squad", () => {
    for (const persona of personas.personas) {
      if (!persona.squad) continue;
      const result = validateSquad(persona.squad, players.players, rules.team);
      expect(result.issues, `${persona.id}: ${JSON.stringify(result.issues)}`).toEqual([]);
    }
  });

  it("includes at least one pre-match persona whose squad holds benched players (Phase 1 story)", () => {
    const bench = new Set(benchByMatch[matchId]);
    const phaseOne = personas.personas.filter(
      (p) => p.joinAt.kind === "pre_match" && p.squad?.playerIds.some((id) => bench.has(id)),
    );
    expect(phaseOne.length).toBeGreaterThan(0);
  });
});

describe("rules fixture", () => {
  it("encodes captain and vice-captain multipliers that differ (C must outrank VC)", () => {
    expect(rules.team.captainMultiplier).toBeGreaterThan(rules.team.viceCaptainMultiplier);
  });
});
