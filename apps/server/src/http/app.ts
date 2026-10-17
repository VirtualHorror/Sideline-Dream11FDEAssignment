/**
 * HTTP application factory (Hono).
 *
 * Called by src/index.ts with real config and the runtime, and by tests via `app.request()` (no
 * socket). Route map (grows task by task, see docs/Flow.md §2):
 *   GET  /api/health                    liveness + public config summary          (Task 1)
 *   GET  /api/matches                   matches and personas for the picker       (Task 5)
 *   POST /api/sessions                  a session per browser                     (Task 5)
 *   GET  /api/sessions/:id/stream       SSE of StreamMessages                     (Task 5)
 *   POST /api/sessions/:id/control      play, pause, speed, seek, jump, delay, lens (Task 5)
 *   POST /api/sessions/:id/ask          a fan's question → explainer moment        (Task 5)
 *   GET  /api/telemetry                 the control plane's snapshot              (Task 5)
 *   ...  /api/inspector/*                                                          (Task 8)
 *   GET  /*                             built web app (apps/web/dist) + SPA fallback (Task 1)
 * The session routes exist only when a runtime is passed (the health and static tests run without).
 *
 * Order matters: security headers first, API routes next, static files last, and the SPA
 * fallback explicitly skips /api/* so an unknown API path is a JSON 404, not HTML.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { type AppConfig, publicConfigSummary } from "../config.ts";
import type { MatchBundle } from "../data/bundle.ts";
import type { SessionManager } from "../sessions/manager.ts";
import type { Telemetry } from "../telemetry/collector.ts";
import { registerAskRoutes } from "./routes/ask.ts";
import { registerControlRoutes } from "./routes/control.ts";
import { registerMatchRoutes } from "./routes/matches.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerStreamRoutes } from "./routes/stream.ts";
import { registerTelemetryRoutes } from "./routes/telemetry.ts";

/** What the API routes need: the bundles, the sessions, the telemetry and the ask rate. */
export interface AppRuntime {
  bundles: ReadonlyMap<string, MatchBundle>;
  manager: SessionManager;
  telemetry: Telemetry;
  askPerMinute: number;
  /** SSE comment interval (15 s; tests shorten it). */
  heartbeatMs?: number;
  /** Client address for the rate limit (default: socket peer, proxy-aware). */
  clientIp?: (c: Context) => string;
}

export interface AppDeps {
  config: AppConfig;
  /** Root package.json version, shown on /api/health. */
  version: string;
  /** Epoch ms the process started; used for uptime. */
  startedAt: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Sessions, AI and telemetry (src/index.ts); without it only health and static files are served. */
  runtime?: AppRuntime;
}

export function createApp(deps: AppDeps): Hono {
  const { config, version, startedAt } = deps;
  const now = deps.now ?? Date.now;
  const app = new Hono();

  // Same-origin only. No inline scripts (the theme bootstrap is a file, see apps/web/public).
  // Inline *styles* are allowed because components set CSS custom properties (team colours).
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
    }),
  );

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      service: "sideline",
      version,
      uptimeSec: Math.floor((now() - startedAt) / 1000),
      node: process.version,
      ...publicConfigSummary(config),
    }),
  );

  if (deps.runtime) {
    registerMatchRoutes(app, deps.runtime);
    registerSessionRoutes(app, deps.runtime);
    registerStreamRoutes(app, deps.runtime);
    registerControlRoutes(app, deps.runtime);
    registerAskRoutes(app, deps.runtime, now);
    registerTelemetryRoutes(app, deps.runtime);
  }

  // Static web build + SPA fallback, only when a build exists (dev uses the Vite server).
  const indexPath = join(config.webDistDir, "index.html");
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, "utf8");
    app.use("/*", serveStatic({ root: config.webDistDir }));
    app.get("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : c.html(indexHtml)));
  }

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? c.json(
          {
            error: { code: "not_found", message: `No API route for ${c.req.method} ${c.req.path}` },
          },
          404,
        )
      : c.text("Not found", 404),
  );

  app.onError((err, c) => {
    // Log the real error server-side; never leak stack traces or internals to clients.
    console.error("[sideline] unhandled error", err);
    return c.json(
      { error: { code: "internal", message: "Something went wrong on our side." } },
      500,
    );
  });

  return app;
}
