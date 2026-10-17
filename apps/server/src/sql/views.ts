/**
 * The documented views that model-written SQL may read (PLAN 8.4), one definition each used three
 * ways: the prompts describe them, the sandbox's worker creates them, the inspector UI lists them.
 *
 * Callers: ai/skills/{statBack,inspector}.ts (their prompts and tables) and sql/sandbox.ts. The views
 * are copies, built per query, so a query can never read past them: `visible_deliveries` holds only
 * the deliveries the fan's TV has shown (stat-back cannot leak the future), `players` both squads,
 * and the inspector's `ai_calls` the trace rows without the session id, the moment key or the
 * detail (a session id controls a session; keys and details can name a ball the TV has not shown).
 */
import type { DatabaseSync } from "node:sqlite";
import {
  applyEvent,
  createMatchState,
  type DeliveryEvent,
  leverage,
  type MatchState,
} from "@sideline/engine";
import type { MatchBundle } from "../data/bundle.ts";

type SqlType = "INTEGER" | "REAL" | "TEXT";
type SqlValue = string | number | null;

export interface SqlColumn {
  name: string;
  type: SqlType;
  about: string;
}

export interface SqlView {
  name: string;
  about: string;
  columns: readonly SqlColumn[];
}

/** A view with its rows for one query: what the worker turns into a table. */
export interface SqlTable {
  name: string;
  columns: { name: string; type: SqlType }[];
  rows: SqlValue[][];
}

const col = (name: string, type: SqlType, about: string): SqlColumn => ({ name, type, about });

export const VISIBLE_DELIVERIES: SqlView = {
  name: "visible_deliveries",
  about: "Every delivery your TV has shown so far, in order (a wide or no-ball is a row too).",
  columns: [
    col("seq", "INTEGER", "the delivery's place in the match timeline"),
    col("innings", "INTEGER", "1 or 2"),
    col("over", "INTEGER", "0-based over: 0 is the first over, 19 the last"),
    col("ball", "INTEGER", "the legal ball of the over the label shows, 1 to 6"),
    col("label", "TEXT", "scoreboard label, over.ball, e.g. 18.6"),
    col("batting_team", "TEXT", "team code of the batting side"),
    col("bowling_team", "TEXT", "team code of the bowling side"),
    col("batter", "TEXT", "the striker's name"),
    col("batter_id", "TEXT", "the striker's player id"),
    col("non_striker", "TEXT", "the non-striker's name"),
    col("bowler", "TEXT", "the bowler's name"),
    col("bowler_id", "TEXT", "the bowler's player id"),
    col("runs_batter", "INTEGER", "runs off the bat"),
    col("runs_extras", "INTEGER", "extras on the delivery"),
    col("runs_total", "INTEGER", "runs_batter + runs_extras"),
    col("wides", "INTEGER", "wide runs (a wide is not a ball faced)"),
    col("noballs", "INTEGER", "no-ball runs"),
    col("byes", "INTEGER", "byes"),
    col("legbyes", "INTEGER", "leg byes"),
    col("is_legal", "INTEGER", "1 if it counts toward the six-ball over, 0 for wides and no-balls"),
    col("boundary", "INTEGER", "4 or 6 off the bat, else 0"),
    col("wicket_kind", "TEXT", "how a batter was out on this delivery, or null"),
    col("player_out", "TEXT", "the dismissed batter's name, or null"),
    col(
      "win_prob_batting_after",
      "REAL",
      "the batting side's chance of winning after the ball, 0 to 1 (Sideline's model)",
    ),
    col("leverage", "REAL", "how much the ball moved the match, 0 to 1 (Sideline's model)"),
  ],
};

export const PLAYERS: SqlView = {
  name: "players",
  about: "Both squads.",
  columns: [
    col("player_id", "TEXT", "the player's id"),
    col("name", "TEXT", "full name, as in visible_deliveries"),
    col("short_name", "TEXT", "short name"),
    col("team", "TEXT", "team code"),
    col("role", "TEXT", "WK, BAT, AR or BOWL"),
    col("credits", "REAL", "fantasy credits (illustrative)"),
  ],
};

