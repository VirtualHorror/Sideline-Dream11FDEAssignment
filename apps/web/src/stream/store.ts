/**
 * The session stream store: everything the server has sent this fan, stamped in stadium time.
 *
 * Callers: stream/useSessionStream.ts dispatches every validated StreamMessage (and the fan's own
 * answers from POST /ask); the match room reads the state through `useSyncExternalStore`. Nothing
 * here decides what the fan may see: the server pushes at stadium time and the TV clock
 * (stream/tvClock.ts) holds everything back to the fan's delayed picture (Flow §9).
 *
 * Review focus 1: a `snapshot` (every connect, every seek and jump) replaces the clock, events,
 * moments and chat outright; it is never merged, so a jump back cannot leave the future behind.
 * Incremental messages are idempotent: an event or chat line already held is skipped, and a moment
 * is upserted by id, because an answer arrives both in the POST response and on the stream. The fan's
 * own chat lines (Task 9) are stamped on their TV clock, earlier than the crowd's latest, so chat
 * lines are merged in time order rather than appended.
 */
import type {
  AiMode,
  ChatMessage,
  ClockState,
  MatchEvent,
  MatchSummary,
  Moment,
  Persona,
  StreamMessage,
  TelemetrySnapshot,
} from "@sideline/engine";

export type Connection = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface StreamState {
  session: { sessionId: string; match: MatchSummary; persona: Persona; aiMode: AiMode } | null;
  clock: ClockState | null;
  /** Stadium timeline from coverage start, in time order (snapshots always start at seq 0). */
  events: MatchEvent[];
  moments: Moment[];
  /** The simulated crowd (and, from Task 9, the fan's own lines), in time order. */
  chat: ChatMessage[];
  telemetry: TelemetrySnapshot | null;
  connection: Connection;
  /** Set when the server stopped this session (`error: session_failed`); a reconnect repeats it. */
  failure: { code: string; message: string } | null;
  /** Bumped by every snapshot: folds and the outburst watcher start again from it. */
  epoch: number;
}

export type StreamAction =
  | { type: "message"; message: StreamMessage }
  | { type: "connection"; connection: Connection }
  /** A moment from a REST answer (POST /ask) rather than the stream. */
  | { type: "moment"; moment: Moment }
  /** The clock a control request answered with; the stream's own `clock` message follows. */
  | { type: "clock"; clock: ClockState }
  /** The fan's own chat line from a REST answer (POST /chat); the stream sends it too. */
  | { type: "chat"; messages: ChatMessage[] };

export function initialStreamState(): StreamState {
  return {
    session: null,
    clock: null,
    events: [],
    moments: [],
    chat: [],
    telemetry: null,
    connection: "idle",
    failure: null,
    epoch: 0,
  };
}

function upsertMoment(moments: Moment[], moment: Moment): Moment[] {
  const index = moments.findIndex((m) => m.id === moment.id);
  if (index === -1) return [...moments, moment];
  const next = [...moments];
  next[index] = moment;
  return next;
}

/** Adds the lines not already held, keeping the list in time order (stable for equal times). */
function mergeChat(chat: ChatMessage[], messages: readonly ChatMessage[]): ChatMessage[] {
  const held = new Set(chat.map((m) => m.id));
  const fresh = messages.filter((m) => !held.has(m.id));
  if (fresh.length === 0) return chat;
  const last = chat.at(-1)?.t ?? Number.NEGATIVE_INFINITY;
  // The crowd arrives in order: the common case appends without sorting.
  if (fresh.every((m, i) => m.t >= (i === 0 ? last : (fresh[i - 1]?.t ?? last)))) {
    return [...chat, ...fresh];
  }
  return [...chat, ...fresh].sort((a, b) => a.t - b.t);
}

function apply(state: StreamState, message: StreamMessage): StreamState {
  switch (message.type) {
    case "hello":
      // Every connection starts here; a session still stopped says so again after its snapshot.
      return { ...state, session: message.data, failure: null };
    case "snapshot":
      return {
        ...state,
        clock: message.data.clock,
        events: message.data.events,
        moments: message.data.moments.reduce(upsertMoment, [] as Moment[]),
        chat: message.data.chat,
        epoch: state.epoch + 1,
      };
    case "events": {
      const lastSeq = state.events.at(-1)?.seq ?? -1;
      const fresh = message.data.events.filter((e) => e.seq > lastSeq);
      return fresh.length === 0 ? state : { ...state, events: [...state.events, ...fresh] };
    }
    case "chat": {
      const chat = mergeChat(state.chat, message.data.messages);
      return chat === state.chat ? state : { ...state, chat };
    }
    case "moment":
      return { ...state, moments: upsertMoment(state.moments, message.data.moment) };
    case "clock":
      return { ...state, clock: message.data.clock };
    case "telemetry": {
      // The mode can change mid-session (a key that starts failing): the chip follows it (D-071).
      const { aiMode } = message.data;
      const session =
        state.session && aiMode && aiMode !== state.session.aiMode
          ? { ...state.session, aiMode }
          : state.session;
      return { ...state, telemetry: message.data.telemetry, session };
    }
    case "error":
      return { ...state, failure: message.data };
  }
}

export function reduceStream(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "message":
      return apply(state, action.message);
    case "connection":
      return action.connection === state.connection
        ? state
        : { ...state, connection: action.connection };
    case "moment":
      return { ...state, moments: upsertMoment(state.moments, action.moment) };
    case "clock":
      return { ...state, clock: action.clock };
    case "chat": {
      const chat = mergeChat(state.chat, action.messages);
      return chat === state.chat ? state : { ...state, chat };
    }
  }
}

export interface StreamStore {
  getState(): StreamState;
  dispatch(action: StreamAction): void;
  subscribe(listener: () => void): () => void;
}

/** A tiny external store for `useSyncExternalStore`: one per match-room session. */
export function createStreamStore(initial: StreamState = initialStreamState()): StreamStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceStream(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
