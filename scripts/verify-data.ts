/**
 * Data gate: proves data/ is intact and internally consistent before anything ships.
 *
 * Usage: node scripts/verify-data.ts [--data <dataDir>]
 *
 * Checks, per match listed in data/raw/cricsheet/manifest.json:
 *   - the raw Cricsheet file exists and its sha256 matches the manifest (provenance)
 *   - data/matches/<id>/{players,context,personas}.json parse against the engine schemas
 *   - every persona's fantasy squad is legal under data/rules/t20-fantasy.json
 * and that every data/matches/<id> folder is listed in the manifest (no untracked data).
 * Uses the engine's own schemas and validator (relative import; runs under Node 24 directly).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FantasyRulesSchema,
  MatchContextFileSchema,
  PersonasFileSchema,
  PlayersFileSchema,
  validateSquad,
} from "../packages/engine/src/index.ts";

interface Manifest {
  matches: { id: string; file: string; sha256: string; description: string }[];
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

export function verifyData(dataDir: string): { problems: string[]; lines: string[] } {
  const problems: string[] = [];
  const lines: string[] = [];

  const manifest = readJson(join(dataDir, "raw", "cricsheet", "manifest.json")) as Manifest;
  const rulesResult = FantasyRulesSchema.safeParse(
    readJson(join(dataDir, "rules", "t20-fantasy.json")),
  );
  if (!rulesResult.success) problems.push(`rules/t20-fantasy.json: ${rulesResult.error.message}`);

  for (const entry of manifest.matches) {
    const rawPath = join(dataDir, "raw", "cricsheet", entry.file);
    if (!existsSync(rawPath)) {
      problems.push(`${entry.id}: raw file ${entry.file} is missing`);
      continue;
    }
    const digest = createHash("sha256").update(readFileSync(rawPath)).digest("hex");
    if (digest !== entry.sha256) problems.push(`sha256 mismatch for ${entry.id} (${entry.file})`);

    const dir = join(dataDir, "matches", entry.id);
    const parse = <T>(
      file: string,
      schema: {
        safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: Error };
      },
    ) => {
      const path = join(dir, file);
      if (!existsSync(path)) {
        problems.push(`${entry.id}: ${file} is missing`);
        return null;
      }
      const result = schema.safeParse(readJson(path));
      if (!result.success) {
        problems.push(`${entry.id}: ${file} fails its schema: ${result.error.message}`);
        return null;
      }
      return result.data;
    };
    const players = parse("players.json", PlayersFileSchema);
    const context = parse("context.json", MatchContextFileSchema);
    const personas = parse("personas.json", PersonasFileSchema);

    if (players && personas && rulesResult.success) {
      for (const persona of personas.personas) {
        if (!persona.squad) continue;
        const check = validateSquad(persona.squad, players.players, rulesResult.data.team);
        if (!check.valid) {
          problems.push(
            `${entry.id}: persona ${persona.id} has an illegal squad: ${check.issues.map((i) => i.message).join("; ")}`,
          );
        }
      }
    }

    lines.push(
      [
        entry.id,
        context?.title ?? "?",
        digest === entry.sha256 ? "sha256 ok" : "SHA256 MISMATCH",
        `${players?.players.length ?? 0} players`,
        `${context?.notes.length ?? 0} notes`,
        `${personas?.personas.length ?? 0} personas`,
      ].join("  "),
    );
  }

  const listed = new Set(manifest.matches.map((m) => m.id));
  const matchesDir = join(dataDir, "matches");
  for (const id of existsSync(matchesDir) ? readdirSync(matchesDir) : []) {
    if (!listed.has(id)) problems.push(`data/matches/${id} is not listed in the manifest`);
  }

  return { problems, lines };
}

function main(): void {
  const flag = process.argv.indexOf("--data");
  const dataDir =
    flag !== -1 ? (process.argv[flag + 1] ?? "") : join(import.meta.dirname, "..", "data");
  const { problems, lines } = verifyData(dataDir);
  for (const line of lines) console.log(`  ${line}`);
  if (problems.length > 0) {
    console.error(`verify-data: ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`verify-data: OK (${lines.length} matches)`);
}

if (import.meta.main) main();
