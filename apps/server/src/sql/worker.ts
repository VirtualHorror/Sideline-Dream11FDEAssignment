/**
 * The SQL sandbox's worker process (PLAN 8.4, D-074, D-078): it builds a throwaway in-memory database
 * from the documented views it is handed, makes the connection read-only (`PRAGMA query_only`),
 * installs an authorizer that allows only reads of those tables and a few plain functions (no PRAGMA,
 * ATTACH, writes or recursive CTEs, whatever the text says), runs the one query wrapped in a row LIMIT
 * and sends the rows back. sql/sandbox.ts forks it for each query and kills it once it has answered
 * or at the timeout.
 *
 * Runs as its own process, so it imports only Node's own modules. Table and column names come from
 * sql/views.ts, never from the query.
 */
import { constants, DatabaseSync } from "node:sqlite";

export interface WorkerTable {
  name: string;
  columns: { name: string; type: string }[];
  rows: (string | number | null)[][];
}

export interface WorkerInput {
  tables: WorkerTable[];
  sql: string;
  maxRows: number;
}

export type WorkerOutput =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

/** Plain, bounded functions a statistics query needs; every other function is refused. */
const FUNCTIONS = new Set([
  "abs",
  "avg",
  "coalesce",
  "count",
  "group_concat",
  "ifnull",
  "iif",
  "instr",
  "length",
  "lower",
  "ltrim",
  "max",
  "min",
  "nullif",
  "round",
  "rtrim",
  "substr",
  "substring",
  "sum",
  "total",
  "trim",
  "typeof",
  "upper",
]);

function run({ tables, sql, maxRows }: WorkerInput): WorkerOutput {
  const db = new DatabaseSync(":memory:");
  try {
    for (const table of tables) {
      db.exec(
        `CREATE TABLE ${table.name} (${table.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`,
      );
      const insert = db.prepare(
        `INSERT INTO ${table.name} VALUES (${table.columns.map(() => "?").join(", ")})`,
      );
      db.exec("BEGIN");
      for (const row of table.rows) insert.run(...row);
      db.exec("COMMIT");
    }
    db.exec("PRAGMA query_only = ON");
    const readable = new Set(tables.map((t) => t.name));
    db.setAuthorizer((action, first, second) => {
      if (action === constants.SQLITE_SELECT) return constants.SQLITE_OK;
      if (action === constants.SQLITE_READ) {
        return first !== null && readable.has(first) ? constants.SQLITE_OK : constants.SQLITE_DENY;
      }
      if (action === constants.SQLITE_FUNCTION) {
        return FUNCTIONS.has(String(second).toLowerCase())
          ? constants.SQLITE_OK
          : constants.SQLITE_DENY;
      }
      return constants.SQLITE_DENY;
    });
    const statement = db.prepare(`SELECT * FROM (\n${sql}\n) LIMIT ${maxRows}`);
    const columns = statement.columns().map((c) => c.name);
    const rows = statement.all().map((row) => ({ ...row }));
    return { ok: true, columns, rows };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
}

// One query per process. The listener stays, so the process waits for the sandbox's kill after its
// answer instead of exiting first (the sandbox reads an exit before an answer as a crash).
process.on("message", (input) => {
  process.send?.(run(input as WorkerInput));
});
