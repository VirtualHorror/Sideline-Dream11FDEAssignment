import {
  type ClockState,
  fantasyPoints,
  type Moment,
  type StreamMessage,
  squadPoints,
} from "@sideline/engine";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { foldToTv } from "../src/stream/tvClock.ts";
import {
  crowd,
  delivery,
  events,
  MATCH_ID,
  persona,
  personas,
  players,
  rules,
  summary,
  winprob,
} from "./helpers/match.ts";

/** The server's side of the stream for one session (EventSource is the network edge). */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly url: string;
  readyState = 0;
  private listeners = new Map<string, ((event: Event) => void)[]>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.readyState = 2;
  }
  send(message: StreamMessage) {
    const event = new MessageEvent(message.type, { data: JSON.stringify(message) });
    for (const listener of this.listeners.get(message.type) ?? []) listener(event);
  }
}

const ball = delivery(2, "18.6");
const DELAY = 25_000;
const [, india] = summary.teams;

const teaser: Moment = {
  id: "moment-18.6",
  key: `nudge:${MATCH_ID}:${ball.id}`,
  kind: "spoiler_nudge",
  phase: "climax",
  createdAt: ball.t,
  revealAt: ball.t,
  nudgeAt: ball.t - 6000,
  provenance: "fallback",
  traceId: null,
  scope: "shared",
  payload: {
    eventId: ball.id,
    nudge: "India need 22 off 7. Kohli (68 off 49) faces Rauf.",
    reveal: "18.6 Rauf to Kohli, six. India 144/4, need 16 off 6",
    leverage: 0.41,
    budgetMs: 1177,
    usedMs: 0,
  },
};

/** A paused clock pins the TV time exactly: stadium time minus the delay. */
const pausedAt = (stadiumT: number): ClockState => ({
  stadiumT,
  speed: 16,
  playing: false,
  delayMs: DELAY,
  wallAt: 1,
});

let seq = 0;
const message = (type: StreamMessage["type"], data: unknown) =>
  ({ v: 1, seq: ++seq, type, data }) as StreamMessage;

