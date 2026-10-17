/**
 * The NL inspector (Task 8 addition, D-073): the control plane's question box over Sideline's own
 * tables. The fan asks in English (the model writes the SQL) or writes the SQL themselves; either way
 * the query runs in the server's read-only SQL sandbox, and the result says what happened.
 *
 * Callers: the server's POST /api/sessions/:id/inspector (validates the request, builds the result)
 * and the web control plane's InspectorQuery (parses it). Views and rules: docs/Architecture.md §7.
 */
import { z } from "zod";
import { ProvenanceSchema } from "./moments.ts";

export const InspectorRequestSchema = z.union([
  z.strictObject({ question: z.string().trim().min(1).max(280) }),
  z.strictObject({ sql: z.string().trim().min(1).max(2000) }),
]);
export type InspectorRequest = z.infer<typeof InspectorRequestSchema>;

export const InspectorResultSchema = z.object({
  /** The question asked, or null when the SQL was the fan's own. */
  question: z.string().nullable(),
  /** Who wrote the SQL: the model ("ai") or the person at the keyboard ("you"). */
  source: z.enum(["ai", "you"]),
  /** Where the model's SQL came from; null for the fan's own SQL. */
  provenance: ProvenanceSchema.nullable(),
  traceId: z.string().nullable(),
  /** The model's one line on what its query computes; null for the fan's own SQL. */
  explanation: z.string().nullable(),
  sql: z.string().nullable(),
  /**
   * ok: rows below; refused: the sandbox would not run it (reason); timeout: stopped after 2 s;
   * error: SQLite's own message; busy: too many queries at once; no_query: the model wrote none.
   */
  status: z.enum(["ok", "refused", "timeout", "error", "busy", "no_query"]),
  reason: z.string().nullable(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())).max(200),
  /** The query returned the sandbox's full 200 rows: there may be more. */
  truncated: z.boolean(),
});
export type InspectorResult = z.infer<typeof InspectorResultSchema>;
