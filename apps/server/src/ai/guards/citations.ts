/**
 * Grounding guard for the catch-up reel: every slide may cite only deliveries inside the missed
 * window, and the reel must end on something to watch next (PLAN Task 5).
 *
 * Callers: skills/catchUp.ts (its guard). The window's delivery ids come from the engine's
 * `buildCatchUpFacts`, so a model that invents or misremembers an event id fails here and the reel
 * falls back to the labelled template built from the same facts.
 */
import type { GuardResult } from "../skills/types.ts";

export function citationsGuard(
  slides: readonly { kind: string; citedEventIds: readonly string[] }[],
  windowIds: readonly string[],
): GuardResult {
  const allowed = new Set(windowIds);
  for (const [index, slide] of slides.entries()) {
    const stray = slide.citedEventIds.find((id) => !allowed.has(id));
    if (stray !== undefined) {
      return { ok: false, reason: `slide ${index + 1} cites ${stray}, outside the missed window` };
    }
  }
  if (!slides.some((slide) => slide.kind === "watch_next")) {
    return { ok: false, reason: "no watch_next slide" };
  }
  return { ok: true };
}
