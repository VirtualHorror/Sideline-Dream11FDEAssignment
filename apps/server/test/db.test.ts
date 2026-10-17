import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMatchBundles } from "../src/data/bundle.ts";
import { openDatabase, rebuildAnalytics } from "../src/db/database.ts";

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
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    const again = openDatabase(":memory:");
    expect(again.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
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
