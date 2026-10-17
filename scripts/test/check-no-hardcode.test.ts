import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_WORDS,
  findForbiddenWords,
  findHardcodedTerms,
  findSecrets,
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

// D-079: no tracked file may hold an AI key. The fakes are assembled at run time, so this file
// never holds a key-shaped string itself, and the scanner passes over it.
const fakeKey = (prefix: string, length: number) =>
  `${prefix}${"x7Qk2Lm9Zp".repeat(20).slice(0, length)}`;

describe("AI keys in tracked files (D-079)", () => {
  it("flags each provider's key shape with file and line, naming the kind of key only", () => {
    const files = [
      { path: "docs/setup.md", content: `GROQ_API_KEY=${fakeKey("gsk_", 52)}\n` },
      { path: ".env.example", content: `# Gemini\nGEMINI_API_KEY=${fakeKey("AQ.", 49)}\n` },
      { path: "apps/x.ts", content: `const key = "${fakeKey("AIza", 35)}";\n` },
      { path: "notes.txt", content: `old key ${fakeKey("sk-", 32)} here` },
      { path: "scripts/y.ts", content: `x = '${fakeKey("sk-ant-api03-", 90)}'` },
      { path: "HANDOFF99.md", content: `project key ${fakeKey("sk-proj-", 120)}` },
    ];
    const findings = findSecrets(files);
    expect(findings).toEqual([
      { path: "docs/setup.md", line: 1, term: "Groq API key", kind: "secret" },
      { path: ".env.example", line: 2, term: "Google API key", kind: "secret" },
      { path: "apps/x.ts", line: 1, term: "Google API key", kind: "secret" },
      { path: "notes.txt", line: 1, term: "OpenAI or Anthropic API key", kind: "secret" },
      { path: "scripts/y.ts", line: 1, term: "OpenAI or Anthropic API key", kind: "secret" },
      { path: "HANDOFF99.md", line: 1, term: "OpenAI or Anthropic API key", kind: "secret" },
    ]);
  });

  it("passes the prefixes the docs name and the short placeholders the tests use", () => {
    const content = [
      "Groq keys start with `gsk_`, Google's with `AIza` or `AQ.`, OpenAI's with `sk-`.",
      'apiKey: "gsk_test", "sk-test", "sk-ant-SECRET-123", "sk-proxy-SECRET-456", "gemini-test"',
      "a risk-free task-runner-with-a-very-long-hyphenated-name and disk-usage-of-every-volume-here",
      "integrity: sha512-2kQ8vT0FbLz4bqNw9YcXr7hUe1sJmAoP3dGi6tKyH5aSZnBjDCx",
    ].join("\n");
    expect(findSecrets([{ path: "docs/x.md", content }])).toEqual([]);
  });

  it("fails the CLI on a tracked key, printing where it is and never the key", () => {
    const root = mkdtempSync(join(tmpdir(), "sideline-secret-"));
    cpSync(join(REPO, "data"), join(root, "data"), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-q");
    const key = fakeKey("gsk_", 52);
    writeFileSync(join(root, "deploy.env"), `GROQ_API_KEY=${key}\n`);
    git("add", "-A");
    const run = () =>
      execFileSync("node", [join(REPO, "scripts", "check-no-hardcode.ts"), "--root", root], {
        stdio: "pipe",
      });
    const error = (() => {
      try {
        run();
        return null;
      } catch (thrown) {
        return thrown as { stderr: Buffer; stdout: Buffer };
      }
    })();
    expect(error?.stderr.toString()).toContain("deploy.env:1  (secret: Groq API key)");
    expect(`${error?.stderr}${error?.stdout}`).not.toContain(key.slice(4));
    writeFileSync(join(root, "deploy.env"), "GROQ_API_KEY=\n");
    expect(() => run()).not.toThrow();
  });
});

// D-081: the first characters of this project's own keys, the revoked pair and the live one, fail the
// scan even in a fragment too short for the key shapes. Built from parts, so this file holds none.
const GROQ_REVOKED = ["gsk_", "zGEx"].join("");
const GROQ_LIVE = ["gsk_", "4xWr"].join("");
const GOOGLE_REVOKED = ["Ab8RN6", "KL"].join("");
const GOOGLE_LIVE = ["Ab8RN6", "Jy"].join("");

describe("this project's own keys in tracked files (D-081)", () => {
  it("flags the start of each of its keys, revoked or live, too short for the key shapes", () => {
    const files = [
      { path: "docs/notes.md", content: `The old key ${GROQ_REVOKED}… was revoked.\n` },
      { path: "HANDOFF99.md", content: `line one\nGROQ_API_KEY=${GROQ_LIVE}…\n` },
      { path: ".env.example", content: `GEMINI_API_KEY=AQ.${GOOGLE_REVOKED}…` },
      { path: "scripts/x.ts", content: `// rotated: ${GOOGLE_LIVE}\n` },
    ];
    expect(findSecrets(files)).toEqual([
      { path: "docs/notes.md", line: 1, term: "this project's Groq key", kind: "secret" },
      { path: "HANDOFF99.md", line: 2, term: "this project's Groq key", kind: "secret" },
      { path: ".env.example", line: 1, term: "this project's Google key", kind: "secret" },
      { path: "scripts/x.ts", line: 1, term: "this project's Google key", kind: "secret" },
    ]);
  });

  it("passes another key's start, the part its Google keys share, and its keys in another case", () => {
    const content = [
      "Groq keys start with gsk_, like gsk_9aBc… (someone else's).",
      `Google's new keys: AQ.${GOOGLE_LIVE.slice(0, 6)}…`,
      `${GROQ_LIVE.toUpperCase()} ${GOOGLE_REVOKED.toLowerCase()}`,
    ].join("\n");
    expect(findSecrets([{ path: "docs/x.md", content }])).toEqual([]);
  });

  it("fails the CLI on a fragment of one, printing where it is and never the fragment", () => {
    const root = mkdtempSync(join(tmpdir(), "sideline-own-key-"));
    cpSync(join(REPO, "data"), join(root, "data"), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-q");
    writeFileSync(join(root, "HANDOFF99.md"), `The revoked key ${GROQ_REVOKED}… is gone.\n`);
    git("add", "-A");
    const run = () =>
      execFileSync("node", [join(REPO, "scripts", "check-no-hardcode.ts"), "--root", root], {
        stdio: "pipe",
      });
    const error = (() => {
      try {
        run();
        return null;
      } catch (thrown) {
        return thrown as { stderr: Buffer; stdout: Buffer };
      }
    })();
    expect(error?.stderr.toString()).toContain("HANDOFF99.md:1  (secret: this project's Groq key)");
    expect(`${error?.stderr}${error?.stdout}`).not.toContain(GROQ_REVOKED.slice(4));
    writeFileSync(join(root, "HANDOFF99.md"), "The revoked key is gone.\n");
    expect(() => run()).not.toThrow();
  });
});
