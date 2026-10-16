/**
 * The spoiler shield: holds anything stamped in stadium time until the fan's own TV reaches it.
 *
 * Callers: the web client's stream store (Task 6) releases events, chat and moments with
 * `releaseDue` on every frame, and cards ask `momentVisibility` what they may show. The server
 * pushes everything as soon as it happens at the ground; the delay lives only here, so a fan on a
 * 40-second stream never sees a wicket, a chat "OUT!" or a reveal before their picture does.
 */
import type { Moment } from "../contracts/moments.ts";

/**
 * Splits `items` into those the TV has reached (`t ≤ tvT`) and those still held, each in input
 * order. The input need not be sorted: chat and moments can arrive slightly out of stamp order.
 */
export function releaseDue<T extends { t: number }>(
  items: readonly T[],
  tvT: number,
): { released: T[]; held: T[] } {
  const released: T[] = [];
  const held: T[] = [];
  for (const item of items) (item.t <= tvT ? released : held).push(item);
  return { released, held };
}

/**
 * What a moment card may show at TV time `tvT`: nothing before its teaser time, the spoiler-free
 * teaser from `nudgeAt`, and the outcome from `revealAt`. A null `nudgeAt` means no teaser (the
 * card goes straight from hidden to revealed); a null `revealAt` means show it at once
 * (MomentSchema).
 */
export function momentVisibility(
  moment: Pick<Moment, "revealAt" | "nudgeAt">,
  tvT: number,
): "hidden" | "teaser" | "revealed" {
  if (moment.revealAt === null || tvT >= moment.revealAt) return "revealed";
  if (moment.nudgeAt !== null && tvT >= moment.nudgeAt) return "teaser";
  return "hidden";
}