function serve() {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/matches/${MATCH_ID}`) {
        return json({ match: summary, players, rules, winprob });
      }
      if (url === "/api/matches") {
        const choices = personas.map(({ id, label, blurb, lens, delayMs }) => ({
          id,
          label,
          blurb,
          lens,
          delayMs,
        }));
        return json({ matches: [{ ...summary, personas: choices }] });
      }
      if (url === "/api/sessions" && init?.method === "POST") {
        return json({ sessionId: "s-1", streamUrl: "/api/sessions/s-1/stream" }, 201);
      }
      return json({ error: { code: "not_found", message: url } }, 404);
    }),
  );
  vi.stubGlobal("EventSource", FakeEventSource);
}

async function openRoom() {
  window.history.pushState(null, "", `/match/${MATCH_ID}?persona=babar-believer`);
  render(<App />);
  // The room is loaded on demand (App.tsx, Task 9.5): its chunk can take a while on a busy runner.
  await waitFor(() => expect(FakeEventSource.last?.url).toBe("/api/sessions/s-1/stream"), {
    timeout: 10_000,
  });
  return FakeEventSource.last as FakeEventSource;
}

const streamTo = (source: FakeEventSource, stadiumT: number, moments: Moment[]) =>
  act(() => {
    source.send(
      message("hello", {
        sessionId: "s-1",
        match: summary,
        persona: persona("babar-believer"),
        aiMode: "replay",
      }),
    );
    source.send(
      message("snapshot", {
        clock: pausedAt(stadiumT),
        events: events.filter((e) => e.t <= Math.min(stadiumT, ball.t)),
        moments,
        chat: crowd.filter((m) => m.t <= stadiumT),
      }),
    );
  });

const glow = () => document.querySelector('.tv [data-effect="floodlight"]');
const card = () => document.querySelector('[data-kind="spoiler_nudge"]');

beforeEach(() => {
  FakeEventSource.last = null;
  serve();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState(null, "", "/");
});

describe("the match room on the fan's TV clock", () => {
  it("holds the big ball, teases it, then reveals it with the outburst on the TV", async () => {
    const source = await openRoom();
    // The ground has just seen 18.6; a 25 s feed is 24 s short of it.
    streamTo(source, ball.t + 1_000, [teaser]);
    await waitFor(() => expect(card()?.getAttribute("data-visibility")).toBe("hidden"));
    // (18.5 was also a six off Rauf, so its commentary line is rightly on screen.)
    expect(document.body.innerHTML).not.toContain("18.6 Rauf to Kohli");
    expect(document.body.innerHTML).not.toContain("144/4");
    expect(screen.getByText("Held for your TV")).toBeTruthy();
    expect(glow()?.getAttribute("data-burst")).toBeNull();

    act(() => source.send(message("clock", { clock: pausedAt(ball.t + 20_000) })));
    await waitFor(() => expect(card()?.getAttribute("data-visibility")).toBe("teaser"));
    expect(document.body.innerHTML).not.toContain("18.6 Rauf to Kohli");
    expect(document.body.innerHTML).not.toContain("144/4");

    act(() => source.send(message("clock", { clock: pausedAt(ball.t + DELAY + 500) })));
    await waitFor(() => expect(card()?.getAttribute("data-visibility")).toBe("revealed"));
    expect(card()?.textContent).toContain("18.6 Rauf to Kohli, six. India 144/4, need 16 off 6");
    // The six was revealed on the TV during play: gold mixed with the batting side's colour.
    expect(glow()?.getAttribute("data-burst")).toBe(
      `color-mix(in oklab, var(--six) 62%, ${india?.color})`,
    );
    const headline = document.querySelector(".tv__reveal");
    expect(headline?.textContent).toContain("Six");
    expect(headline?.textContent).toContain("18.6 Rauf to Kohli, six");
  });

  it("lights nothing for a ball that was already on the TV when the snapshot came (a seek is not a moment)", async () => {
    const source = await openRoom();
    streamTo(source, ball.t + DELAY + 5_000, [teaser]);
    await waitFor(() => expect(card()?.getAttribute("data-visibility")).toBe("revealed"));
    expect(glow()?.getAttribute("data-burst")).toBeNull();
    expect(document.querySelector(".tv__reveal")).toBeNull();
  });

  it("puts the fan's squad impact beside the reel from their TV state, not the ground's", async () => {
    const source = await openRoom();
    const squad = persona("babar-believer").squad;
    if (!squad) throw new Error("babar-believer has a squad");
    const totalAt = (t: number) =>
      squadPoints(fantasyPoints(foldToTv(MATCH_ID, events, t), players, rules), squad, rules).total;
    const stadiumT = ball.t + 20_000;
    // Kohli is in this fan's team: the 18.6 six has happened at the ground but not on their TV.
    expect(totalAt(stadiumT)).toBeGreaterThan(totalAt(stadiumT - DELAY));
    const reel: Moment = {
      id: "reel-1",
      key: `catchup:${MATCH_ID}:2:0-14:casual`,
      kind: "catch_up",
      phase: "mid_match",
      createdAt: delivery(2, "13.6").t,
      revealAt: delivery(2, "13.6").t,
      nudgeAt: null,
      provenance: "fallback",
      traceId: null,
      scope: "shared",
      payload: {
        innings: 2,
        fromLabel: "0.1",
        toLabel: "13.6",
        lens: "casual",
        situation: "India 90/4, need 70 off 36",
        slides: [
          {
            kind: "turning_point",
            headline: "The big moment: 1.5",
            body: "A wicket.",
            citedEventIds: [],
          },
          { kind: "watch_next", headline: "Watch next", body: "The chase.", citedEventIds: [] },
        ],
      },
    };
    streamTo(source, stadiumT, [reel]);
    await waitFor(() => expect(screen.getByText("While you were away")).toBeTruthy());
    const shown = Number(screen.getByText(/points$/).textContent?.match(/[\d.]+/)?.[0]);
    expect(shown).toBe(totalAt(stadiumT - DELAY));
  });
});
