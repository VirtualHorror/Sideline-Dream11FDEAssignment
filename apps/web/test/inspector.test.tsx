/**
 * PLAN 9.2: the inspector in the control plane shows the SQL the model wrote, the rows, and every way a
 * query can fail; a refused query shows why. The results are InspectorResult shapes as the server's
 * sandbox returns them (apps/server/test/statBack.test.ts pins those against the real sandbox).
 */
import type { InspectorResult } from "@sideline/engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorQuery } from "../src/controlplane/InspectorQuery.tsx";

afterEach(cleanup);

const base: InspectorResult = {
  question: "Who has scored most so far?",
  source: "ai",
  provenance: "live",
  traceId: "t-1",
  explanation: "Runs per batter on your TV.",
  sql: "SELECT batter, sum(runs_batter) AS runs FROM visible_deliveries GROUP BY batter ORDER BY runs DESC LIMIT 1",
  status: "ok",
  reason: null,
  columns: ["batter", "runs"],
  rows: [{ batter: "Virat Kohli", runs: 61 }],
  truncated: false,
};
const views = [
  { view: "visible_deliveries", about: "Deliveries on your TV.", columns: ["seq INTEGER: order"] },
];

describe("InspectorQuery (PLAN 9.2)", () => {
  it("asks in English and shows the model's SQL, its explanation and the rows", async () => {
    const inspect = vi.fn().mockResolvedValue(base);
    render(<InspectorQuery inspect={inspect} views={views} />);
    fireEvent.change(screen.getByLabelText("Ask about the match or Sideline's AI calls"), {
      target: { value: "Who has scored most so far?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(inspect).toHaveBeenCalledWith({ question: "Who has scored most so far?" });
    expect(await screen.findByText("Runs per batter on your TV.")).toBeTruthy();
    expect((screen.getByLabelText("SQL") as HTMLTextAreaElement).value).toBe(base.sql);
    expect(screen.getByText("1 row")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "batter",
      "runs",
    ]);
    expect(screen.getByText("Live AI")).toBeTruthy();
  });

  it("runs the fan's own SQL and shows a refusal with its reason", async () => {
    const inspect = vi.fn().mockResolvedValue({
      ...base,
      question: null,
      source: "you",
      provenance: null,
      traceId: null,
      explanation: null,
      sql: "DELETE FROM ai_calls",
      status: "refused",
      reason: "only SELECT or WITH queries are allowed",
      columns: [],
      rows: [],
    } satisfies InspectorResult);
    render(<InspectorQuery inspect={inspect} views={views} />);
    fireEvent.change(screen.getByLabelText("SQL"), { target: { value: "DELETE FROM ai_calls" } });
    fireEvent.click(screen.getByRole("button", { name: "Run SQL" }));
    expect(inspect).toHaveBeenCalledWith({ sql: "DELETE FROM ai_calls" });
    expect(
      await screen.findByText("Refused: only SELECT or WITH queries are allowed."),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each([
    [
      "timeout",
      "the query ran past 2 s and was stopped",
      "Stopped: the query ran past 2 s and was stopped.",
    ],
    ["error", "no such column: session_id", "SQLite said: no such column: session_id."],
    [
      "no_query",
      "AI is unavailable, so no query was written: write the SQL yourself.",
      "AI is unavailable, so no query was written: write the SQL yourself.",
    ],
  ] as const)("says what happened on %s", async (status, reason, shown) => {
    const inspect = vi.fn().mockResolvedValue({ ...base, status, reason, rows: [], columns: [] });
    render(<InspectorQuery inspect={inspect} views={views} />);
    fireEvent.change(screen.getByLabelText("Ask about the match or Sideline's AI calls"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(shown)).toBeTruthy();
  });

  it("lists the tables it may read", () => {
    render(<InspectorQuery inspect={vi.fn()} views={views} />);
    expect(screen.getByText("Tables you can query")).toBeTruthy();
    expect(screen.getByText("visible_deliveries")).toBeTruthy();
  });
});
