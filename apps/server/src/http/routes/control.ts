/**
 * POST /api/sessions/:id/control: play, pause, speed, seek, jump, delay or lens (ControlRequest).
 * Answers `{ clock }`; 400 for an invalid request or a jump target the match does not have; 404 for
 * an unknown session. Seek and jump refold the session and stream a fresh snapshot.
 */
import { ControlRequestSchema } from "@sideline/engine";
import type { Hono } from "hono";
import { ControlError } from "../../sessions/session.ts";
import type { AppRuntime } from "../app.ts";
import { jsonError, readJson } from "../middleware/body.ts";

export function registerControlRoutes(app: Hono, runtime: AppRuntime): void {
  app.post("/api/sessions/:id/control", async (c) => {
    const id = c.req.param("id");
    const session = runtime.manager.get(id);
    if (!session) return jsonError(c, 404, "not_found", `No session ${id}`);
    const body = await readJson(c, ControlRequestSchema);
    if (!body.ok) return body.response;
    try {
      return c.json({ clock: session.control(body.value) });
    } catch (error) {
      if (!(error instanceof ControlError)) throw error;
      return jsonError(c, 400, "invalid_control", error.message);
    }
  });
}
