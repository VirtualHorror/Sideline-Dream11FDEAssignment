import { foldEvents, type Moment, type StreamMessage, situationOf } from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { initialStreamState, reduceStream, type StreamState } from "../src/stream/store.ts";
import { foldToTv, releasedCount } from "../src/stream/tvClock.ts";
import { crowd, delivery, events, MATCH_ID, persona, summary } from "./helpers/match.ts";

const WALL = Date.UTC(2026, 9, 17, 12, 0, 0);
// DOMAIN §4: late-from-work opens the app after 14 overs of the chase, on a feed 15 s behind.
const join = delivery(2, "13.6");
const ball = delivery(2, "18.6");

// What the keyless server sent for 18.6 in the step 6.0 live run (a labelled template, not AI).
const teaser: Moment = {
  id: "moment-18.6",
  key: `nudge:${MATCH_ID}:${ball.id}`,
  kind: "spoiler_nudge",
  phase: "climax",
  createdAt: ball.t,
  revealAt: ball.t,
  nudgeAt: ball.t - 6000,
  provenance: "fallback",
  traceId: "trace-18.6",
  scope: "shared",
  payload: {
    eventId: ball.id,
    nudge: "India need 22 off 7. Kohli (68 off 49) faces Rauf.",
    reveal: "18.6 Rauf to Kohli, six. India 144/4, need 16 off 6",
    leverage: 0.4100038502113644,
    budgetMs: 1177,
    usedMs: 0,
  },
};

let seq = 0;
const msg = (type: StreamMessage["type"], data: unknown) =>
  ({ v: 1, seq: ++seq, type, data }) as StreamMessage;
const hello = () =>
  msg("hello", {
    sessionId: "session-1",
    match: summary,
    persona: persona("late-from-work"),
    aiMode: "replay",
  });
const snapshot = (at: number, moments: Moment[] = [], delayMs = 15_000) =>
  msg("snapshot", {
    clock: { stadiumT: at, speed: 1, playing: true, delayMs, wallAt: WALL },
    events: events.filter((e) => e.t <= at),
    moments,
    chat: crowd.filter((m) => m.t <= at),
  });

const feed = (messages: StreamMessage[], from: StreamState = initialStreamState()) =>
  messages.reduce((state, message) => reduceStream(state, { type: "message", message }), from);

const scoreOnTv = (state: StreamState, tvT: number) =>
  situationOf(foldToTv(MATCH_ID, state.events, tvT))?.score;

describe("stream store and TV clock (PLAN 6.1)", () => {
  it("folds the TV state to exactly the events the fan's TV has reached", () => {
    const after = events.filter((e) => e.seq > join.seq).slice(0, 6);
    const state = feed([
      hello(),
      snapshot(join.t),
      msg("events", { events: after }),
      msg("moment", { moment: teaser }),
      msg("clock", {
        clock: { stadiumT: join.t + 5_000, speed: 8, playing: true, delayMs: 15_000, wallAt: WALL },
      }),
    ]);
    expect(state.events).toEqual(events.filter((e) => e.seq <= (after.at(-1)?.seq ?? -1)));
    expect(state.clock?.speed).toBe(8);
    expect(state.moments.map((m) => m.id)).toEqual(["moment-18.6"]);

    // The stadium is at 13.6 but a 15 s feed still shows 13.5: 89/4, then 90/4 (F05 audit).
    expect(scoreOnTv(state, join.t - 15_000)).toBe("89/4");
    expect(scoreOnTv(state, join.t)).toBe("90/4");
    for (const tvT of [join.t - 15_000, join.t, ...after.map((e) => e.t), (after[2]?.t ?? 0) + 1]) {
      expect(foldToTv(MATCH_ID, state.events, tvT)).toEqual(
        foldEvents(
          MATCH_ID,
          events.filter((e) => e.t <= tvT),
        ),
      );
    }
  });

  it("replaces events, moments and chat on a new snapshot, with nothing from the future (Review focus 1)", () => {
    const played = feed([
      hello(),
      snapshot(join.t),
      msg("events", { events: events.filter((e) => e.seq > join.seq && e.t <= ball.t) }),
      msg("moment", { moment: teaser }),
    ]);
    expect(played.events.at(-1)?.id).toBe(ball.id);

    const tenOvers = delivery(2, "9.6");
    const back = feed([snapshot(tenOvers.t)], played);
    expect(back.events).toEqual(events.filter((e) => e.t <= tenOvers.t));
    expect(back.moments).toEqual([]);
    expect(back.chat).toEqual(crowd.filter((m) => m.t <= tenOvers.t));
    expect(back.epoch).toBe(played.epoch + 1);
    const tv = foldToTv(MATCH_ID, back.events, ball.t);
    expect(tv.lastSeq).toBe(tenOvers.seq);
  });

  it("keeps one card when the ask response and the stream deliver the same moment", () => {
    const answer: Moment = {
      id: "answer-1",
      key: `explain:${MATCH_ID}:253:casual:94b0d23a`,
      kind: "explainer",
      phase: "any",
      createdAt: join.t,
      revealAt: null,
      nudgeAt: null,
      provenance: "deterministic",
      traceId: null,
      scope: "session",
      payload: {
        question: "what is a free hit?",
        lens: "casual",
        answer: "The delivery after a no-ball.",
        source: "glossary",
        relatedTerms: ["no-ball"],
      },
    };
    let state = feed([hello(), snapshot(join.t)]);
    state = reduceStream(state, { type: "moment", moment: answer });
    state = feed([msg("moment", { moment: answer })], state);
    expect(state.moments.map((m) => m.id)).toEqual(["answer-1"]);
  });

  it("ignores events and chat lines it already holds", () => {
    const next = events.filter((e) => e.seq > join.seq).slice(0, 2);
    const lines = crowd.filter((m) => m.t > join.t).slice(0, 2);
    const state = feed([
      hello(),
      snapshot(join.t),
      msg("events", { events: next }),
      msg("events", { events: next }),
      msg("chat", { messages: lines }),
      msg("chat", { messages: lines }),
    ]);
    expect(state.events.slice(-3).map((e) => e.seq)).toEqual([
      join.seq,
      next[0]?.seq,
      next[1]?.seq,
    ]);
    expect(state.chat.length).toBe(crowd.filter((m) => m.t <= join.t).length + 2);
  });

  it("records a stopped session, and a reconnect's hello clears it until the error repeats", () => {
    const failed = feed([
      hello(),
      snapshot(join.t),
      msg("error", { code: "session_failed", message: "This session hit an internal error." }),
    ]);
    expect(failed.failure?.code).toBe("session_failed");
    expect(feed([hello()], failed).failure).toBeNull();
  });

  it("counts released items by time with a binary search, ties included", () => {
    const items = [{ t: 10 }, { t: 20 }, { t: 20 }, { t: 30 }];
    expect([5, 10, 19, 20, 29, 30, 99].map((tvT) => releasedCount(items, tvT))).toEqual([
      0, 1, 1, 3, 3, 4, 4,
    ]);
  });
});

