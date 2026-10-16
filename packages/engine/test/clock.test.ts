import { describe, expect, it } from "vitest";
import { type ClockState, stadiumAt, tvTimeAt } from "../src/index.ts";

/** A clock snapshot taken at wall time 1_000_000 ms, 60 s into the match, on a 25 s OTT delay. */
const snapshot = (overrides: Partial<ClockState> = {}): ClockState => ({
  stadiumT: 60_000,
  speed: 4,
  playing: true,
  delayMs: 25_000,
  wallAt: 1_000_000,
  ...overrides,
});

describe("stadium clock", () => {
  it("advances stadium time by wall time times speed while playing", () => {
    // 2 s of wall time at 4x is 8 s of match time.
    expect(stadiumAt(snapshot(), 1_002_000)).toBe(68_000);
    expect(stadiumAt(snapshot({ speed: 32 }), 1_000_500)).toBe(76_000);
    expect(stadiumAt(snapshot(), 1_000_000)).toBe(60_000);
  });

  it("holds stadium time while paused", () => {
    const paused = snapshot({ playing: false });
    expect(stadiumAt(paused, 1_000_000)).toBe(60_000);
    expect(stadiumAt(paused, 1_090_000)).toBe(60_000);
  });

  // A browser's wall clock can trail the server's: time must not run backwards before the snapshot.
  it("never runs backwards when the wall clock reads earlier than the snapshot", () => {
    expect(stadiumAt(snapshot(), 999_000)).toBe(60_000);
  });
});

describe("TV clock (stadium time minus the fan's delay)", () => {
  it("lags the stadium by the delay", () => {
    expect(tvTimeAt(snapshot(), 1_002_000)).toBe(43_000);
    expect(tvTimeAt(snapshot({ delayMs: 0 }), 1_002_000)).toBe(68_000);
  });

  it("is never negative at the start of coverage", () => {
    expect(tvTimeAt(snapshot({ stadiumT: 0, playing: false }), 1_000_000)).toBe(0);
    expect(tvTimeAt(snapshot({ stadiumT: 10_000, speed: 1 }), 1_005_000)).toBe(0);
    expect(tvTimeAt(snapshot({ stadiumT: 10_000, speed: 1 }), 1_016_000)).toBe(1_000);
  });
});
