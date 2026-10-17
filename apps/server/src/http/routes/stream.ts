/**
 * GET /api/sessions/:id/stream: the session as Server-Sent Events (D-010, PLAN Task 5).
 *
 * Each StreamMessage is one frame: `event:` its type, `id:` its seq, `data:` the whole message as
 * JSON (the client validates it with StreamMessageSchema). Every connection starts with `hello` and
 * a full `snapshot`, so a reconnect resynchronises; a comment line every 15 s keeps proxies from
 * closing a quiet stream. Nothing from the config ever goes down it (Constraint 13).
 */
import type { StreamMessage } from "@sideline/engine";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppRuntime } from "../app.ts";
import { jsonError } from "../middleware/body.ts";

export const HEARTBEAT_MS = 15_000;

export function registerStreamRoutes(app: Hono, runtime: AppRuntime): void {
  app.get("/api/sessions/:id/stream", (c) => {
    const id = c.req.param("id");
    const session = runtime.manager.get(id);
    if (!session) return jsonError(c, 404, "not_found", `No session ${id}`);
    return streamSSE(c, async (stream) => {
      const queue: StreamMessage[] = [];
      let wake: (() => void) | null = null;
      let open = true;
      const unsubscribe = session.connect((message) => {
        queue.push(message);
        wake?.();
      });
      stream.onAbort(() => {
        open = false;
        wake?.();
      });
      const heartbeat = setInterval(() => {
        stream.write(": heartbeat\n\n").catch(() => {});
      }, runtime.heartbeatMs ?? HEARTBEAT_MS);
      try {
        while (open && !stream.aborted) {
          const next = queue.shift();
          if (next) {
            await stream.writeSSE({
              event: next.type,
              id: String(next.seq),
              data: JSON.stringify(next),
            });
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });
}
