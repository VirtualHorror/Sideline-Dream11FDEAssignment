import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_WORDS,
  findForbiddenWords,
  findHardcodedTerms,
  type Term,
} from "../check-no-hardcode.ts";

const REPO = join(import.meta.dirname, "..", "..");

const terms: Term[] = [
  { text: "Virat Kohli", kind: "player name", caseSensitive: false },
  { text: "Kohli", kind: "player short name", caseSensitive: false },
  { text: "ba607b88", kind: "player id", caseSensitive: true },
  { text: "IND", kind: "team code", caseSensitive: true },
];

describe("findHardcodedTerms", () => {
  it("flags a player name used in code, with file and line", () => {
    const findings = findHardcodedTerms(
      [
        {
          path: "apps/server/src/x.ts",
          content: 'const a = 1;\nif (name === "Virat Kohli") boost();\n',
        },
      ],
      terms,
    );
    expect(findings).toEqual([
      { path: "apps/server/src/x.ts", line: 2, term: "Virat Kohli", kind: "player name" },
      { path: "apps/server/src/x.ts", line: 2, term: "Kohli", kind: "player short name" },
    ]);
  });

  it("ignores names that only appear inside comments", () => {
    const content = [
      "// e.g. Kohli hits a six",
      "/* Virat Kohli",
      "   ba607b88 */",
      'const url = "https://example.com"; // IND',
    ].join("\n");
    expect(findHardcodedTerms([{ path: "a.ts", content }], terms)).toEqual([]);
  });

  it("matches whole words only, and team codes case-sensitively", () => {
    const content = 'const kohlified = 1; const india = "ind"; const window = "INDEX";';
    expect(findHardcodedTerms([{ path: "a.ts", content }], terms)).toEqual([]);
    const team = findHardcodedTerms([{ path: "a.ts", content: 'if (t === "IND") x();' }], terms);
    expect(team.map((f) => f.term)).toEqual(["IND"]);
  });

  it("honours an explicit hardcode-ok marker with a reason", () => {
    const content = 'const demo = "ba607b88"; // hardcode-ok: documented sample id';
    expect(findHardcodedTerms([{ path: "a.ts", content }], terms)).toEqual([]);
  });
});

describe("check-no-hardcode CLI", () => {
  it("exits non-zero when application source names a real player, zero when clean", () => {
    const root = mkdtempSync(join(tmpdir(), "sideline-hardcode-"));
    cpSync(join(REPO, "data"), join(root, "data"), { recursive: true });
    mkdirSync(join(root, "packages", "engine", "src"), { recursive: true });
    const file = join(root, "packages", "engine", "src", "detector.ts");
    const run = () =>
      execFileSync("node", [join(REPO, "scripts", "check-no-hardcode.ts"), "--root", root], {
        stdio: "pipe",
      });

    writeFileSync(file, "export const isStar = (id: string) => id.length > 0;\n");
    expect(() => run()).not.toThrow();

    writeFileSync(file, 'export const isStar = (name: string) => name === "Babar Azam";\n');
    expect(() => run()).toThrow(/Babar Azam/);
  });
});

// D-068: the name of the proxy behind today's AI key must never be in a tracked file. Built from
// parts here, so this file does not contain it either.
const PROXY_NAME = ["kit", "kart"].join("");

describe("forbidden words in tracked files (D-068)", () => {
  it("lists the proxy's name", () => {
    expect(FORBIDDEN_WORDS).toContain(PROXY_NAME);
  });

  it("flags the word in any case and any kind of file, with file and line", () => {
    const files = [
      { path: "docs/notes.md", content: `line one\nThe ${PROXY_NAME.toUpperCase()} proxy\n` },
      { path: ".env.example", content: `OPENAI_BASE_URL=https://api.${PROXY_NAME}.example/v1` },
      { path: "clean.ts", content: "export const proxy = true;\n" },
    ];
    expect(findForbiddenWords(files, FORBIDDEN_WORDS)).toEqual([
      { path: "docs/notes.md", line: 2, term: PROXY_NAME, kind: "forbidden word" },
      { path: ".env.example", line: 1, term: PROXY_NAME, kind: "forbidden word" },
    ]);
  });

  it("fails the CLI on a tracked file that names it, wherever the file is", () => {
    const root = mkdtempSync(join(tmpdir(), "sideline-forbidden-"));
    cpSync(join(REPO, "data"), join(root, "data"), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-q");
    writeFileSync(join(root, "HANDOFF99.md"), `Keys come from the ${PROXY_NAME} account.\n`);
    git("add", "-A");
    const run = () =>
      execFileSync("node", [join(REPO, "scripts", "check-no-hardcode.ts"), "--root", root], {
        stdio: "pipe",
      });
    expect(() => run()).toThrow(/HANDOFF99\.md:1/);
    writeFileSync(join(root, "HANDOFF99.md"), "Keys come from the proxy account.\n");
    expect(() => run()).not.toThrow();
  });
});
