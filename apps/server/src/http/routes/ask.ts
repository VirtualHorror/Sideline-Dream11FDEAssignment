/**
 * POST /api/sessions/:id/ask: a fan's question, `{ text (1-280), lens? }` → `{ moment }`.
 *
 * Rate-limited per address first (12 a minute, a burst of 4: 429 with Retry-After), then validated
 * (400: blank, over 280 characters, unknown lens). A glossary term is answered at once with no model
 * call; anything else goes to the explainer through the gateway, its text treated as data
 * (Constraint 12, Review focus 5).
 */
import { LensSchema } from "@sideline/engine";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppRuntime } from "../app.ts";
import { jsonError, readJson } from "../middleware/body.ts";
import { ASK_BURST, clientIp, createRateLimiter } from "../middleware/rateLimit.ts";

export const AskRequestSchema = z.object({
  text: z.string().trim().min(1).max(280),
  lens: LensSchema.optional(),
});

export function registerAskRoutes(app: Hono, runtime: AppRuntime, now: () => number): void {
  const limiter = createRateLimiter({ perMinute: runtime.askPerMinute, burst: ASK_BURST, now });
  app.post("/api/sessions/:id/ask", async (c) => {
    const allowed = limiter.take((runtime.clientIp ?? clientIp)(c));
    if (!allowed.ok) {
      c.header("Retry-After", String(allowed.retryAfterSec));
      return jsonError(c, 429, "rate_limited", "Too many questions: try again in a few seconds.");
    }
    const id = c.req.param("id");
    const session = runtime.manager.get(id);
    if (!session) return jsonError(c, 404, "not_found", `No session ${id}`);
    const body = await readJson(c, AskRequestSchema);
    if (!body.ok) return body.response;
    if (session.failed()) return jsonError(c, 409, "session_failed", "This session was paused.");
    const moment = await session.ask(body.value.text, body.value.lens);
    return c.json({ moment });
  });
}
