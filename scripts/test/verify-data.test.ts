import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO, "scripts", "verify-data.ts");

function copyOfData(): string {
  const dir = mkdtempSync(join(tmpdir(), "sideline-data-"));
  cpSync(join(REPO, "data"), dir, { recursive: true });
  return dir;
}
const run = (dataDir: string) =>
  execFileSync("node", [SCRIPT, "--data", dataDir], { stdio: "pipe", encoding: "utf8" });

describe("verify-data CLI", () => {
  it("passes on the committed data and summarises each match", () => {
    const out = run(join(REPO, "data"));
    expect(out).toContain("1298150");
    expect(out).toContain("1415755");
    expect(out).toMatch(/verify-data: OK/);
  });

  it("fails when a raw Cricsheet file no longer matches its recorded sha256", () => {
    const dir = copyOfData();
    appendFileSync(join(dir, "raw", "cricsheet", "1298150.json"), "\n");
    expect(() => run(dir)).toThrow(/sha256 mismatch.*1298150/);
  });

  it("fails when a match folder has no manifest entry (untracked data)", () => {
    const dir = copyOfData();
    cpSync(join(dir, "matches", "1415755"), join(dir, "matches", "9999999"), { recursive: true });
    expect(() => run(dir)).toThrow(/9999999.*not listed in the manifest/);
  });

  it("fails when a fixture breaks its schema", () => {
    const dir = copyOfData();
    rmSync(join(dir, "matches", "1298150", "personas.json"));
    expect(() => run(dir)).toThrow(/1298150.*personas\.json/);
  });
});
