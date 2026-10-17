import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { loadMatchBundles } from "../src/data/bundle.ts";
import { openDatabase, rebuildAnalytics } from "../src/db/database.ts";
import { MIGRATIONS, migrate } from "../src/db/migrations.ts";

const DATA = join(import.meta.dirname, "..", "..", "..", "data");
const bundles = loadMatchBundles(DATA);

/** Deliveries per match, counted straight from the raw Cricsheet file (not the engine). */
function rawDeliveries(id: string): number {
  const raw = JSON.parse(readFileSync(join(DATA, "raw", "cricsheet", `${id}.json`), "utf8")) as {
    innings: { overs: { deliveries: unknown[] }[] }[];
  };
  return raw.innings.reduce(
    (sum, inn) => sum + inn.overs.reduce((n, over) => n + over.deliveries.length, 0),
    0,
  );
}

describe("SQLite schema (PLAN Task 5)", () => {
  it("creates the four tables and migrates idempotently", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(["ai_cache", "ai_calls", "deliveries", "players"]);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    const again = openDatabase(":memory:");
    expect(again.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
  });
});

describe("migration 2: each ai_calls row says whether its run reached the provider (D-071)", () => {
  it("adds `called` and fills it in for the rows an older server wrote", () => {
    // A version-1 database as production holds it, with one row of each kind the gateway writes.
    const db = new DatabaseSync(":memory:");
    db.exec(MIGRATIONS[0] ?? "");
    db.exec("PRAGMA user_version = 1");
    const insert = db.prepare(
      `INSERT INTO ai_calls (id, session_id, skill, moment_key, provider, model, cache, outcome,
         latency_ms, tokens_in, tokens_out, cost_usd, cost_estimated, prompt_version,
         started_at_wall, budget_ms, detail) VALUES (?, NULL, 'echo', 'k', ?, 'm', ?, ?, 1, 0, 0, 0, 0,
         'v1', '2026-10-17T10:00:00.000Z', NULL, ?)`,
    );
    insert.run("cache-hit", "openai", "hit", "ok", null);
    insert.run("replay-hit", "replay", "hit", "ok", null);
    insert.run(
      "no-provider",
      "none",
      "miss",
      "fallback",
      "no provider configured and no recorded output",
    );
    insert.run("budget", "openai", "miss", "budget", "daily budget of $3.00 spent");
    insert.run(
      "provider-error",
      "openai",
      "miss",
      "error",
      "provider error: PermissionDeniedError (403)",
    );
    insert.run(
      "shared",
      "openai",
      "miss",
      "error",
      "shared result: provider error: PermissionDeniedError (403)",
    );
    insert.run("guard", "openai", "miss", "fallback", "guard: score after the ball");
    insert.run("answered", "openai", "miss", "ok", null);
    migrate(db);
    const called = Object.fromEntries(
      db
        .prepare("SELECT id, called FROM ai_calls")
        .all()
        .map((row) => [row.id, row.called]),
    );
    expect(called).toEqual({
      "cache-hit": 0,
      "replay-hit": 0,
      "no-provider": 0,
      budget: 0,
      "provider-error": 1,
      shared: 0,
      guard: 1,
      answered: 1,
    });
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
  });
});

describe("rebuildAnalytics", () => {
  it("rebuilds one row per delivery and per player, every boot, without duplicates", () => {
    const db = openDatabase(":memory:");
    rebuildAnalytics(db, bundles);
    rebuildAnalytics(db, bundles);
    for (const id of ["1298150", "1415755"]) {
      const count = (table: string) =>
        db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE match_id = ?`).get(id)?.n;
      expect(count("deliveries")).toBe(rawDeliveries(id));
      expect(count("players")).toBe(30);
    }
  });

  it("stores the real facts of known deliveries, with the model's leverage", () => {
    const db = openDatabase(":memory:");
    rebuildAnalytics(db, bundles);
    const row = (innings: number, label: string) =>
      db
        .prepare(
          "SELECT * FROM deliveries WHERE match_id = '1298150' AND innings = ? AND label = ? ORDER BY seq",
        )
        .all(innings, label);
    // Innings 1's 1.1: Babar lbw for a golden duck (raw file; F04's collapse test).
    expect(row(1, "1.1")[0]).toMatchObject({
      batter_id: "8a75e999",
      runs_total: 0,
      wicket_kind: "lbw",
      player_out_id: "8a75e999",
    });
    // The 18.6 six off Rauf: leverage 0.410 in the spot-check's independent re-derivation (F05).
    const six = row(2, "18.6")[0];
    expect(six).toMatchObject({ runs_batter: 6, runs_total: 6, wicket_kind: null });
    expect(six?.leverage).toBeCloseTo(0.41, 2);
    // Kohli played both matches: one row per match.
    const players = db
      .prepare(
        "SELECT match_id, display_name, team, role FROM players WHERE player_id = 'ba607b88' ORDER BY match_id",
      )
      .all();
    expect(players).toEqual([
      { match_id: "1298150", display_name: "Virat Kohli", team: "IND", role: "BAT" },
      { match_id: "1415755", display_name: "Virat Kohli", team: "IND", role: "BAT" },
    ]);
  });
});
