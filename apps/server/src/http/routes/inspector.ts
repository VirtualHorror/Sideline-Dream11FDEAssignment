/**
 * POST /api/sessions/:id/inspector: the control plane's inspector (PLAN 8.5, D-073), `{ question }`
 * (the model writes the SQL) or `{ sql }` (the operator's own) → `{ result }` (InspectorResult). Either
 * way the query runs in the read-only sandbox over the views at the fan's TV time; a refusal, a
 * timeout or SQLite's error is a result too, never a 500 (Review focus 5).
 *
 * Rate-limited per address first (429 with Retry-After): each query may burn up to 2 s of CPU.
 */
import { InspectorRequestSchema } from "@sideline/engine";
import type { Hono } from "hono";
import type { AppRuntime } from "../app.ts";
import { jsonError, readJson } from "../middleware/body.ts";
import { ASK_BURST, clientIp, createRateLimiter } from "../middleware/rateLimit.ts";

export function registerInspectorRoutes(app: Hono, runtime: AppRuntime, now: () => number): void {
  const limiter = createRateLimiter({ perMinute: runtime.askPerMinute, burst: ASK_BURST, now });
  app.post("/api/sessions/:id/inspector", async (c) => {
    const allowed = limiter.take((runtime.clientIp ?? clientIp)(c));
    if (!allowed.ok) {
      c.header("Retry-After", String(allowed.retryAfterSec));
      return jsonError(c, 429, "rate_limited", "Too many queries: try again in a few seconds.");
    }
    const id = c.req.param("id");
    const session = runtime.manager.get(id);
    if (!session) return jsonError(c, 404, "not_found", `No session ${id}`);
    const body = await readJson(c, InspectorRequestSchema);
    if (!body.ok) return body.response;
    return c.json({ result: await session.inspect(body.value) });
  });
}
