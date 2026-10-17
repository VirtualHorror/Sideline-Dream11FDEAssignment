/**
 * The landing page (`/`): the floodlit hero with the ghost-text wordmark (the light rises from the
 * hero's bottom edge, as in the reference recording), the persona picker under it, and the three ways
 * Sideline does or does not use AI (DESIGN_SYSTEM §5). The matches and personas come from
 * GET /api/matches; "Start watching" opens `/match/<id>?persona=<id>`.
 * Caller: App.tsx.
 */
import { useEffect, useState } from "react";
import { PersonaPicker } from "../components/PersonaPicker.tsx";
import { FloodlightGlow } from "../effects/FloodlightGlow.tsx";
import { GhostText } from "../effects/GhostText.tsx";
import { ApiError, api, type MatchListing } from "../lib/api.ts";
import { Link, navigate } from "../router.tsx";

export function Landing() {
  const [matches, setMatches] = useState<MatchListing[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .matches()
      .then((found) => live && setMatches(found))
      .catch((error: unknown) => {
        if (live) {
          setProblem(
            error instanceof ApiError
              ? error.message
              : "The matches did not load. Reload the page to try again.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="landing">
      <section className="hero" aria-label="Sideline">
        <FloodlightGlow />
        <div className="hero__inner">
          <GhostText as="h1" text="Sideline" mode="pointer" className="hero__wordmark" />
          <p className="hero__tagline">The match, on your clock.</p>
          <p className="hero__lede">
            A second screen for live cricket that holds every spoiler until your stream shows it,
            catches you up when you arrive late, and tells you when it is using AI.
          </p>
        </div>
      </section>

      <section className="start" aria-label="Start watching">
        {matches ? (
          <PersonaPicker
            matches={matches}
            onStart={(matchId, personaId) =>
              navigate(`/match/${matchId}?persona=${encodeURIComponent(personaId)}`)
            }
            onStory={(matchId) => navigate(`/match/${matchId}?story=1`)}
          />
        ) : problem ? (
          <p className="notice" role="alert">
            {problem}
          </p>
        ) : (
          <p className="start__loading">Loading the matches…</p>
        )}
      </section>

      <section className="ai-use" aria-labelledby="ai-use-title">
        <h2 id="ai-use-title" className="section-title">
          When Sideline uses AI, and when it doesn't
        </h2>
        <div className="ai-use__grid">
          <article className="ai-use__item">
            <h3 className="ai-use__title">Rules, every ball</h3>
            <p>
              The score, fantasy points, win probability, the delay that holds spoilers and the
              glossary are computed from ball-by-ball data. No model is called.
            </p>
          </article>
          <article className="ai-use__item">
            <h3 className="ai-use__title">AI once per moment</h3>
            <p>
              A big ball's teaser and a late fan's catch-up are written once and cached by moment,
              so every fan at that moment shares a single call.
            </p>
          </article>
          <article className="ai-use__item">
            <h3 className="ai-use__title">AI for your questions</h3>
            <p>
              Ask about anything your TV has shown. Answers only use what your stream has reached,
              and every card says where its words came from.
            </p>
          </article>
        </div>
        <p className="ai-use__more">
          <Link to="/architecture">How Sideline is built</Link>, with the live count of what ran
          without AI.
        </p>
      </section>
    </div>
  );
}
