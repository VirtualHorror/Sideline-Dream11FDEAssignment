/**
 * App shell: header (wordmark, "How Sideline is built", theme control), the routed page, and the
 * footer with the attribution line, which therefore appears on every route (Constraint 17).
 *
 * Routes (router.tsx): `/` the landing page, `/match/:matchId` the match room, `/architecture` the
 * shareable architecture and plan page (loaded on demand: it carries the docs and the markdown
 * renderer, which the landing and the match room do not need).
 */
import { lazy, Suspense } from "react";
import { AttributionFooter } from "./components/AttributionFooter.tsx";
import { Landing } from "./pages/Landing.tsx";
import { MatchRoom } from "./pages/MatchRoom.tsx";
import { Link, useRoute } from "./router.tsx";
import { ThemeControl } from "./theme/ThemeControl.tsx";

const Architecture = lazy(() =>
  import("./pages/Architecture.tsx").then((module) => ({ default: module.Architecture })),
);

function NotFound() {
  return (
    <section className="page-message">
      <h1 className="page-message__title">That page isn't here</h1>
      <p>
        <Link to="/">Go to the start</Link> to pick a match and a fan.
      </p>
    </section>
  );
}

export function App() {
  const { route } = useRoute();
  return (
    <div className="shell" data-route={route.name}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell__header">
        <Link to="/" className="wordmark">
          Sideline
        </Link>
        <nav className="shell__nav" aria-label="Site">
          <Link
            to="/architecture"
            className="shell__link"
            aria-current={route.name === "architecture" ? "page" : undefined}
          >
            How Sideline is built
          </Link>
        </nav>
        <ThemeControl />
      </header>

      <main id="main" className="shell__main">
        {route.name === "landing" ? <Landing /> : null}
        {route.name === "match" ? <MatchRoom matchId={route.matchId} /> : null}
        {route.name === "architecture" ? (
          <Suspense fallback={<p className="page-loading">Loading the architecture…</p>}>
            <Architecture />
          </Suspense>
        ) : null}
        {route.name === "not_found" ? <NotFound /> : null}
      </main>

      <AttributionFooter />
    </div>
  );
}
