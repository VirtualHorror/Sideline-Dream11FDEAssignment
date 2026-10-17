/**
 * The one global ticker (PLAN Task 5): every 100 ms of wall time, every session releases what its
 * stadium clock has reached. One loop for all sessions keeps the cost flat in the number of fans.
 *
 * Called by src/index.ts at boot; returns the function that stops it (graceful shutdown). Tests do
 * not start it: they call `manager.tick()` themselves with an injected clock.
 */
import type { SessionManager } from "./manager.ts";

export const TICK_MS = 100;

export function startTicker(
  manager: Pick<SessionManager, "tick">,
  intervalMs = TICK_MS,
): () => void {
  const timer = setInterval(() => manager.tick(), intervalMs);
  return () => clearInterval(timer);
}
