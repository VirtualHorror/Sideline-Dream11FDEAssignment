/**
 * Replay mode: model outputs recorded earlier by `pnpm ai:record` (Task 7), served with no key.
 *
 * Called by src/index.ts at boot: every `data/ai-replay/*.jsonl` line becomes a `replay` row in the
 * AI cache, where the gateway finds it like any cached result (provenance "replay"). There is no
 * replay "call": a moment with no recording falls back to its labelled template. The files are
 * written only by the recorder from real provider calls, never by hand (Constraint 2); a malformed
 * line fails the boot with its file and line number.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AiCache } from "../cache.ts";

const ReplayLineSchema = z.object({
  key: z.string().min(1),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  output: z.unknown().refine((value) => value !== undefined, "output is required"),
});

/** Loads every recorded row into the cache; returns how many lines were loaded. */
export function loadReplayRows(dir: string, cache: AiCache): number {
  if (!existsSync(dir)) return 0;
  let loaded = 0;
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (line.trim() === "") return;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        throw new Error(`${file}:${index + 1}: invalid replay row: not JSON`);
      }
      const parsed = ReplayLineSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`${file}:${index + 1}: invalid replay row: ${parsed.error.message}`);
      }
      const row = parsed.data;
      cache.putReplay(row.key, row.promptVersion, row.model, row.output);
      loaded += 1;
    });
  }
  return loaded;
}
