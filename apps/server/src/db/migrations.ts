/**
 * SQLite schema, versioned with `PRAGMA user_version` (D-009: node:sqlite, no native addons).
 *
 * Called by db/database.ts on every open. Each migration runs once, in order, inside a
 * transaction; a database already at the latest version is left alone. Tables (PLAN Task 5):
 *   ai_cache    validated model outputs by moment key, prompt version and model (live or replay)
 *   ai_calls    one row per gateway attempt: the AICallTrace columns plus the session and a detail
 *   deliveries  one row per delivery of every bundled match (analytics, rebuilt at boot)
 *   players     both squads of every bundled match (analytics, rebuilt at boot)
 * The NL inspector (Task 8) reads the analytics tables and ai_calls read-only.
 * Migration 2 (D-071): `ai_calls.called`, whether the run reached the provider, so a restart knows
 * the provider's last answer; rows written before it are filled in from the shape of the gateway's
 * traces (a cache miss by a real provider that was neither a budget stop nor a shared result).
 */
import type { DatabaseSync } from "node:sqlite";

export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE ai_cache (
    key            TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model          TEXT NOT NULL,
    payload_json   TEXT NOT NULL,
    source         TEXT NOT NULL CHECK (source IN ('live', 'replay')),
    created_at     TEXT NOT NULL,
    hits           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, prompt_version, model)
  );
  CREATE TABLE ai_calls (
    id              TEXT PRIMARY KEY,
    session_id      TEXT,
    skill           TEXT NOT NULL,
    moment_key      TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT,
    cache           TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    latency_ms      INTEGER NOT NULL,
    tokens_in       INTEGER NOT NULL,
    tokens_out      INTEGER NOT NULL,
    cost_usd        REAL NOT NULL,
    cost_estimated  INTEGER NOT NULL,
    prompt_version  TEXT NOT NULL,
    started_at_wall TEXT NOT NULL,
    budget_ms       INTEGER,
    detail          TEXT
  );
  CREATE INDEX ai_calls_by_start ON ai_calls (started_at_wall);
  CREATE TABLE deliveries (
    match_id      TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    innings       INTEGER NOT NULL,
    label         TEXT NOT NULL,
    batter_id     TEXT NOT NULL,
    bowler_id     TEXT NOT NULL,
    runs_batter   INTEGER NOT NULL,
    runs_total    INTEGER NOT NULL,
    extras        INTEGER NOT NULL,
    wicket_kind   TEXT,
    player_out_id TEXT,
    leverage      REAL NOT NULL,
    wp_after      REAL,
    t             INTEGER NOT NULL,
    PRIMARY KEY (match_id, seq)
  );
  CREATE TABLE players (
    match_id     TEXT NOT NULL,
    player_id    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    short_name   TEXT NOT NULL,
    team         TEXT NOT NULL,
    role         TEXT NOT NULL,
    PRIMARY KEY (match_id, player_id)
  );
  `,
  `
  ALTER TABLE ai_calls ADD COLUMN called INTEGER NOT NULL DEFAULT 0;
  UPDATE ai_calls SET called = 1
   WHERE cache = 'miss' AND provider NOT IN ('none', 'replay') AND outcome <> 'budget'
     AND (detail IS NULL OR detail NOT LIKE 'shared result:%');
  `,
];

export function migrate(db: DatabaseSync): void {
  const current = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  for (let version = current + 1; version <= MIGRATIONS.length; version += 1) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version - 1] ?? "");
      // PRAGMA takes no bound parameters; `version` is a loop integer, never input.
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