export const AI_CALLS: SqlView = {
  name: "ai_calls",
  about: "Every AI attempt Sideline's gateway made, newest last (up to 5,000 rows, every fan).",
  columns: [
    col(
      "skill",
      "TEXT",
      "spoiler_nudge, catch_up, explainer, lineup_patch, bailout, room_read, stat_back, inspector",
    ),
    col(
      "provider",
      "TEXT",
      "anthropic, openai, groq, gemini, chain (the AI chain itself), replay, scripted or none",
    ),
    col("model", "TEXT", "the model that answered, or null"),
    col("cache", "TEXT", "hit, miss or bypass"),
    col("outcome", "TEXT", "ok, repaired, fallback, refused, error, timeout or budget"),
    col("latency_ms", "INTEGER", "how long the attempt took"),
    col("tokens_in", "INTEGER", "input tokens the provider reported"),
    col("tokens_out", "INTEGER", "output tokens the provider reported"),
    col("cost_usd", "REAL", "cost in US dollars, from the reported tokens"),
    col("cost_estimated", "INTEGER", "1 if the price is an estimate"),
    col("prompt_version", "TEXT", "the skill's prompt version"),
    col("started_at_wall", "TEXT", "when the attempt started, ISO 8601"),
  ],
};

export const STAT_BACK_VIEWS: readonly SqlView[] = [VISIBLE_DELIVERIES, PLAYERS];
export const INSPECTOR_VIEWS: readonly SqlView[] = [VISIBLE_DELIVERIES, PLAYERS, AI_CALLS];

/** The views as a prompt (and the inspector UI) describes them. */
export function viewsDoc(views: readonly SqlView[]) {
  return views.map((v) => ({
    view: v.name,
    about: v.about,
    columns: v.columns.map((c) => `${c.name} ${c.type}: ${c.about}`),
  }));
}

const schemaOf = (view: SqlView) => view.columns.map(({ name, type }) => ({ name, type }));

/** Every delivery of a match as a visible_deliveries row with its time; built once per bundle. */
const deliveryRows = new WeakMap<MatchBundle, { t: number; row: SqlValue[] }[]>();

function rowsOf(bundle: MatchBundle): { t: number; row: SqlValue[] }[] {
  const cached = deliveryRows.get(bundle);
  if (cached) return cached;
  const names = new Map(bundle.players.map((p) => [p.id, p.displayName]));
  const name = (id: string) => names.get(id) ?? id;
  const state: MatchState = createMatchState(bundle.summary.id);
  const rows: { t: number; row: SqlValue[] }[] = [];
  for (const event of bundle.events) {
    const before = event.kind === "delivery" ? structuredClone(state) : null;
    applyEvent(state, event);
    if (event.kind !== "delivery" || !before) continue;
    const d: DeliveryEvent = event;
    const innings = state.innings.find((i) => i.innings === d.innings);
    const lev = leverage({ before, after: state, event: d, model: bundle.winprob });
    const wicket = d.wickets[0] ?? null;
    rows.push({
      t: d.t,
      row: [
        d.seq,
        d.innings,
        d.over,
        d.ballInOver,
        d.label,
        innings?.battingTeam ?? null,
        innings?.bowlingTeam ?? null,
        name(d.batter),
        d.batter,
        name(d.nonStriker),
        name(d.bowler),
        d.bowler,
        d.runs.batter,
        d.runs.extras,
        d.runs.total,
        d.extras.wides,
        d.extras.noballs,
        d.extras.byes,
        d.extras.legbyes,
        d.isLegal ? 1 : 0,
        d.boundary,
        wicket?.kind ?? null,
        wicket ? name(wicket.playerOut) : null,
        lev.wpAfter,
        lev.value,
      ],
    });
  }
  deliveryRows.set(bundle, rows);
  return rows;
}

/** visible_deliveries at the fan's TV time `tvT`, and players: stat-back's whole world. */
export function statBackTables(bundle: MatchBundle, tvT: number): SqlTable[] {
  return [
    {
      name: VISIBLE_DELIVERIES.name,
      columns: schemaOf(VISIBLE_DELIVERIES),
      rows: rowsOf(bundle)
        .filter((r) => r.t <= tvT)
        .map((r) => r.row),
    },
    {
      name: PLAYERS.name,
      columns: schemaOf(PLAYERS),
      rows: bundle.players.map((p) => [
        p.id,
        p.displayName,
        p.shortName,
        p.team,
        p.role,
        p.credits,
      ]),
    },
  ];
}

/** The inspector's tables: stat-back's, plus the latest trace rows without anything per session. */
export function inspectorTables(bundle: MatchBundle, tvT: number, db: DatabaseSync): SqlTable[] {
  const names = AI_CALLS.columns.map((c) => c.name);
  const calls = db
    .prepare(
      `SELECT ${names.join(", ")} FROM (SELECT rowid AS r, * FROM ai_calls ORDER BY rowid DESC LIMIT 5000) ORDER BY r`,
    )
    .all() as Record<string, SqlValue>[];
  return [
    ...statBackTables(bundle, tvT),
    {
      name: AI_CALLS.name,
      columns: schemaOf(AI_CALLS),
      rows: calls.map((row) => names.map((n) => row[n] ?? null)),
    },
  ];
}
