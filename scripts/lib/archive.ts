/**
 * Cricsheet men's T20I archive access for scripts/build-models.ts (PLAN Task 3).
 *
 * Downloads or opens `t20s_male_json.zip`, extracts it into a fresh directory the caller owns,
 * applies the PLAN's training filters, synthesizes the minimal fixtures the engine needs for a
 * match we have no authored data for, and runs the real engine on it. A match the engine cannot
 * process (BUG-002) comes back as a named rejection reason, never as a silent skip, so the build
 * can count and list every exclusion. The archive is data: files are only JSON-parsed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildTimeline,
  foldEvents,
  type MatchContextFile,
  MatchContextFileSchema,
  type MatchEvent,
  type MatchState,
  type PlayersFile,
  PlayersFileSchema,
  type Role,
  WicketKindSchema,
} from "../../packages/engine/src/index.ts";

export const ARCHIVE_URL = "https://cricsheet.org/downloads/t20s_male_json.zip";

/** The parts of a Cricsheet match file this pipeline reads (the engine validates the rest). */
export interface ArchiveRaw {
  info: {
    gender?: string;
    match_type?: string;
    overs?: number;
    dates: string[];
    teams: string[];
    players: Record<string, string[]>;
    registry: { people: Record<string, string> };
    outcome?: {
      winner?: string;
      result?: string;
      method?: string;
      by?: { runs?: number; wickets?: number };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  innings: {
    team: string;
    overs: {
      over: number;
      deliveries: {
        batter: string;
        non_striker: string;
        bowler: string;
        runs: { batter: number; extras: number; total: number; non_boundary?: boolean };
        extras?: Record<string, number>;
        wickets?: { player_out: string; kind: string; fielders?: { name?: string }[] }[];
        [key: string]: unknown;
      }[];
    }[];
    target?: { runs: number; overs: number };
    super_over?: boolean;
    [key: string]: unknown;
  }[];
}

export async function downloadArchive(destDir: string, url = ARCHIVE_URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} for ${url}`);
  const zipPath = join(destDir, "archive.zip");
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  return zipPath;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Unzips into `destDir` (a fresh, caller-owned directory) and returns every match id in numeric
 * order, so the build visits matches in the same order on every run. Throws on a JSON file whose
 * name is not a match id rather than skipping it.
 */
export function extractArchive(zipPath: string, destDir: string): string[] {
  mkdirSync(destDir, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", destDir]);
  const names = readdirSync(destDir).filter((name) => name.endsWith(".json"));
  const odd = names.filter((name) => !/^\d+\.json$/.test(name));
  if (odd.length > 0)
    throw new Error(`archive has JSON files that are not match ids: ${odd.join(", ")}`);
  return names.map((name) => name.slice(0, -".json".length)).sort((a, b) => Number(a) - Number(b));
}

export function readArchiveMatch(dir: string, id: string): ArchiveRaw {
  return JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as ArchiveRaw;
}

/**
 * PLAN Task 3's training filters, checked in this order; returns the first reason a match fails,
 * or null when it qualifies: men's T20I, 20 overs a side, exactly two innings (no super over), a
 * winner or a tie, no `outcome.method`, and a chase target over 20 overs.
 */
export function filterReason(raw: ArchiveRaw): string | null {
  const info = raw.info;
  if (info.gender !== "male" || info.match_type !== "T20") return "not a men's T20";
  if (info.overs !== 20) return "not 20 overs a side";
  if (raw.innings.length !== 2 || raw.innings.some((innings) => innings.super_over)) {
    return "not exactly two innings (no result, super over)";
  }
  if (!info.outcome?.winner && info.outcome?.result !== "tie") return "no winner and not a tie";
  if (info.outcome?.method) return "result decided by a method (DLS, VJD, awarded)";
  if (raw.innings[1]?.target?.overs !== 20) return "chase target missing or not 20 overs";
  return null;
}

/** Placeholder team codes: the engine only needs two distinct codes for an archive match. */
const SYNTHETIC_CODES = ["TA", "TB"] as const;

/**
 * Minimal fixtures for an archive match (PLAN Task 3): both announced XIs, role `BAT` unless
 * `roleOf` knows the player (priors use the role from our own fixtures), credits 8, no notes.
 */
export function synthesizeFixtures(
  id: string,
  raw: ArchiveRaw,
  roleOf: (playerId: string) => Role | undefined = () => undefined,
): { players: PlayersFile; context: MatchContextFile } {
  const team = (index: 0 | 1) => {
    const name = raw.info.teams[index] ?? "";
    return {
      code: SYNTHETIC_CODES[index],
      name,
      cricsheetName: name,
      color: "#000000",
      colorAlt: "#ffffff",
    };
  };
  const players = PlayersFileSchema.parse({
    matchId: id,
    creditsNote: "synthesized from Cricsheet for scripts/build-models.ts",
    players: raw.info.teams.flatMap((teamName, index) =>
      (raw.info.players[teamName] ?? []).map((name) => {
        const playerId = raw.info.registry.people[name];
        return {
          id: playerId,
          cricsheetName: name,
          displayName: name,
          shortName: name,
          team: SYNTHETIC_CODES[index] ?? "",
          role: (playerId && roleOf(playerId)) ?? "BAT",
          credits: 8,
        };
      }),
    ),
  });
  const context = MatchContextFileSchema.parse({
    matchId: id,
    title: "synthesized",
    competition: "synthesized",
    stage: "synthesized",
    notes: [],
    teams: [team(0), team(1)],
  });
  return { players, context };
}

export type EngineRun =
  | { ok: true; events: MatchEvent[]; state: MatchState; players: PlayersFile }
  | { ok: false; reason: string };

type Stage = "fixtures" | "timeline" | "reducer";

interface SchemaIssue {
  code: string;
  path: (string | number)[];
}

function schemaIssues(error: unknown): SchemaIssue[] | null {
  if (!(error instanceof Error) || error.name !== "ZodError") return null;
  const issues = (error as Error & { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as SchemaIssue[]) : null;
}

function unsupportedWicketKinds(raw: ArchiveRaw): string[] {
  const supported = new Set<string>(WicketKindSchema.options);
  const kinds = new Set<string>();
  for (const innings of raw.innings) {
    for (const over of innings.overs) {
      for (const delivery of over.deliveries) {
        for (const wicket of delivery.wickets ?? []) {
          if (!supported.has(wicket.kind)) kinds.add(wicket.kind);
        }
      }
    }
  }
  return [...kinds].sort();
}

/**
 * Names the BUG-002 class of an engine failure from where it was thrown and what it says. Anything
 * unrecognised still becomes a reason ("<stage>: <message>"), so a new failure mode shows up in the
 * README's exclusion table instead of vanishing.
 */
function rejectionReason(stage: Stage, error: unknown, raw: ArchiveRaw): string {
  const issue = schemaIssues(error)?.[0];
  if (issue) {
    const last = issue.path.at(-1);
    if (issue.path.includes("fielders") && last === "name") return "a fielder entry without a name";
    if (issue.path.includes("wickets") && last === "kind") {
      return `wicket kind ${unsupportedWicketKinds(raw).join(", ")}`;
    }
    if (last === "ballInOver" || last === "label") return "an over with more than six legal balls";
    if (last === "playerIds" || (stage === "fixtures" && issue.path.join(".") === "players")) {
      return issue.code === "too_big"
        ? "a team lists more than 11 players"
        : "a team lists fewer than 11 players";
    }
    return `${stage}: schema ${issue.code} at ${issue.path.join(".")}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/contains more than one bowler/.test(message)) return "bowler changed mid-over";
  return `${stage}: ${message.split("\n")[0]}`;
}

/** Synthesized fixtures → buildTimeline → foldEvents; the full fold is the acceptance check. */
export function runEngine(
  id: string,
  raw: ArchiveRaw,
  roleOf?: (playerId: string) => Role | undefined,
): EngineRun {
  let stage: Stage = "fixtures";
  try {
    const { players, context } = synthesizeFixtures(id, raw, roleOf);
    stage = "timeline";
    const events = buildTimeline({ raw, players, context });
    stage = "reducer";
    const state = foldEvents(id, events);
    return { ok: true, events, state, players };
  } catch (error) {
    return { ok: false, reason: rejectionReason(stage, error, raw) };
  }
}
