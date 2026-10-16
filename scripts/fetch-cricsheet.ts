/**
 * Re-creates data/raw/cricsheet/*.json from the official Cricsheet archive.
 *
 * Usage:
 *   node scripts/fetch-cricsheet.ts          download, extract the manifest's matches, record sha256s
 *   node scripts/fetch-cricsheet.ts --check  download and compare with the recorded sha256s only
 *
 * Which matches ship (and why) lives in data/raw/cricsheet/manifest.json, not here.
 * Needs the `unzip` CLI. The archive is extracted into a fresh temp directory and only
 * parsed as JSON; nothing from it is executed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Manifest {
  source: string;
  matches: { id: string; file: string; sha256: string }[];
}

const RAW_DIR = join(import.meta.dirname, "..", "data", "raw", "cricsheet");
const MANIFEST_PATH = join(RAW_DIR, "manifest.json");
const checkOnly = process.argv.includes("--check");

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  const work = mkdtempSync(join(tmpdir(), "sideline-cricsheet-"));
  try {
    const res = await fetch(manifest.source);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${manifest.source}`);
    const zipPath = join(work, "archive.zip");
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    let drift = 0;
    for (const match of manifest.matches) {
      // `unzip -p` streams one member to stdout; we never extract the whole archive.
      const content = execFileSync("unzip", ["-p", zipPath, match.file], {
        maxBuffer: 64 * 1024 * 1024,
      });
      JSON.parse(content.toString("utf8")); // must be valid JSON before we keep it
      const digest = sha256(content);
      if (checkOnly) {
        const same = digest === match.sha256;
        if (!same) drift += 1;
        console.log(`${same ? "ok   " : "DRIFT"} ${match.file} ${digest}`);
      } else {
        writeFileSync(join(RAW_DIR, match.file), content);
        match.sha256 = digest;
        console.log(`wrote ${match.file} sha256=${digest}`);
      }
    }

    if (checkOnly) {
      if (drift > 0) {
        console.error(
          `${drift} file(s) differ from the recorded checksums (Cricsheet may have revised them).`,
        );
        process.exitCode = 1;
      }
    } else {
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log("manifest updated");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
