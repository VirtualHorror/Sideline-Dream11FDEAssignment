/**
 * GET /api/telemetry?scope=global|session&sessionId=&viewers=: the control plane's numbers
 * (TelemetrySnapshot). The projection defaults to 10,000,000 viewers. No session data beyond
 * moment keys and gate decisions is exposed: traces carry no session id or fan text.
 */
import type { Hono } from "hono";
import { z } from "zod";
import type { AppRuntime } from "../app.ts";
import { jsonError } from "../middleware/body.ts";

const TelemetryQuerySchema = z
  .object({
    scope: z.enum(["global", "session"]).default("global"),
    sessionId: z.string().min(1).optional(),
    viewers: z.coerce.number().int().positive().max(10_000_000_000).optional(),
  })
  .refine((q) => q.scope === "global" || q.sessionId !== undefined, {
    message: "sessionId is required for the session scope",
    path: ["sessionId"],
  });

export function registerTelemetryRoutes(app: Hono, runtime: AppRuntime): void {
  app.get("/api/telemetry", (c) => {
    const query = TelemetryQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      const message = query.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return jsonError(c, 400, "invalid_request", message);
    }
    const { scope, sessionId, viewers } = query.data;
    if (scope === "session" && !runtime.telemetry.hasSession(sessionId ?? "")) {
      return jsonError(c, 404, "not_found", `No session ${sessionId}`);
    }
    return c.json(runtime.telemetry.snapshot(scope, sessionId, viewers));
  });
}
