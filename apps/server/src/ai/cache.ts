/**
 * The moment-keyed AI cache (thesis 1): one validated model output per moment key, prompt version
 * and model, shared by every fan who reaches the moment (D-015).
 *
 * Callers: ai/gateway.ts (look-ups and live writes) and providers/replay.ts (rows recorded by
 * `pnpm ai:record`, Task 7). Rows hold the model's validated *output*, not the payload: the skill
 * rebuilds the payload from the output and the caller's facts, which a shared key makes identical.
 * A look-up prefers a live row for the requested model, then a replay row for any model; with no
 * provider (model null) only replay rows can answer.
 */
import type { DatabaseSync } from "node:sqlite";

export interface CacheRow {
  output: unknown;
  source: "live" | "replay";
  model: string;
}

export interface AiCache {
  get(key: string, promptVersion: string, model: string | null): CacheRow | null;
  putLive(key: string, promptVersion: string, model: string, output: unknown): void;
  /** Loads a recorded row; never overwrites a live row for the same model. */
  putReplay(key: string, promptVersion: string, model: string, output: unknown): void;
}

export function createCache(db: DatabaseSync, now: () => number): AiCache {
  const select = db.prepare(
    `SELECT payload_json, source, model FROM ai_cache
     WHERE key = ? AND prompt_version = ? AND ((source = 'live' AND model = ?) OR source = 'replay')
     ORDER BY CASE source WHEN 'live' THEN 0 ELSE 1 END, created_at DESC
     LIMIT 1`,
  );
  const touch = db.prepare(
    "UPDATE ai_cache SET hits = hits + 1 WHERE key = ? AND prompt_version = ? AND model = ?",
  );
  const upsertLive = db.prepare(
    `INSERT INTO ai_cache (key, prompt_version, model, payload_json, source, created_at, hits)
     VALUES (?, ?, ?, ?, 'live', ?, 0)
     ON CONFLICT (key, prompt_version, model)
     DO UPDATE SET payload_json = excluded.payload_json, source = 'live', created_at = excluded.created_at`,
  );
  const upsertReplay = db.prepare(
    `INSERT INTO ai_cache (key, prompt_version, model, payload_json, source, created_at, hits)
     VALUES (?, ?, ?, ?, 'replay', ?, 0)
     ON CONFLICT (key, prompt_version, model)
     DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at
     WHERE ai_cache.source = 'replay'`,
  );
  const stamp = () => new Date(now()).toISOString();

  return {
    get(key, promptVersion, model) {
      const row = select.get(key, promptVersion, model) as
        | { payload_json: string; source: "live" | "replay"; model: string }
        | undefined;
      if (!row) return null;
      touch.run(key, promptVersion, row.model);
      return { output: JSON.parse(row.payload_json), source: row.source, model: row.model };
    },
    putLive(key, promptVersion, model, output) {
      upsertLive.run(key, promptVersion, model, JSON.stringify(output), stamp());
    },
    putReplay(key, promptVersion, model, output) {
      upsertReplay.run(key, promptVersion, model, JSON.stringify(output), stamp());
    },
  };
}
