/**
 * The server's one SQLite database (`data/runtime/sideline.db`, git-ignored; `:memory:` in tests).
 *
 * Callers: src/index.ts opens it at boot and rebuilds the analytics tables from the bundles; the
 * AI cache (ai/cache.ts) and the trace sink (telemetry/collector.ts) write to it. node:sqlite is
 * synchronous, which suits the small, local writes here (D-009).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyEvent, createMatchState, leverage } from "@sideline/engine";
import type { MatchBundle } from "../data/bundle.ts";
import { migrate } from "./migrations.ts";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

/**
 * Replaces the deliveries and players rows with the bundles' (they are derived data: rebuilding at
 * every boot keeps them in step with data/ and the model). Leverage and the batting side's win
 * probability after each ball come from the same engine functions the nudge detector uses.
 */
export function rebuildAnalytics(
  db: DatabaseSync,
  bundles: ReadonlyMap<string, MatchBundle>,
): { deliveries: number; players: number } {
  const insertDelivery = db.prepare(
    `INSERT INTO deliveries (match_id, seq, innings, label, batter_id, bowler_id, runs_batter,
       runs_total, extras, wicket_kind, player_out_id, leverage, wp_after, t)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPlayer = db.prepare(
    `INSERT INTO players (match_id, player_id, display_name, short_name, team, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let deliveries = 0;
  let players = 0;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM deliveries; DELETE FROM players;");
    for (const [matchId, bundle] of bundles) {
      const state = createMatchState(matchId);
      for (const event of bundle.events) {
        const before = event.kind === "delivery" ? structuredClone(state) : null;
        applyEvent(state, event);
        if (event.kind !== "delivery" || !before) continue;
        const lev = leverage({ before, after: state, event, model: bundle.winprob });
        // A delivery can carry two wickets (rare in Cricsheet); the first is the one stored.
        const wicket = event.wickets[0] ?? null;
        insertDelivery.run(
          matchId,
          event.seq,
          event.innings,
          event.label,
          event.batter,
          event.bowler,
          event.runs.batter,
          event.runs.total,
          event.runs.extras,
          wicket?.kind ?? null,
          wicket?.playerOut ?? null,
          lev.value,
          lev.wpAfter,
          event.t,
        );
        deliveries += 1;
      }
      for (const player of bundle.players) {
        insertPlayer.run(
          matchId,
          player.id,
          player.displayName,
          player.shortName,
          player.team,
          player.role,
        );
        players += 1;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { deliveries, players };
}
