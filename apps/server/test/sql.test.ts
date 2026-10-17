/**
 * PLAN 8.4 and Review focus 5: model-written SQL runs only through the sandbox. The text is
 * validated first (one statement, SELECT or WITH, no write or schema words); then it runs in a worker
 * thread on a throwaway in-memory copy of the documented views, read-only, behind SQLite's authorizer
 * (reads of those tables and a few plain functions only), wrapped in a 200-row LIMIT and killed after
 * 2 s. Stat-back's copy holds only the deliveries the fan's TV has shown.
 */
import { describe, expect, it } from "vitest";
import { runSandboxed, SANDBOX_TIMEOUT_MS } from "../src/sql/sandbox.ts";
import { validateSql } from "../src/sql/validate.ts";
import { statBackTables } from "../src/sql/views.ts";
import { bundle } from "./helpers.ts";
import { delivery } from "./runtime.ts";

const b = bundle("1298150");
const everything = statBackTables(b, Number.POSITIVE_INFINITY);
const deliveries = b.events.filter((e) => e.kind === "delivery");

describe("validateSql (PLAN 8.4)", () => {
  it.each([
    ["DELETE FROM players", "only SELECT or WITH queries are allowed"],
    ["ATTACH DATABASE 'other.db' AS other", "only SELECT or WITH queries are allowed"],
    ["PRAGMA table_info(players)", "only SELECT or WITH queries are allowed"],
    [
      "SELECT * FROM players WHERE 1 = 1 UNION SELECT * FROM players; DELETE FROM players",
      "only one statement is allowed",
    ],
    ["SELECT 1; SELECT 2", "only one statement is allowed"],
    [
      "WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c) SELECT n FROM c",
      "RECURSIVE is not allowed",
    ],
    [
      "SELECT * FROM players WHERE name IN (SELECT name FROM players) -- and more",
      "comments are not allowed",
    ],
    ["SELECT 1 /* hidden */", "comments are not allowed"],
    ["WITH x AS (SELECT 1) DELETE FROM players", "DELETE is not allowed"],
    ["SELECT load_extension('evil')", "LOAD_EXTENSION is not allowed"],
    ["select * from players where name = 'x' or 1 = 1 pragma", "PRAGMA is not allowed"],
    ["   ", "the query is empty"],
    [`SELECT ${"1 + ".repeat(600)}1`, "the query is over 2000 characters"],
  ])("refuses %s", (sql, reason) => {
    expect(validateSql(sql)).toEqual({ ok: false, reason });
  });

  it.each([
    ["SELECT 1", "SELECT 1"],
    ["  select count(*) from players;  ", "select count(*) from players"],
    ["WITH x AS (SELECT 1 AS n) SELECT n FROM x", "WITH x AS (SELECT 1 AS n) SELECT n FROM x"],
  ])("allows %s", (sql, cleaned) => {
    expect(validateSql(sql)).toEqual({ ok: true, sql: cleaned });
  });
});

describe("the SQL sandbox (PLAN 8.4, Review focus 5)", () => {
  it("returns a valid query's rows, at most 200 of them", async () => {
    const out = await runSandboxed(
      "SELECT seq, label FROM visible_deliveries ORDER BY seq",
      everything,
    );
    if (out.status !== "ok") throw new Error(`expected rows, got ${out.status}: ${out.reason}`);
    expect(out.rows).toHaveLength(200);
    expect(out.truncated).toBe(true);
    expect(out.columns).toEqual(["seq", "label"]);
    expect(out.rows[0]).toEqual({ seq: deliveries[0]?.seq, label: "0.1" });
    expect(out.sql).toBe("SELECT seq, label FROM visible_deliveries ORDER BY seq");
  });

  it("counts the real match: 251 deliveries, Kohli's 82 off 53", async () => {
    // The raw file and DOMAIN §4: 251 deliveries in the match, Kohli 82* off 53 in the chase.
    const out = await runSandboxed(
      `SELECT (SELECT count(*) FROM visible_deliveries) AS deliveries,
              sum(runs_batter) AS runs, sum(CASE WHEN wides = 0 THEN 1 ELSE 0 END) AS balls
         FROM visible_deliveries WHERE batter = 'Virat Kohli'`,
      everything,
    );
    expect(out.status === "ok" && out.rows).toEqual([{ deliveries: 251, runs: 82, balls: 53 }]);
  });

  it("kills an infinite cross join after 2 s", async () => {
    const started = Date.now();
    const out = await runSandboxed(
      "SELECT count(*) FROM visible_deliveries a, visible_deliveries b, visible_deliveries c, visible_deliveries d",
      everything,
    );
    const took = Date.now() - started;
    expect(out).toMatchObject({
      status: "timeout",
      reason: "the query ran past 2 s and was stopped",
    });
    expect(took).toBeGreaterThanOrEqual(SANDBOX_TIMEOUT_MS);
    expect(took).toBeLessThan(SANDBOX_TIMEOUT_MS + 2_000);
  }, 10_000);

  it.each([
    ["DELETE FROM visible_deliveries", "refused", "only SELECT or WITH queries are allowed"],
    ["ATTACH DATABASE ':memory:' AS x", "refused", "only SELECT or WITH queries are allowed"],
    ["PRAGMA table_list", "refused", "only SELECT or WITH queries are allowed"],
    ["SELECT 1; SELECT 2", "refused", "only one statement is allowed"],
    [
      "WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c) SELECT count(*) FROM c",
      "refused",
      "RECURSIVE is not allowed",
    ],
    // SQLite runs a self-referencing CTE without the keyword too: the authorizer stops it.
    [
      "WITH c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c) SELECT count(*) FROM c",
      "error",
      "not authorized",
    ],
    ["SELECT name FROM sqlite_master", "error", "access to sqlite_master.name is prohibited"],
    ["SELECT random() AS r", "error", "not authorized to use function: random"],
    [
      "SELECT printf('%.*c', 100000000, 'x') AS big",
      "error",
      "not authorized to use function: printf",
    ],
    ["SELECT nope FROM visible_deliveries", "error", "no such column: nope"],
  ])("does not run %s", async (sql, status, reason) => {
    expect(await runSandboxed(sql, everything)).toMatchObject({ status, reason });
  });

  it("runs two queries at once and turns a third away as busy", async () => {
    const slow =
      "SELECT count(*) FROM visible_deliveries a, visible_deliveries b, visible_deliveries c, visible_deliveries d";
    const runs = [
      runSandboxed(slow, everything),
      runSandboxed(slow, everything),
      runSandboxed("SELECT 1", everything),
    ];
    const [first, second, third] = await Promise.all(runs);
    expect(third).toMatchObject({ status: "busy" });
    expect([first?.status, second?.status]).toEqual(["timeout", "timeout"]);
  }, 10_000);
});

describe("stat-back's view of the match stops at the fan's TV (PLAN 8.4)", () => {
  it("visible_deliveries holds the deliveries up to the TV's time and none after", async () => {
    const tvT = delivery(b.events, 2, "17.6").t;
    const shown = deliveries.filter((d) => d.t <= tvT);
    const out = await runSandboxed(
      `SELECT count(*) AS n, max(seq) AS last,
              (SELECT count(*) FROM visible_deliveries WHERE innings = 2 AND over >= 18) AS later
         FROM visible_deliveries`,
      statBackTables(b, tvT),
    );
    expect(out.status === "ok" && out.rows).toEqual([
      { n: shown.length, last: shown.at(-1)?.seq, later: 0 },
    ]);
  });
});
