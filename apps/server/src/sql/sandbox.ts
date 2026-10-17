/**
 * Runs one model-written (or, in the inspector, operator-written) SQL query safely (PLAN 8.4, Review
 * focus 5): validate the text (sql/validate.ts), then run it in a fresh worker thread (sql/worker.ts)
 * on an in-memory copy of the documented views it is given (sql/views.ts), read-only and behind
 * SQLite's authorizer, as `SELECT * FROM (<sql>) LIMIT 200`, and terminate the worker if it has not
 * answered after 2 s. At most two run at once; more is "busy" (each may burn up to 2 s of CPU).
 *
 * Callers: ai/skills/statBack.ts and ai/skills/inspector.ts. Never throws: every outcome, including a
 * refusal, a timeout or SQLite's own error message, comes back as data the card or the inspector shows.
 */
import { Worker } from "node:worker_threads";
import { validateSql } from "./validate.ts";
import type { SqlTable } from "./views.ts";
import type { WorkerInput, WorkerOutput } from "./worker.ts";

export const SANDBOX_TIMEOUT_MS = 2_000;
export const SANDBOX_MAX_ROWS = 200;
const MAX_RUNNING = 2;

export type SqlRow = Record<string, unknown>;

export type SandboxOutcome =
  | { status: "ok"; sql: string; columns: string[]; rows: SqlRow[]; truncated: boolean }
  | { status: "refused" | "timeout" | "error" | "busy"; sql: string; reason: string };

let running = 0;
const WORKER = new URL("./worker.ts", import.meta.url);

export async function runSandboxed(
  sql: string,
  tables: readonly SqlTable[],
): Promise<SandboxOutcome> {
  const checked = validateSql(sql);
  if (!checked.ok) return { status: "refused", sql: sql.trim(), reason: checked.reason };
  if (running >= MAX_RUNNING) {
    return { status: "busy", sql: checked.sql, reason: "the sandbox is busy: try again shortly" };
  }
  running += 1;
  try {
    const input: WorkerInput = {
      tables: tables.map((t) => ({ name: t.name, columns: t.columns, rows: t.rows })),
      sql: checked.sql,
      maxRows: SANDBOX_MAX_ROWS,
    };
    const output = await new Promise<WorkerOutput | "timeout">((resolve) => {
      const worker = new Worker(WORKER, {
        workerData: input,
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      });
      const timer = setTimeout(() => {
        resolve("timeout");
        void worker.terminate();
      }, SANDBOX_TIMEOUT_MS);
      const done = (result: WorkerOutput) => {
        clearTimeout(timer);
        resolve(result);
        void worker.terminate();
      };
      worker.once("message", (message: WorkerOutput) => done(message));
      worker.once("error", (error) => done({ ok: false, error: error.message }));
      worker.once("exit", (code) => done({ ok: false, error: `the worker stopped (${code})` }));
    });
    if (output === "timeout") {
      return {
        status: "timeout",
        sql: checked.sql,
        reason: "the query ran past 2 s and was stopped",
      };
    }
    if (!output.ok) return { status: "error", sql: checked.sql, reason: output.error };
    return {
      status: "ok",
      sql: checked.sql,
      columns: output.columns,
      rows: output.rows,
      truncated: output.rows.length >= SANDBOX_MAX_ROWS,
    };
  } finally {
    running -= 1;
  }
}
