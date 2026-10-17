/** Shared helpers for the server tests: the real data dir, bundles, and an injected clock. */
import { join } from "node:path";
import { loadMatchBundles, type MatchBundle } from "../src/data/bundle.ts";

export const DATA_DIR = join(import.meta.dirname, "..", "..", "..", "data");

let cached: Map<string, MatchBundle> | null = null;
/** The real bundles, loaded once per test file (they are read-only). */
export function bundles(): Map<string, MatchBundle> {
  cached ??= loadMatchBundles(DATA_DIR);
  return cached;
}

export function bundle(id: string): MatchBundle {
  const found = bundles().get(id);
  if (!found) throw new Error(`no bundle ${id}`);
  return found;
}

/** A wall clock the test moves by hand (2026-10-16 12:00 UTC at the start). */
export function fakeClock(start = Date.UTC(2026, 9, 16, 12, 0, 0)) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    set: (ms: number) => {
      now = ms;
    },
  };
}

/** Resolves once every pending promise callback has run (lets fire-and-forget work settle). */
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
