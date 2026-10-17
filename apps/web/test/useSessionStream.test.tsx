import type { StreamMessage } from "@sideline/engine";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type EventSourceLike, useSessionStream } from "../src/stream/useSessionStream.ts";
import { crowd, delivery, events, persona, summary } from "./helpers/match.ts";

/** Stands in for the browser's EventSource (the network edge): the test plays the server. */
class FakeEventSource implements EventSourceLike {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  closed = false;
  private listeners = new Map<string, ((event: Event) => void)[]>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    for (const listener of this.listeners.get("open") ?? []) listener(new Event("open"));
  }
  send(message: StreamMessage | Record<string, unknown>, type = String(message.type)) {
    const event = new MessageEvent(type, { data: JSON.stringify(message) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  /** The browser's own connection error: a plain Event, no data. */
  drop(readyState: number) {
    this.readyState = readyState;
    for (const listener of this.listeners.get("error") ?? []) listener(new Event("error"));
  }
}

afterEach(cleanup);

const join = delivery(2, "13.6");
const hello: StreamMessage = {
  v: 1,
  seq: 1,
  type: "hello",
  data: { sessionId: "s-1", match: summary, persona: persona("late-from-work"), aiMode: "replay" },
};
const snapshot: StreamMessage = {
  v: 1,
  seq: 2,
  type: "snapshot",
  data: {
    clock: { stadiumT: join.t, speed: 1, playing: true, delayMs: 15_000, wallAt: 1 },
    events: events.filter((e) => e.t <= join.t),
    moments: [],
    chat: crowd.filter((m) => m.t <= join.t),
  },
};

function setup() {
  let source: FakeEventSource | null = null;
  const hook = renderHook(() =>
    useSessionStream("s-1", (url) => {
      source = new FakeEventSource(url);
      return source;
    }),
  );
  if (!source) throw new Error("no EventSource opened");
  return { hook, source: source as FakeEventSource };
}

describe("useSessionStream", () => {
  it("opens the session's stream and folds validated messages into the store", () => {
    const { hook, source } = setup();
    expect(source.url).toBe("/api/sessions/s-1/stream");
    expect(hook.result.current.state.connection).toBe("connecting");
    act(() => {
      source.open();
      source.send(hello);
      source.send(snapshot);
    });
    expect(hook.result.current.state.connection).toBe("open");
    expect(hook.result.current.state.session?.persona.id).toBe("late-from-work");
    expect(hook.result.current.state.events.at(-1)?.id).toBe(join.id);
  });

  it("drops a message that fails the stream schema instead of trusting it", () => {
    const { hook, source } = setup();
    act(() => {
      source.send(hello);
      source.send(snapshot);
      source.send({ v: 1, seq: 3, type: "clock", data: { clock: { speed: 3 } } });
    });
    expect(hook.result.current.state.clock?.speed).toBe(1);
  });

  it("tells the server's session_failed apart from the browser's own connection errors", () => {
    const { hook, source } = setup();
    act(() => {
      source.open();
      source.send(hello);
      source.send({
        v: 1,
        seq: 2,
        type: "error",
        data: { code: "session_failed", message: "paused" },
      });
    });
    expect(hook.result.current.state.failure?.code).toBe("session_failed");
    expect(hook.result.current.state.connection).toBe("open");
    act(() => source.drop(FakeEventSource.CONNECTING));
    expect(hook.result.current.state.connection).toBe("reconnecting");
    act(() => source.drop(FakeEventSource.CLOSED));
    expect(hook.result.current.state.connection).toBe("closed");
  });

  it("closes the stream when the room unmounts", () => {
    const { hook, source } = setup();
    hook.unmount();
    expect(source.closed).toBe(true);
  });
});
