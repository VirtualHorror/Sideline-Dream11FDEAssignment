/**
 * POST /api/sessions/:id/chat: the fan's own line in the watch-along chat, `{ text (1-280),
 * statBack? }` → `{ message, moment }` (PLAN 8.5). The line is stamped on the fan's TV clock and sent
 * on their stream only (the room read never reads it, D-045); with `statBack: true` the line is also
 * a take checked against the match database, and `moment` is its take card (else null).
 *
 * Rate-limited per address first (429 with Retry-After), then validated (400; 413 over the body cap).
 */
import type { Hono } from "hono";
import { z } from "zod";
import type { AppRuntime } from "../app.ts";
import { jsonError, readJson } from "../middleware/body.ts";
import { ASK_BURST, clientIp, createRateLimiter } from "../middleware/rateLimit.ts";

const ChatRequestSchema = z.object({
  text: z.string().trim().min(1).max(280),
  statBack: z.boolean().optional(),
});

export function registerChatRoutes(app: Hono, runtime: AppRuntime, now: () => number): void {
  const limiter = createRateLimiter({ perMinute: runtime.askPerMinute, burst: ASK_BURST, now });
  app.post("/api/sessions/:id/chat", async (c) => {
    const allowed = limiter.take((runtime.clientIp ?? clientIp)(c));
    if (!allowed.ok) {
      c.header("Retry-After", String(allowed.retryAfterSec));
      return jsonError(c, 429, "rate_limited", "Too many messages: try again in a few seconds.");
    }
    const id = c.req.param("id");
    const session = runtime.manager.get(id);
    if (!session) return jsonError(c, 404, "not_found", `No session ${id}`);
    const body = await readJson(c, ChatRequestSchema);
    if (!body.ok) return body.response;
    if (session.failed()) return jsonError(c, 409, "session_failed", "This session was paused.");
    return c.json(await session.chat(body.value.text, body.value.statBack ?? false));
  });
}
