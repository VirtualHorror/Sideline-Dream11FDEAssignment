/**
 * Opens a session's Server-Sent Events stream and feeds it into a stream store (Flow §7, §9).
 *
 * Callers: pages/MatchRoom.tsx, once it has a session id from POST /api/sessions. Every frame is
 * parsed and validated with the engine's `StreamMessageSchema` before it reaches the store; a frame
 * that fails is dropped with a warning rather than trusted. EventSource reconnects by itself, and
 * every connection starts with `hello` and a full `snapshot`, so the store resynchronises without
 * help from here.
 *
 * One trap: the server's `event: error` (session_failed) shares its name with EventSource's own
 * connection error. A server frame is a MessageEvent with string data; the browser's is a bare Event.
 */
import { StreamMessageSchema, type StreamMessageType } from "@sideline/engine";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createStreamStore, type StreamState, type StreamStore } from "./store.ts";

/** The part of the browser's EventSource this hook uses (tests pass a stand-in). */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

const MESSAGE_TYPES: readonly StreamMessageType[] = [
  "hello",
  "snapshot",
  "events",
  "moment",
  "chat",
  "clock",
  "telemetry",
  "error",
];
/** EventSource.CLOSED: the browser gave up (e.g. the session is gone and the stream answered 404). */
const CLOSED = 2;

const browserEventSource = (url: string): EventSourceLike => new EventSource(url);

export function useSessionStream(
  sessionId: string | null,
  connect: (url: string) => EventSourceLike = browserEventSource,
): { store: StreamStore; state: StreamState } {
  // biome-ignore lint/correctness/useExhaustiveDependencies: one fresh store per session id
  const store = useMemo(() => createStreamStore(), [sessionId]);
  // Read through a ref so a caller's inline function does not reopen the stream on every render.
  const connectRef = useRef(connect);
  connectRef.current = connect;

  useEffect(() => {
    if (!sessionId) return;
    store.dispatch({ type: "connection", connection: "connecting" });
    const source = connectRef.current(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
    source.addEventListener("open", () =>
      store.dispatch({ type: "connection", connection: "open" }),
    );
    const onFrame = (event: Event) => {
      if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
        store.dispatch({
          type: "connection",
          connection: source.readyState === CLOSED ? "closed" : "reconnecting",
        });
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.warn("[sideline] dropped a stream frame that is not JSON");
        return;
      }
      const parsed = StreamMessageSchema.safeParse(data);
      if (!parsed.success) {
        console.warn("[sideline] dropped an invalid stream message", parsed.error.issues[0]);
        return;
      }
      store.dispatch({ type: "message", message: parsed.data });
    };
    for (const type of MESSAGE_TYPES) source.addEventListener(type, onFrame);
    return () => source.close();
  }, [sessionId, store]);

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { store, state };
}
