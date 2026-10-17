/**
 * App shell: header (wordmark, "How Sideline is built", theme control), the routed page, and the
 * footer with the attribution line, which therefore appears on every route (Constraint 17).
 *
 * Routes (router.tsx): `/` the landing page, `/match/:matchId` the match room, `/architecture` the
 * shareable architecture and plan page. The room and the docs page are loaded on demand: the landing
 * page needs neither, and its first paint is the one most fans wait for (Task 9.5, Lighthouse).
 */
import { lazy, Suspense } from "react";
import { AttributionFooter } from "./components/AttributionFooter.tsx";
import { Landing } from "./pages/Landing.tsx";
import { Link, useRoute } from "./router.tsx";
import { ThemeControl } from "./theme/ThemeControl.tsx";

const Architecture = lazy(() =>
  import("./pages/Architecture.tsx").then((module) => ({ default: module.Architecture })),
);
const MatchRoom = lazy(() =>
  import("./pages/MatchRoom.tsx").then((module) => ({ default: module.MatchRoom })),
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
        {route.name === "match" ? (
          <Suspense fallback={<p className="page-loading">Loading the match…</p>}>
            <MatchRoom matchId={route.matchId} />
          </Suspense>
        ) : null}
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
