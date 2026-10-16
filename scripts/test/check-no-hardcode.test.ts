import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findHardcodedTerms, type Term } from "../check-no-hardcode.ts";

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
