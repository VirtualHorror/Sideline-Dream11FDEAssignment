/**
 * PLAN 8.4, stat-back and the inspector: the model writes one SQL query against the documented views,
 * the sandbox runs it, and for stat-back a second call words the verdict, whose every number must
 * appear in the rows (or in the fan's own take). Stat-back's views stop at the fan's TV time. Real
 * figures from the raw Cricsheet file: through 17.6 of the 2022 chase Kohli had 61 off 47.
 */
import { InspectorResultSchema, TakeCardPayloadSchema } from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/ai/budget.ts";
import { createCache } from "../src/ai/cache.ts";
import { createGateway } from "../src/ai/gateway.ts";
import { createScriptedProvider, type Script } from "../src/ai/providers/scripted.ts";
import { inspect } from "../src/ai/skills/inspector.ts";
import { runStatBack, statBackKey } from "../src/ai/skills/statBack.ts";
import { openDatabase } from "../src/db/database.ts";
import { inspectorTables, statBackTables } from "../src/sql/views.ts";
import { createTraceSink } from "../src/telemetry/collector.ts";
import { bundle, fakeClock, teamsOf } from "./helpers.ts";
import { delivery } from "./runtime.ts";

const b = bundle("1298150");
const tvT = delivery(b.events, 2, "17.6").t;
const KOHLI_SQL =
  "SELECT sum(runs_batter) AS runs, sum(CASE WHEN wides = 0 THEN 1 ELSE 0 END) AS balls FROM visible_deliveries WHERE batter = 'Virat Kohli'";

function setup(script: Script | null) {
  const clock = fakeClock();
  const db = openDatabase(":memory:");
  const provider = script ? createScriptedProvider(script) : null;
  const gateway = createGateway({
    provider,
    cache: createCache(db, clock.now),
    budget: createBudget({ db, dailyUsd: 3, sessionCap: 80, now: clock.now }),
    traces: createTraceSink(db),
    models: { fast: "gpt-test-fast", smart: "gpt-test" },
    pricing: { inPerMTok: 5, outPerMTok: 20 },
    now: clock.now,
  });
  return { gateway, provider, db };
}

const takeOf = (gateway: ReturnType<typeof setup>["gateway"], take: string) =>
  runStatBack({
    gateway,
    key: statBackKey("1298150", 230, take),
    take,
    tables: statBackTables(b, tvT),
    teams: teamsOf("1298150"),
    situation: null,
  });

/** Answers the query step with `sql` and the verdict step with `statLine`. */
const answers =
  (sql: string, statLine: string, verdict = "backed"): Script =>
  (req) =>
    req.skill === "stat_back_query"
      ? { sql, checks: "Kohli's runs and balls so far." }
      : { verdict, statLine, confidence: "high" };

describe("stat-back: the take checked against the rows (PLAN 8.4)", () => {
  it("runs the model's query on the TV's deliveries and keeps a verdict whose numbers are in the rows", async () => {
    const { gateway, provider } = setup(
      answers(KOHLI_SQL, "Kohli has 61 off 47 balls: he is carrying it."),
    );
    const { payload, provenance } = await takeOf(gateway, "Kohli is carrying this chase");
    expect(provenance).toBe("live");
    expect(TakeCardPayloadSchema.parse(payload)).toEqual({
      take: "Kohli is carrying this chase",
      verdict: "backed",
      statLine: "Kohli has 61 off 47 balls: he is carrying it.",
      sql: KOHLI_SQL,
      rows: [{ runs: 61, balls: 47 }],
      confidence: "high",
    });
    const [query, verdict] = provider?.requests ?? [];
    expect(query?.user).toContain("<fan_take>Kohli is carrying this chase</fan_take>");
    expect(query?.user).toContain("visible_deliveries");
    expect(query?.system).toMatch(/<fan_take>[^.]*data/);
    expect(verdict?.user).toContain('{"runs":61,"balls":47}');
  });

  it("refuses a verdict that quotes a number the rows do not hold", async () => {
    const { gateway } = setup(answers(KOHLI_SQL, "Kohli has 74 off 47 balls."));
    const { payload, provenance, trace } = await takeOf(gateway, "Kohli is carrying this chase");
    expect(provenance).toBe("fallback");
    expect(trace?.detail).toBe("guard: 74 is not in the rows or the take");
    // The labelled template states the rows themselves.
    expect(payload).toMatchObject({
      verdict: "unclear",
      sql: KOHLI_SQL,
      rows: [{ runs: 61, balls: 47 }],
      confidence: "low",
    });
    expect(payload.statLine).toBe("The query found 1 row: runs 61, balls 47.");
  });

  it("allows a number from the fan's own take", async () => {
    const { gateway } = setup(answers(KOHLI_SQL, "Not 90: Kohli has 61 off 47.", "busted"));
    const { provenance, payload } = await takeOf(gateway, "Kohli has 90 already");
    expect(provenance).toBe("live");
    expect(payload.verdict).toBe("busted");
  });

  it("shows a refused query with the reason and never runs it", async () => {
    const { gateway, provider } = setup(answers("DELETE FROM visible_deliveries", "unused"));
    const { payload, provenance } = await takeOf(gateway, "Kohli is carrying this chase");
    expect(provenance).toBe("fallback");
    expect(payload).toMatchObject({
      verdict: "unclear",
      sql: "DELETE FROM visible_deliveries",
      rows: null,
      statLine:
        "Sideline could not check that: the query was refused (only SELECT or WITH queries are allowed).",
    });
    expect(provider?.requests.map((r) => r.skill)).toEqual(["stat_back_query"]);
  });

  it("without a provider, says so in a labelled card", async () => {
    const { gateway } = setup(null);
    const { payload, provenance } = await takeOf(gateway, "Kohli is carrying this chase");
    expect(provenance).toBe("fallback");
    expect(payload).toMatchObject({ verdict: "unclear", sql: null, rows: null, confidence: "low" });
    expect(payload.statLine).toBe("Sideline could not check that just now.");
  });

  it("cannot see the deliveries the fan's TV has not shown", async () => {
    const { gateway } = setup(
      answers(
        "SELECT max(seq) AS last, count(*) AS later FROM visible_deliveries WHERE innings = 2 AND over >= 18",
        "Nothing after 17.6 yet.",
        "unclear",
      ),
    );
    const { payload } = await takeOf(gateway, "the last two overs");
    expect(payload.rows).toEqual([{ last: null, later: 0 }]);
  });
});

