import type { ClockState } from "@sideline/engine";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTvTime, useTvView } from "../src/stream/tvClock.ts";
import { delivery, events, MATCH_ID } from "./helpers/match.ts";

const WALL = Date.UTC(2026, 9, 17, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ now: WALL });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useTvTime (PLAN 6.1, injected clock)", () => {
  it("runs the TV clock at the session's speed, behind the stadium by the delay", () => {
    const clock: ClockState = {
      stadiumT: 1_000_000,
      speed: 8,
      playing: true,
      delayMs: 25_000,
      wallAt: WALL,
    };
    const { result } = renderHook(() => useTvTime(clock));
    expect(result.current).toBe(975_000);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // One wall second at 8x is eight stadium seconds.
    expect(result.current).toBe(983_000);
  });

  it("holds still while paused", () => {
    const clock: ClockState = {
      stadiumT: 1_000_000,
      speed: 8,
      playing: false,
      delayMs: 25_000,
      wallAt: WALL,
    };
    const { result } = renderHook(() => useTvTime(clock));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(975_000);
  });
});

describe("useTvView", () => {
  it("shows a ball only once the TV clock passes it", () => {
    const ball = delivery(2, "18.6");
    // The stadium is two seconds past 18.6; a 25 s feed at 1x shows it 23 s later.
    const clock: ClockState = {
      stadiumT: ball.t + 2_000,
      speed: 1,
      playing: true,
      delayMs: 25_000,
      wallAt: WALL,
    };
    const held = events.filter((e) => e.t <= clock.stadiumT);
    const { result } = renderHook(() => useTvView(MATCH_ID, clock, held));
    expect(result.current.state.lastSeq).toBeLessThan(ball.seq);
    act(() => {
      vi.advanceTimersByTime(22_900);
    });
    expect(result.current.state.lastSeq).toBeLessThan(ball.seq);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.state.lastSeq).toBe(ball.seq);
  });
});
