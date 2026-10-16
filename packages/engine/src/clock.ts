/**
 * Stadium and TV clocks: where the match is now, and what a fan's delayed stream shows.
 *
 * Callers: the server session's tick loop (which events are due, Task 5) and the web client's
 * render loop (what the TV pane may show, Task 6). Both extrapolate from the same `ClockState`
 * snapshot, so they agree on the match time without exchanging a message per frame. Wall time is
 * passed in (Constraint 6): the engine never reads a clock itself.
 */
import type { ClockState } from "./contracts/session.ts";

/**
 * Stadium time at wall time `nowWall`: `stadiumT + (nowWall − wallAt)·speed` while playing,
 * `stadiumT` while paused. Elapsed wall time is floored at 0 because the browser's clock can trail
 * the server's that stamped `wallAt`; without the floor the match would briefly run backwards.
 */
export function stadiumAt(clock: ClockState, nowWall: number): number {
  if (!clock.playing) return clock.stadiumT;
  return clock.stadiumT + Math.max(0, nowWall - clock.wallAt) * clock.speed;
}

/** What the fan's TV shows: stadium time minus their stream delay, never before coverage starts. */
export function tvTimeAt(clock: ClockState, nowWall: number): number {
  return Math.max(0, stadiumAt(clock, nowWall) - clock.delayMs);
}
