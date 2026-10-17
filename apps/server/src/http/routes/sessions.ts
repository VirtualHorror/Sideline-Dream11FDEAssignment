/**
 * POST /api/sessions: one browser's match session (D-011). 201 with the stream URL; 404 for an
 * unknown match or persona; 503 when every session slot has an open stream (sessions/manager.ts).
 */
import { SessionCreateRequestSchema, type SessionCreateResponse } from "@sideline/engine";
import type { Hono } from "hono";
import { SessionError } from "../../sessions/manager.ts";
import type { AppRuntime } from "../app.ts";
import { jsonError, readJson } from "../middleware/body.ts";

export function registerSessionRoutes(app: Hono, runtime: AppRuntime): void {
  app.post("/api/sessions", async (c) => {
    const body = await readJson(c, SessionCreateRequestSchema);
    if (!body.ok) return body.response;
    try {
      const session = runtime.manager.create(body.value);
      const created: SessionCreateResponse = {
        sessionId: session.id,
        streamUrl: `/api/sessions/${session.id}/stream`,
      };
      return c.json(created, 201);
    } catch (error) {
      if (!(error instanceof SessionError)) throw error;
      return error.code === "busy"
        ? jsonError(c, 503, "busy", error.message)
        : jsonError(c, 404, "not_found", error.message);
    }
  });
}
