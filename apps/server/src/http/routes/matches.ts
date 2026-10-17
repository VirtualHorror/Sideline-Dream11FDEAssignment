/**
 * GET /api/matches: the demo matches and their personas, for the landing page's picker (Task 6).
 * GET /api/matches/:matchId: what the match room needs to fold, name and chart the match in the
 * browser (Task 6, D-060): the summary, both full squads, the fantasy rules and the win-probability
 * model. Everything here is public match data and model weights, never config or keys.
 *
 * GET /api/matches/:matchId/story: the guided story's beats (Task 9, D-076), built once per match by
 * the engine from the personas and the gate's triggers; `{ story: null }` when no persona can lead it.
 *
 * A persona's squad, affinity and join point stay on the server: the picker needs its name, blurb,
 * lens and stream delay only, and the stream's `hello` brings the session's own persona. The story
 * names beats by event id and time, never what happens on them.
 */
import { buildStoryPlan, type StoryPlan } from "@sideline/engine";
import type { Hono } from "hono";
import type { MatchBundle } from "../../data/bundle.ts";
import type { AppRuntime } from "../app.ts";
import { jsonError } from "../middleware/body.ts";

const stories = new WeakMap<MatchBundle, StoryPlan | null>();

function storyOf(bundle: MatchBundle): StoryPlan | null {
  if (!stories.has(bundle)) {
    stories.set(
      bundle,
      buildStoryPlan({
        matchId: bundle.summary.id,
        events: bundle.events,
        players: bundle.players,
        rules: bundle.rules,
        personas: bundle.personas,
        winprob: bundle.winprob,
        priors: bundle.priors,
        chat: bundle.crowd,
      }),
    );
  }
  return stories.get(bundle) ?? null;
}

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

  app.get("/api/matches/:matchId/story", (c) => {
    const id = c.req.param("matchId");
    const bundle = runtime.bundles.get(id);
    if (!bundle) return jsonError(c, 404, "not_found", `No match ${id}`);
    return c.json({ story: storyOf(bundle) });
  });
}
