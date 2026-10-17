/**
 * GET /api/matches: the demo matches and their personas, for the landing page's picker (Task 6).
 *
 * A persona's squad, affinity and join point stay on the server: the picker needs its name, blurb,
 * lens and stream delay only.
 */
import type { Hono } from "hono";
import type { AppRuntime } from "../app.ts";

export function registerMatchRoutes(app: Hono, runtime: AppRuntime): void {
  app.get("/api/matches", (c) =>
    c.json({
      matches: [...runtime.bundles.values()].map((bundle) => ({
        ...bundle.summary,
        personas: bundle.personas.map(({ id, label, blurb, lens, delayMs }) => ({
          id,
          label,
          blurb,
          lens,
          delayMs,
        })),
      })),
    }),
  );
}
