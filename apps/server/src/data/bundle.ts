/**
 * Match bundles: everything the server knows about one demo match, loaded and validated once at
 * boot from data/ (never from code, Constraint 1).
 *
 * Callers: src/index.ts (boot), the session manager (one bundle per session's match), the matches
 * route, the analytics rebuild (db/database.ts) and scripts/ai-smoke.ts. A bundle is read-only
 * after loading; sessions share it. Any invalid file fails the boot with the file named, the same
 * schemas the data gate (scripts/verify-data.ts) uses.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMatchSummary,
  buildTimeline,
  type ChatMessage,
  type CrowdCorpus,
  CrowdCorpusSchema,
  type FantasyRules,
  FantasyRulesSchema,
  joinSeq,
  type MatchContextFile,
  MatchContextFileSchema,
  type MatchEvent,
  type MatchSummary,
  type Persona,
  PersonasFileSchema,
  type Player,
  PlayersFileSchema,
  type PriorsFile,
  PriorsFileSchema,
  simulateCrowd,
  type WinProbModel,
  WinProbModelSchema,
} from "@sideline/engine";
import { z } from "zod";

export interface MatchBundle {
  summary: MatchSummary;
  /** The stadium timeline (`buildTimeline` on the raw Cricsheet file). */
  events: MatchEvent[];
  /** Both full squads, bench included (players.json). */
  players: Player[];
  context: MatchContextFile;
  personas: Persona[];
  rules: FantasyRules;
  winprob: WinProbModel;
  priors: PriorsFile;
  corpus: CrowdCorpus;
  /**
   * The match's one synthetic watch-along crowd (D-050): simulated once with the match id as the
   * seed and shared by every session, so a shared room read cites messages every fan has.
   */
  crowd: ChatMessage[];
}

const ManifestSchema = z.object({
  matches: z.array(z.object({ id: z.string().min(1), file: z.string().min(1) })).min(1),
});

/** Parses one data file, naming it in the error so a bad edit fails the boot legibly. */
function readData<T>(dataDir: string, parts: string[], schema: z.ZodType<T>, label: string): T {
  const path = join(dataDir, ...parts);
  if (!existsSync(path)) throw new Error(`${label}: ${parts.join("/")} is missing`);
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`${label}: ${parts.join("/")} is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Every persona's join point must exist in the timeline: a session starts there (PLAN 5.2), so a
 * persona that joins "after 14 overs" of an innings that never got that far is a data error.
 */
export function validateJoinPoints(
  matchId: string,
  events: readonly MatchEvent[],
  personas: readonly Persona[],
): void {
  for (const persona of personas) {
    try {
      joinSeq(events, persona.joinAt);
    } catch (error) {
      throw new Error(
        `${matchId}: personas.json persona ${persona.id}: ${(error as Error).message}`,
      );
    }
  }
}

/** Loads every match listed in data/raw/cricsheet/manifest.json, in manifest order. */
export function loadMatchBundles(dataDir: string): Map<string, MatchBundle> {
  const manifest = readData(dataDir, ["raw", "cricsheet", "manifest.json"], ManifestSchema, "data");
  const rules = readData(dataDir, ["rules", "t20-fantasy.json"], FantasyRulesSchema, "data");
  const winprob = readData(dataDir, ["models", "winprob-v1.json"], WinProbModelSchema, "data");
  const corpus = readData(dataDir, ["crowd", "corpus.json"], CrowdCorpusSchema, "data");

  const bundles = new Map<string, MatchBundle>();
  for (const entry of manifest.matches) {
    const id = entry.id;
    const raw: unknown = JSON.parse(
      readFileSync(join(dataDir, "raw", "cricsheet", entry.file), "utf8"),
    );
    const players = readData(dataDir, ["matches", id, "players.json"], PlayersFileSchema, id);
    const context = readData(dataDir, ["matches", id, "context.json"], MatchContextFileSchema, id);
    const personas = readData(dataDir, ["matches", id, "personas.json"], PersonasFileSchema, id);
    const priors = readData(dataDir, ["models", `priors-${id}.json`], PriorsFileSchema, id);
    for (const [file, matchId] of [
      ["players.json", players.matchId],
      ["context.json", context.matchId],
      ["personas.json", personas.matchId],
      [`priors-${id}.json`, priors.matchId],
    ] as const) {
      if (matchId !== id) throw new Error(`${id}: ${file} belongs to match ${matchId}`);
    }

    const events = buildTimeline({ raw, players, context });
    validateJoinPoints(id, events, personas.personas);
    bundles.set(id, {
      summary: buildMatchSummary(raw, context),
      events,
      players: players.players,
      context,
      personas: personas.personas,
      rules,
      winprob,
      priors,
      corpus,
      crowd: simulateCrowd({ events, players: players.players, corpus, seed: id }),
    });
  }
  return bundles;
}
