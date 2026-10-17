/**
 * The first gate for model-written SQL (PLAN 8.4, Review focus 5): one statement, starting with
 * SELECT or WITH, without the words that write, change the schema, attach files, set pragmas,
 * recurse or load extensions. It gives a plain reason for each refusal; the worker's read-only,
 * authorizer-guarded connection (sql/worker.ts) is the wall behind it.
 *
 * Callers: sql/sandbox.ts, before any worker starts. Deliberately strict: a denied word inside a string
 * literal is refused too, and so is any comment (one could swallow the wrapper's closing parenthesis).
 */

export const MAX_SQL_CHARS = 2000;

/** The PLAN's deny list, plus transaction control (a read-only query never needs it). */
const DENIED = [
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "REPLACE",
  "VACUUM",
  "RECURSIVE",
  "REINDEX",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "LOAD_EXTENSION",
];
const DENIED_WORD = new RegExp(`\\b(${DENIED.join("|")})\\b`, "i");

export type SqlCheck = { ok: true; sql: string } | { ok: false; reason: string };

export function validateSql(input: string): SqlCheck {
  const sql = input.trim().replace(/;\s*$/, "").trim();
  if (sql === "") return { ok: false, reason: "the query is empty" };
  if (sql.length > MAX_SQL_CHARS) {
    return { ok: false, reason: `the query is over ${MAX_SQL_CHARS} characters` };
  }
  if (sql.includes(";")) return { ok: false, reason: "only one statement is allowed" };
  if (/--|\/\*/.test(sql)) return { ok: false, reason: "comments are not allowed" };
  if (!/^(SELECT|WITH)\b/i.test(sql)) {
    return { ok: false, reason: "only SELECT or WITH queries are allowed" };
  }
  const denied = sql.match(DENIED_WORD)?.[1];
  if (denied) return { ok: false, reason: `${denied.toUpperCase()} is not allowed` };
  return { ok: true, sql };
}
