/** Shared, schema-checked fixtures for the engine tests. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FantasyRules,
  FantasyRulesSchema,
  type MatchContextFile,
  MatchContextFileSchema,
  type PersonasFile,
  PersonasFileSchema,
  type PlayersFile,
  PlayersFileSchema,
} from "../../src/index.ts";

export const MATCH_IDS = ["1298150", "1415755"] as const;
export type FixtureMatchId = (typeof MATCH_IDS)[number];

export interface RawDelivery {
  actual_delivery?: string;
  batter: string;
  non_striker: string;
  bowler: string;
  runs: {
    batter: number;
    extras: number;
    total: number;
    non_boundary?: boolean;
  };
  extras?: {
    wides?: number;
    noballs?: number;
    byes?: number;
    legbyes?: number;
    penalty?: number;
  };
  wickets?: {
    player_out: string;
    kind: string;
    fielders?: { name: string }[];
  }[];
}

export interface RawInnings {
  team: string;
  overs: { over: number; deliveries: RawDelivery[] }[];
  target?: { runs: number; overs: number };
}

export interface CricsheetRaw {
  info: {
    teams: string[];
    players: Record<string, string[]>;
    registry: { people: Record<string, string> };
    toss: { winner: string; decision: "bat" | "field" };
    outcome: {
      winner?: string;
      result?: string;
      by?: { runs?: number; wickets?: number };
      method?: string;
    };
    player_of_match?: string[];
    [key: string]: unknown;
  };
  innings: RawInnings[];
}

export interface GoldenInnings {
  innings: number;
  team: string;
  totals: {
    runs: number;
    wickets: number;
    legal_balls: number;
    deliveries: number;
    extras: {
      wides: number;
      noballs: number;
      byes: number;
      legbyes: number;
      penalty: number;
    };
  };
  batters: Record<
    string,
    {
      name: string;
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      dots: number;
      strike_rate: number;
      out: string | null;
    }
  >;
  bowlers: Record<
    string,
    {
      name: string;
      legal_balls: number;
      conceded: number;
      wickets: number;
      lbw_bowled: number;
      maidens: number;
      dots: number;
      wides: number;
      noballs: number;
      overs: string;
      economy: number;
    }
  >;
  fall_of_wickets: {
    wicket: number;
    runs: number;
    label: string;
    player: string;
    kind: string;
    bowler: string | null;
  }[];
}

export interface GoldenFixture {
  innings: GoldenInnings[];
  fantasy: Record<string, { total: number; breakdown: Record<string, number> }>;
}

export interface MatchFixture {
  raw: CricsheetRaw;
  players: PlayersFile;
  context: MatchContextFile;
  personas: PersonasFile;
  rules: FantasyRules;
  golden: GoldenFixture;
}

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(join(ROOT, ...parts), "utf8"));

export function loadMatch(id: FixtureMatchId): MatchFixture {
  return {
    raw: readJson("data", "raw", "cricsheet", `${id}.json`) as CricsheetRaw,
    players: PlayersFileSchema.parse(readJson("data", "matches", id, "players.json")),
    context: MatchContextFileSchema.parse(readJson("data", "matches", id, "context.json")),
    personas: PersonasFileSchema.parse(readJson("data", "matches", id, "personas.json")),
    rules: FantasyRulesSchema.parse(readJson("data", "rules", "t20-fantasy.json")),
    golden: readJson("packages", "engine", "test", "golden", `${id}.oracle.json`) as GoldenFixture,
  };
}
