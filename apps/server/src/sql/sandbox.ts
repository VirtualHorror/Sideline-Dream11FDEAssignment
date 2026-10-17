/**
 * Runs one model-written (or, in the inspector, operator-written) SQL query safely (PLAN 8.4, Review
 * focus 5): validate the text (sql/validate.ts), then run it in a fresh child process (sql/worker.ts)
 * on an in-memory copy of the documented views it is given (sql/views.ts), read-only and behind
 * SQLite's authorizer, as `SELECT * FROM (<sql>) LIMIT 200`, and kill the process if it has not
 * answered after 2 s. A process rather than a worker thread (D-078): SQLite's query loop is native
 * code that a thread's terminate() cannot interrupt, so only a killed process really stops the work.
 * At most two run at once; more is "busy" (each may burn up to 2 s of CPU). The process starts with
 * an empty environment, so the server's keys are never inside it.
 *
 * Callers: ai/skills/statBack.ts and ai/skills/inspector.ts. Never throws: every outcome, including a
 * refusal, a timeout or SQLite's own error message, comes back as data the card or the inspector shows.
 */
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateSql } from "./validate.ts";
import type { SqlTable } from "./views.ts";
import type { WorkerInput, WorkerOutput } from "./worker.ts";

export const SANDBOX_TIMEOUT_MS = 2_000;
export const SANDBOX_MAX_ROWS = 200;
const MAX_RUNNING = 2;
/** The worker's V8 heap limits (64 MB old generation, as the worker thread had). */
const WORKER_EXEC_ARGV = ["--max-old-space-size=64", "--max-semi-space-size=8"];

export type SqlRow = Record<string, unknown>;

export type SandboxOutcome =
  | { status: "ok"; sql: string; columns: string[]; rows: SqlRow[]; truncated: boolean }
  | { status: "refused" | "timeout" | "error" | "busy"; sql: string; reason: string };

let running = 0;
const WORKER = fileURLToPath(new URL("./worker.ts", import.meta.url));

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
    const output = await runWorker({
      tables: tables.map((t) => ({ name: t.name, columns: t.columns, rows: t.rows })),
      sql: checked.sql,
      maxRows: SANDBOX_MAX_ROWS,
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

/**
 * Forks the worker for one query and settles only once its process has exited: killed after its
 * answer or at the timeout, or crashed. So a slot is free only when nothing of its query still runs.
 */
function runWorker(input: WorkerInput): Promise<WorkerOutput | "timeout"> {
  return new Promise((resolve) => {
    let result: WorkerOutput | "timeout" | undefined;
    const child = fork(WORKER, {
      execArgv: WORKER_EXEC_ARGV,
      env: {},
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const settle = (outcome: WorkerOutput | "timeout") => {
      result ??= outcome;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => settle("timeout"), SANDBOX_TIMEOUT_MS);
    child.once("message", (message: WorkerOutput) => settle(message));
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(result ?? { ok: false, error: `the worker stopped (${code ?? signal})` });
    });
    child.once("error", (error) => {
      // Without a pid the process never started and no exit follows; otherwise a send failed.
      if (child.pid !== undefined) return settle({ ok: false, error: error.message });
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.send(input);
  });
}
