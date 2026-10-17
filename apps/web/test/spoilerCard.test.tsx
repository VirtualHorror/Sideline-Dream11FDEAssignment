import type { ClockState, Moment } from "@sideline/engine";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpoilerCard } from "../src/companion/cards/SpoilerCard.tsx";
import { useTvTime } from "../src/stream/tvClock.ts";
import { delivery, MATCH_ID } from "./helpers/match.ts";

const WALL = Date.UTC(2026, 9, 17, 12, 0, 0);
const ball = delivery(2, "18.6");
const NUDGE = "India need 22 off 7. Kohli (68 off 49) faces Rauf.";
const REVEAL = "18.6 Rauf to Kohli, six. India 144/4, need 16 off 6";

type SpoilerMoment = Extract<Moment, { kind: "spoiler_nudge" }>;
const teaser = (nudgeAt: number | null): SpoilerMoment => ({
  id: "moment-18.6",
  key: `nudge:${MATCH_ID}:${ball.id}`,
  kind: "spoiler_nudge",
  phase: "climax",
  createdAt: ball.t,
  revealAt: ball.t,
  nudgeAt,
  provenance: "fallback",
  traceId: "trace-18.6",
  scope: "shared",
  payload: {
    eventId: ball.id,
    nudge: NUDGE,
    reveal: REVEAL,
    leverage: 0.41,
    budgetMs: 1177,
    usedMs: 0,
  },
});

/** The card on a real TV clock: 25 s behind a stadium that has just reached the ball, at 1x. */
function OnTheTv({ moment }: { moment: SpoilerMoment }) {
  const clock: ClockState = {
    stadiumT: ball.t,
    speed: 1,
    playing: true,
    delayMs: 25_000,
    wallAt: WALL,
  };
  const tvT = useTvTime(clock);
  return <SpoilerCard moment={moment} tvT={tvT} delayMs={clock.delayMs} ballLabel="18.6" />;
}

beforeEach(() => {
  vi.useFakeTimers({ now: WALL });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("SpoilerCard (PLAN 6.2)", () => {
  it("is veiled with nothing of the ball in the DOM, then teases, then reveals", () => {
    const { container } = render(<OnTheTv moment={teaser(ball.t - 6_000)} />);
    const card = () => container.querySelector('[data-kind="spoiler_nudge"]');

    // TV at ball − 25 s: held. The veil covers the card and neither text is anywhere in the DOM.
    expect(card()?.getAttribute("data-visibility")).toBe("hidden");
    expect(container.querySelector('[data-effect="veil"]')?.getAttribute("data-intensity")).toBe(
      "1",
    );
    expect(container.innerHTML).not.toContain(NUDGE);
    expect(container.innerHTML).not.toContain(REVEAL);
    expect(container.innerHTML.toLowerCase()).not.toContain("six");
    expect(container.textContent).toContain("Held for your TV");

    // TV at ball − 6 s (the nudge time): the teaser, still no outcome.
    advance(19_000);
    expect(card()?.getAttribute("data-visibility")).toBe("teaser");
    expect(container.textContent).toContain(NUDGE);
    expect(container.innerHTML).not.toContain(REVEAL);

    // TV at the ball: the reveal.
    advance(6_000);
    expect(card()?.getAttribute("data-visibility")).toBe("revealed");
    expect(container.textContent).toContain(REVEAL);
  });

  it("goes straight from held to revealed when the teaser was ready too late", () => {
    const { container } = render(<OnTheTv moment={teaser(null)} />);
    const card = () => container.querySelector('[data-kind="spoiler_nudge"]');
    advance(24_900);
    expect(card()?.getAttribute("data-visibility")).toBe("hidden");
    expect(container.innerHTML).not.toContain(NUDGE);
    advance(200);
    expect(card()?.getAttribute("data-visibility")).toBe("revealed");
    expect(container.textContent).toContain(REVEAL);
    expect(container.textContent).toContain("Ready too late for a teaser");
  });

  it("labels its words: a template stays a fallback, never AI", () => {
    const { container } = render(
      <SpoilerCard moment={teaser(ball.t - 6_000)} tvT={ball.t} delayMs={25_000} />,
    );
    expect(container.textContent).toContain("Fallback: AI unavailable");
    expect(container.textContent).not.toContain("Live AI");
  });
});
