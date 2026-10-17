/**
 * Three routes, a small router (D-062): `/` the landing page, `/match/:matchId` the match room,
 * `/architecture` the shareable architecture and plan page. The server answers any non-API path with
 * index.html (Flow §2), so deep links work; in the app, `Link` and `navigate` use the History API.
 *
 * Callers: App.tsx (which page), the pages (navigation), e2e/smoke.spec.ts (every route listed).
 */
import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

export type Route =
  | { name: "landing" }
  | { name: "match"; matchId: string }
  | { name: "architecture" }
  | { name: "not_found"; path: string };

export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/") return { name: "landing" };
  if (path === "/architecture") return { name: "architecture" };
  // Match ids are Cricsheet's numeric ids (MatchIdSchema).
  const match = path.match(/^\/match\/(\d{5,9})$/);
  if (match?.[1]) return { name: "match", matchId: match[1] };
  return { name: "not_found", path: pathname };
}

const NAVIGATE = "sideline:navigate";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

const location = () => window.location.pathname + window.location.search;

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATE));
  if (!opts.replace) window.scrollTo({ top: 0 });
}

/** The current route and query string; re-renders on navigation and on the browser's back/forward. */
export function useRoute(): { route: Route; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, location, location);
  const url = new URL(href, window.location.origin);
  return { route: parseRoute(url.pathname), search: url.searchParams };
}

export function Link({
  to,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    // Let the browser handle new tabs, downloads and modified clicks.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...props} />;
}
