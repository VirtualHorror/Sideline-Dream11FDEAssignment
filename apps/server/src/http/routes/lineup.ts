/**
 * POST /api/sessions/:id/lineup-intent: a fan's request for a different lineup patch, `{ text (1-280) }`
 * → `{ moment }` (PLAN 8.5). The text is fan text: the skill escapes it into the prompt as data.
 *
 * Rate-limited per address first (as /ask: 429 with Retry-After), then validated (400; 413 over the
 * body cap). 409 with the reason's code when the session cannot patch now: `no_squad`, `not_yet` (the
 * XIs are not out), `all_playing`, `locked` (the fan's TV has shown the first ball).
 */
import type { Hono } from "hono";
import { z } from "zod";
import { LineupIntentError } from "../../sessions/session.ts";
import type { AppRuntime } from "../app.ts";
import { jsonError, readJson } from "../middleware/body.ts";
import { ASK_BURST, clientIp, createRateLimiter } from "../middleware/rateLimit.ts";

const LineupIntentSchema = z.object({ text: z.string().trim().min(1).max(280) });

export function registerLineupRoutes(app: Hono, runtime: AppRuntime, now: () => number): void {
  const limiter = createRateLimiter({ perMinute: runtime.askPerMinute, burst: ASK_BURST, now });
  app.post("/api/sessions/:id/lineup-intent", async (c) => {
    const allowed = limiter.take((runtime.clientIp ?? clientIp)(c));
    if (!allowed.ok) {
      c.header("Retry-After", String(allowed.retryAfterSec));
      return jsonError(c, 429, "rate_limited", "Too many requests: try again in a few seconds.");
    }
    const id = c.req.param("id");
    const session = runtime.manager.get(id);
    if (!session) return jsonError(c, 404, "not_found", `No session ${id}`);
    const body = await readJson(c, LineupIntentSchema);
    if (!body.ok) return body.response;
    if (session.failed()) return jsonError(c, 409, "session_failed", "This session was paused.");
    try {
      return c.json({ moment: await session.lineupIntent(body.value.text) });
    } catch (error) {
      if (!(error instanceof LineupIntentError)) throw error;
      return jsonError(c, 409, error.code, error.message);
    }
  });
}
