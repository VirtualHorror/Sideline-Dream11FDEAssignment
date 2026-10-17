/**
 * Anti-hardcoding gate.
 *
 * Usage: node scripts/check-no-hardcode.ts [--root <repoRoot>]
 *
 * Sideline must work for any Cricsheet T20 match. Detectors, prompts and UI must read players,
 * teams and venues from data/, never name them in code. This script builds a deny-list from
 * the data itself (player names and ids, team names and codes, venues, match and persona ids)
 * and scans application source (apps/<app>/src, packages/<pkg>/src, the web entry HTML and
 * public scripts) for any of those terms outside comments.
 *
 * Tests, fixtures and docs are not scanned: golden tests are *supposed* to name real players.
 * A line can opt out with an explicit marker and reason:  // hardcode-ok: <why>
 * Every marker is reviewed in the audit (docs/TEST_CHECKLIST.md, section A).
 *
 * A second pass covers every tracked file, docs and handoffs included: no file may contain a
 * FORBIDDEN_WORDS entry, in any case, and there is no opt-out (D-068).
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

export interface Term {
  text: string;
  kind: string;
  caseSensitive: boolean;
}

export interface Finding {
  path: string;
  line: number;
  term: string;
  kind: string;
}

export interface SourceFile {
  path: string;
  content: string;
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".html"]);
const OPT_OUT = "hardcode-ok:";

/**
 * Replaces comments with spaces while keeping every newline, so line numbers survive.
 * JS/TS: a small state machine that understands '...', "..." and `...` strings, so a "//"
 * inside "https://..." is not mistaken for a comment. CSS: block comments only (unquoted
 * url(https://...) is legal CSS). HTML: <!-- --> only.
 */
export function stripComments(content: string, extension: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  if (extension === ".css") return content.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (extension === ".html") return content.replace(/<!--[\s\S]*?-->/g, blank);

  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < content.length) {
    const ch = content[i] as string;
    const next = content[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < content.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
    } else if (ch === "/" && next === "/") {
      const end = content.indexOf("\n", i);
      const stop = end === -1 ? content.length : end;
      out += blank(content.slice(i, stop));
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = content.indexOf("*/", i + 2);
      const stop = end === -1 ? content.length : end + 2;
      out += blank(content.slice(i, stop));
      i = stop;
    } else {
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      out += ch;
      i += 1;
    }
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findHardcodedTerms(files: SourceFile[], terms: Term[]): Finding[] {
  const matchers = terms.map((term) => ({
    term,
    // Whole-word match: no letter, digit or underscore on either side.
    re: new RegExp(
      `(?<![A-Za-z0-9_])${escapeRegExp(term.text)}(?![A-Za-z0-9_])`,
      term.caseSensitive ? "" : "i",
    ),
  }));
  const findings: Finding[] = [];
  for (const file of files) {
    const originalLines = file.content.split("\n");
    const codeLines = stripComments(file.content, extname(file.path)).split("\n");
    codeLines.forEach((code, index) => {
      if (originalLines[index]?.includes(OPT_OUT)) return;
      for (const { term, re } of matchers) {
        if (re.test(code)) {
          findings.push({ path: file.path, line: index + 1, term: term.text, kind: term.kind });
        }
      }
    });
  }
  return findings;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Builds the deny-list from data/: everything that would tie code to one specific match. */
export function loadTerms(dataDir: string): Term[] {
  const terms = new Map<string, Term>();
  const add = (text: string, kind: string, caseSensitive: boolean) => {
    const clean = text.trim();
    if (clean.length === 0) return;
    const key = caseSensitive ? clean : clean.toLowerCase();
    if (!terms.has(key)) terms.set(key, { text: clean, kind, caseSensitive });
  };

  const matchesDir = join(dataDir, "matches");
  const matchIds = existsSync(matchesDir) ? readdirSync(matchesDir) : [];
  for (const id of matchIds) {
    add(id, "match id", true);
    const dir = join(matchesDir, id);
    const players = readJson(join(dir, "players.json")) as {
      players: { id: string; displayName: string; cricsheetName: string; shortName: string }[];
    };
    for (const p of players.players) {
      add(p.id, "player id", true);
      add(p.displayName, "player name", false);
      add(p.cricsheetName, "player name", false);
      // Very short nicknames would match ordinary words; full names still catch those players.
      if (p.shortName.length >= 4) add(p.shortName, "player short name", false);
    }
    const context = readJson(join(dir, "context.json")) as {
      title: string;
      teams: { code: string; name: string }[];
    };
    add(context.title, "match title", false);
    for (const team of context.teams) {
      add(team.code, "team code", true);
      add(team.name, "team name", false);
    }
    const personas = readJson(join(dir, "personas.json")) as { personas: { id: string }[] };
    for (const persona of personas.personas) add(persona.id, "persona id", true);

    const rawPath = join(dataDir, "raw", "cricsheet", `${id}.json`);
    if (existsSync(rawPath)) {
      const raw = readJson(rawPath) as { info: { venue?: string; city?: string } };
      for (const part of (raw.info.venue ?? "").split(",")) add(part, "venue", false);
      if (raw.info.city) add(raw.info.city, "venue", false);
    }
  }
  return [...terms.values()];
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXTENSIONS.has(extname(name))) out.push(full);
  }
}

