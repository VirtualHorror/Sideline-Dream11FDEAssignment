/**
 * The fan's TV clock in the browser: what their delayed picture shows right now (Flow §9).
 *
 * Callers: the match room derives the TV view once per render (`useTvView`) and shares it through
 * `TvContext`; components read it with `useTvState()`. The server streams everything at stadium
 * time; only events with `t ≤ tvT` fold into the state the TV pane and the companion show, chat
 * is released the same way, and moment cards ask `momentVisibility` (engine buffer/delay.ts). So a
 * fan on a 25-second stream never sees a wicket, a chat "OUT!" or a reveal before their picture.
 *
 * Time is re-read on an interval (100 ms) rather than every animation frame: the state changes only
 * when the TV passes an event, a chat line or a card's teaser and reveal times, which are seconds
 * apart in stadium time even at 32x. The effects run their own frame loops.
 */
import {
  type ClockState,
  foldEvents,
  type MatchEvent,
  type MatchState,
  tvTimeAt,
} from "@sideline/engine";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

/** How many `items` the TV has reached (`t ≤ tvT`); `items` are in time order (ties allowed). */
export function releasedCount(items: readonly { t: number }[], tvT: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((items[mid]?.t ?? Number.POSITIVE_INFINITY) <= tvT) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The match as the TV shows it at `tvT`: the stream's events up to that time, folded. */
export function foldToTv(matchId: string, events: readonly MatchEvent[], tvT: number): MatchState {
  const last = events[releasedCount(events, tvT) - 1];
  return foldEvents(matchId, events, last ? last.seq : -1);
}

/** TV time from the session clock, re-read every `intervalMs` while the clock plays. */
export function useTvTime(clock: ClockState | null, intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!clock?.playing) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, intervalMs);
    // Hidden tabs get throttled timers: catch up at once when the fan comes back.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [clock, intervalMs]);
  return clock ? tvTimeAt(clock, now) : 0;
}

export interface TvView {
  tvT: number;
  /** The match folded only to `tvT`. */
  state: MatchState;
  /** How many stream events the TV has shown. */
  released: number;
}

/** The TV view of a stream: its clock's TV time and the events folded to it. */
export function useTvView(
  matchId: string,
  clock: ClockState | null,
  events: readonly MatchEvent[],
): TvView {
  const tvT = useTvTime(clock);
  const released = releasedCount(events, tvT);
  const state = useMemo(
    () => foldEvents(matchId, events, events[released - 1]?.seq ?? -1),
    [matchId, events, released],
  );
  return { tvT, state, released };
}

export const TvContext = createContext<TvView | null>(null);

/** `{ tvT, state }` of the match room's TV (PLAN Task 6 interface). */
export function useTvState(): TvView {
  const view = useContext(TvContext);
  if (!view) throw new Error("useTvState needs the match room's TvContext");
  return view;
}