describe("the inspector: a question in English, the SQL, the rows (PLAN 8.4)", () => {
  it("runs the model's SQL over the views, ai_calls included but never a session id", async () => {
    const statBack = answers(KOHLI_SQL, "Kohli has 61 off 47.");
    const { gateway, db } = setup((req, signal) =>
      req.skill === "inspector"
        ? {
            sql: "SELECT skill, outcome, count(*) AS calls FROM ai_calls GROUP BY skill, outcome",
            explanation: "Calls by skill and outcome.",
          }
        : statBack(req, signal),
    );
    await takeOf(gateway, "Kohli is carrying this chase"); // two traces to read back
    const result = await inspect({
      gateway,
      question: "How did the AI calls go?",
      tables: inspectorTables(b, tvT, db),
    });
    expect(InspectorResultSchema.parse(result)).toMatchObject({
      question: "How did the AI calls go?",
      source: "ai",
      provenance: "live",
      status: "ok",
      explanation: "Calls by skill and outcome.",
      columns: ["skill", "outcome", "calls"],
    });
    const counts = Object.fromEntries(result.rows.map((r) => [`${r.skill}:${r.outcome}`, r.calls]));
    expect(counts).toEqual({ "stat_back:ok": 1, "stat_back_query:ok": 1 });
    const leak = await inspect({
      gateway,
      sql: "SELECT session_id FROM ai_calls",
      tables: inspectorTables(b, tvT, db),
    });
    expect(leak).toMatchObject({
      source: "you",
      provenance: null,
      status: "error",
      reason: "no such column: session_id",
    });
  });

  it("shows the model's refused SQL and the reason", async () => {
    const { gateway, db } = setup(() => ({ sql: "DROP TABLE ai_calls", explanation: "Tidy up." }));
    const result = await inspect({
      gateway,
      question: "Delete everything",
      tables: inspectorTables(b, tvT, db),
    });
    expect(result).toMatchObject({
      sql: "DROP TABLE ai_calls",
      status: "refused",
      reason: "only SELECT or WITH queries are allowed",
      rows: [],
    });
  });

  it("without a provider, writes no query and says so; the operator's own SQL still runs", async () => {
    const { gateway, db } = setup(null);
    const asked = await inspect({
      gateway,
      question: "Who scored most?",
      tables: inspectorTables(b, tvT, db),
    });
    expect(asked).toMatchObject({ provenance: "fallback", status: "no_query", sql: null });
    expect(asked.reason).toBe(
      "AI is unavailable, so no query was written: write the SQL yourself.",
    );
    const own = await inspect({
      gateway,
      sql: "SELECT batter, sum(runs_batter) AS runs FROM visible_deliveries GROUP BY batter ORDER BY runs DESC LIMIT 1",
      tables: inspectorTables(b, tvT, db),
    });
    expect(own).toMatchObject({ status: "ok", rows: [{ batter: "Virat Kohli", runs: 61 }] });
  });
});
