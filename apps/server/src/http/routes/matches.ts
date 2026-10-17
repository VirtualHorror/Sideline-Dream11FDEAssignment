/**
 * GET /api/matches: the demo matches and their personas, for the landing page's picker (Task 6).
 * GET /api/matches/:matchId: what the match room needs to fold, name and chart the match in the
 * browser (Task 6, D-060): the summary, both full squads, the fantasy rules and the win-probability
 * model. Everything here is public match data and model weights, never config or keys.
 *
 * A persona's squad, affinity and join point stay on the server: the picker needs its name, blurb,
 * lens and stream delay only, and the stream's `hello` brings the session's own persona.
 */
import type { Hono } from "hono";
import type { AppRuntime } from "../app.ts";
import { jsonError } from "../middleware/body.ts";

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

  app.get("/api/matches/:matchId", (c) => {
    const id = c.req.param("matchId");
    const bundle = runtime.bundles.get(id);
    if (!bundle) return jsonError(c, 404, "not_found", `No match ${id}`);
    return c.json({
      match: bundle.summary,
      players: bundle.players,
      rules: bundle.rules,
      winprob: bundle.winprob,
    });
  });
}