/** Application source only: apps/<app>/{src,public,index.html} and packages/<pkg>/src. */
export function listSourceFiles(root: string): SourceFile[] {
  const paths: string[] = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const project of readdirSync(groupDir)) {
      walk(join(groupDir, project, "src"), paths);
      walk(join(groupDir, project, "public"), paths);
      const entryHtml = join(groupDir, project, "index.html");
      if (existsSync(entryHtml)) paths.push(entryHtml);
    }
  }
  return paths.map((path) => ({ path: relative(root, path), content: readFileSync(path, "utf8") }));
}

/**
 * Words no tracked file may contain, in any case (D-068). Today one: the name of the proxy behind
 * the AI key, which the owner keeps out of the repository (its address lives only in .env). Kept
 * reversed, so this file does not contain them either.
 */
export const FORBIDDEN_WORDS: readonly string[] = ["traktik"].map((w) => [...w].reverse().join(""));

/** Every line of every file that contains a forbidden word, case-insensitively. */
export function findForbiddenWords(files: SourceFile[], words: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    file.content
      .toLowerCase()
      .split("\n")
      .forEach((line, index) => {
        for (const word of words) {
          if (line.includes(word)) {
            findings.push({ path: file.path, line: index + 1, term: word, kind: "forbidden word" });
          }
        }
      });
  }
  return findings;
}

function walkAll(dir: string, root: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) walkAll(path, root, out);
    else out.push(relative(root, path));
  }
}

/**
 * The files git tracks under `root`, read byte for byte (latin1), so any file type is searched;
 * every file but node_modules and .git when `root` is not a git work tree (the CLI test's copy).
 */
export function listTrackedFiles(root: string): SourceFile[] {
  let paths: string[] = [];
  try {
    paths = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter((path) => path !== "");
  } catch {
    walkAll(root, root, paths);
  }
  return paths
    .filter((path) => existsSync(join(root, path)) && lstatSync(join(root, path)).isFile())
    .map((path) => ({ path, content: readFileSync(join(root, path), "latin1") }));
}

function main(): void {
  const rootFlag = process.argv.indexOf("--root");
  const root =
    rootFlag !== -1 ? (process.argv[rootFlag + 1] ?? "") : join(import.meta.dirname, "..");
  const terms = loadTerms(join(root, "data"));
  const files = listSourceFiles(root);
  const findings = findHardcodedTerms(files, terms);
  if (findings.length > 0) {
    console.error(
      `check-no-hardcode: ${findings.length} match-specific literal(s) in application source:`,
    );
    for (const f of findings) console.error(`  ${f.path}:${f.line}  "${f.term}" (${f.kind})`);
    console.error(
      "Read these from data/ instead, or add `// hardcode-ok: <reason>` if truly intended.",
    );
    process.exitCode = 1;
    return;
  }
  const tracked = listTrackedFiles(root);
  const forbidden = findForbiddenWords(tracked, FORBIDDEN_WORDS);
  if (forbidden.length > 0) {
    console.error(`check-no-hardcode: ${forbidden.length} forbidden word(s) in tracked files:`);
    for (const f of forbidden) console.error(`  ${f.path}:${f.line}  (${f.kind}, D-068)`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-no-hardcode: OK (${files.length} source files, ${terms.length} terms; ${tracked.length} tracked files, no forbidden words)`,
  );
}

if (import.meta.main) main();