describe("the AI mode on the TV's chip follows the stream (D-071)", () => {
  const telemetry = (aiMode?: string) =>
    msg("telemetry", {
      telemetry: {
        scope: "session",
        counters: {
          eventsTotal: 0,
          eventsDeterministic: 0,
          gateTriggers: 0,
          aiCallsLive: 1,
          aiCacheHits: 0,
          aiFallbacks: 1,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        },
        latencyMs: { p50: 0, p95: 0 },
        recentDecisions: [],
        recentCalls: [],
        projection: {
          concurrentViewers: 1,
          eventsPerMatch: 0,
          naiveLlmCalls: 0,
          sidelineLlmCalls: 0,
          savedPct: 0,
          formula: "",
        },
      },
      ...(aiMode ? { aiMode } : {}),
    });
  const live = () =>
    msg("hello", {
      sessionId: "session-1",
      match: summary,
      persona: persona("late-from-work"),
      aiMode: "live",
    });

  it("a telemetry message saying replay replaces the hello's live", () => {
    const state = feed([live(), telemetry("replay")]);
    expect(state.session?.aiMode).toBe("replay");
    expect(feed([telemetry("live")], state).session?.aiMode).toBe("live");
  });

  it("a telemetry message without a mode leaves it as it was", () => {
    expect(feed([live(), telemetry()]).session?.aiMode).toBe("live");
  });
});

describe("the fan's own chat lines (Task 9, D-073)", () => {
  it("are kept in time order among the crowd's, once, whether they come over the stream or the POST", () => {
    const at = join.t;
    const state = feed([hello(), snapshot(at)]);
    // The fan typed on their TV's clock, 15 s behind the ground: earlier than the crowd's last lines.
    const own = {
      id: "you-1",
      t: at - 15_000,
      handle: "You",
      affinity: "neutral" as const,
      text: "Come on",
      lang: "en" as const,
      stance: null,
      synthetic: false,
      fromYou: true,
    };
    const posted = reduceStream(state, { type: "chat", messages: [own] });
    expect(posted.chat).toHaveLength(state.chat.length + 1);
    const streamed = feed([msg("chat", { messages: [own] })], posted);
    expect(streamed.chat).toHaveLength(state.chat.length + 1);
    const times = streamed.chat.map((m) => m.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // Crowd lines from the last 15 s come after it.
    const index = streamed.chat.findIndex((m) => m.id === "you-1");
    expect(streamed.chat.slice(index + 1).length).toBe(
      crowd.filter((m) => m.t > own.t && m.t <= at).length,
    );
  });
});
