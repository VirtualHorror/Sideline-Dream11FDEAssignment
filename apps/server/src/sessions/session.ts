/**
 * One fan's match session (D-011): their own stadium clock, persona, lens and TV delay over a shared,
 * read-only match bundle, streamed to their browser as StreamMessages.
 *
 * Callers: sessions/manager.ts creates and ticks sessions; the HTTP routes call `control`, `ask` and
 * `connect` (SSE). Per tick, every event the stadium clock has reached is folded into the state and
 * run through this session's entropy gate (Flow §7, §11); triggers with a Task 5 skill (teasers) go
 * to the orchestrator, whose moments come back asynchronously. The server sends everything at
 * stadium time; the browser holds it until its own TV clock gets there (engine buffer/delay.ts).
 *
 * Seeking and jumping (Review focus 1): the state is refolded from the timeline, the chat and the
 * events are cut at the new time, and a fresh snapshot is sent. Skipped events never pass the gate
 * (the fan did not watch them); skipping at least 12 legal balls the fan never saw starts a catch-up.
 * Moments already produced are kept and sent again only once the clock is past their time, so a jump
 * back hides them and a jump forward brings them back, once. The gate keeps its asked-for keys
 * (D-045), so watching a stretch twice costs no second model call.
 */
import {
  type AiMode,
  applyEvent,
  buildCatchUpFacts,
  type ClockState,
  type ControlRequest,
  createGate,
  type DeliveryEvent,
  type Detector,
  type DetectorContext,
  describeDelivery,
  foldEvents,
  type JumpTarget,
  joinSeq,
  type Lens,
  type MatchEvent,
  type Moment,
  type MomentTrigger,
  missedLegalBalls,
  type Persona,
  type StreamMessage,
  seqAfterOvers,
  situationOf,
  stadiumAt,
  tvTimeAt,
} from "@sideline/engine";
import type { MatchBundle } from "../data/bundle.ts";
import { NUDGE_LEAD_MS, type Orchestrator } from "../orchestrator/orchestrator.ts";
import type { Telemetry } from "../telemetry/collector.ts";

/** A fan who missed this many legal balls gets a catch-up reel (PLAN Task 5, Flow §7). */
export const CATCH_UP_MIN_MISSED_BALLS = 12;
/** How often a connected session receives its telemetry snapshot. */
const TELEMETRY_EVERY_MS = 5_000;
/** Commentary lines the explainer sees from the fan's screen. */
const RECENT_LINES = 6;
/** What a stopped session tells its streams (now, and on every reconnect). */
const FAILED = {
  code: "session_failed",
  message: "This session hit an internal error and was paused.",
};

/** A control the session cannot carry out (an unknown jump target): the route answers 400. */
export class ControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlError";
  }
}

export interface SessionDeps {
  bundle: MatchBundle;
  orchestrator: Orchestrator;
  telemetry: Telemetry;
  detectors: readonly Detector[];
  aiMode: () => AiMode;
  /** Wall clock, ms. */
  now: () => number;
  /** The gate's cost clock, µs. */
  nowMicros: () => number;
}

export interface Session {
  readonly id: string;
  readonly matchId: string;
  readonly persona: Persona;
  lens(): Lens;
  clock(): ClockState;
  /** Stadium time now, from the clock. */
  stadiumNow(): number;
  lastActivity(): number;
  listeners(): number;
  failed(): boolean;
  /** Every moment produced so far, oldest first (the stream sends only those already due). */
  moments(): Moment[];
  tick(): void;
  control(request: ControlRequest): ClockState;
  ask(question: string, lens?: Lens): Promise<Moment>;
  /** Subscribes to the stream: the listener first receives `hello` and a `snapshot`. */
  connect(listener: (message: StreamMessage) => void): () => void;
  /** Resolves when the AI work started so far has finished (tests, shutdown). */
  settle(): Promise<void>;
  fail(error: unknown): void;
}

const isDelivery = (event: MatchEvent): event is DeliveryEvent => event.kind === "delivery";

/** How many items have `t <= time` (items are in time order). */
function countUpTo(items: readonly { t: number }[], time: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((items[mid]?.t ?? 0) <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function createSession(
  init: { id: string; persona: Persona; delayMs?: number; lens?: Lens },
  deps: SessionDeps,
): Session {
  const { bundle } = deps;
  const { id, persona } = init;
  const matchId = bundle.summary.id;
  const events = bundle.events;
  const crowd = bundle.crowd;
  const playersById = new Map(bundle.players.map((p) => [p.id, p]));
  const ctx: DetectorContext = {
    matchId,
    players: bundle.players,
    rules: bundle.rules,
    persona,
    winprob: bundle.winprob,
    priors: bundle.priors,
  };
  // The last thing that happens: the match end, or the crowd's last reaction to it.
  const endT = Math.max(events.at(-1)?.t ?? 0, crowd.at(-1)?.t ?? 0);
  const gate = createGate(deps.detectors, { nowMicros: deps.nowMicros });

  const joined = joinSeq(events, persona.joinAt);
  const startT = joined >= 0 ? (events[joined]?.t ?? 0) : 0;
  let state = foldEvents(matchId, events, joined);
  let cursor = joined + 1;
  let chatCursor = countUpTo(crowd, startT);
  let clock: ClockState = {
    stadiumT: startT,
    speed: 1,
    playing: true,
    delayMs: init.delayMs ?? persona.delayMs,
    wallAt: deps.now(),
  };
  let lens: Lens = init.lens ?? persona.lens;
  let maxSeenSeq = joined;
  let activity = deps.now();
  let failedFlag = false;
  let seq = 0;
  let lastTelemetry = deps.now();
  const listeners = new Set<(message: StreamMessage) => void>();
  const produced: Moment[] = [];
  const sent = new Set<string>();
  const pending = new Set<Promise<unknown>>();

  // The stadium clock runs on past the end by the fan's delay, so their TV shows the end too: stopped
  // at `endT`, a TV 25 s behind would never reach the last balls or the result (BUG-004, D-063).
  const finalT = () => endT + clock.delayMs;
  const stadiumNow = () => Math.min(finalT(), stadiumAt(clock, deps.now()));
  const touch = () => {
    activity = deps.now();
  };

  function message(type: StreamMessage["type"], data: unknown): StreamMessage {
    seq += 1;
    return { v: 1, seq, type, data } as StreamMessage;
  }
  function emit(type: StreamMessage["type"], data: unknown): void {
    if (listeners.size === 0) return;
    const built = message(type, data);
    for (const listener of listeners) listener(built);
  }

  /** Moments due at the clock's time, marked as sent (a snapshot or a jump resets the marks). */
  function dueMoments(): Moment[] {
    const now = stadiumNow();
    const due = produced.filter((m) => m.createdAt <= now);
    for (const moment of due) sent.add(moment.id);
    return due;
  }

  function snapshotData() {
    return {
      clock: { ...clock },
      events: events.slice(0, cursor),
      moments: dueMoments(),
      chat: crowd.slice(0, chatCursor),
    };
  }

  function deliver(moment: Moment): void {
    produced.push(moment);
    if (moment.createdAt <= stadiumNow() && !sent.has(moment.id)) {
      sent.add(moment.id);
      emit("moment", { moment });
    }
  }

  function track(work: Promise<Moment>): void {
    const tracked = work.then(deliver, (error: unknown) => {
      console.error(`[sideline] session ${id}: AI work failed`, error);
    });
    pending.add(tracked);
    void tracked.finally(() => pending.delete(tracked));
  }

  function startCatchUp(fromSeq: number, toSeq: number, at: number): void {
    try {
      const facts = buildCatchUpFacts({ events, fromSeq, toSeq, ctx, lens });
      track(deps.orchestrator.catchUp({ sessionId: id, facts, at }));
    } catch (error) {
      // No complete over in the window (the engine says so): nothing to catch up on.
      console.warn(`[sideline] session ${id}: no catch-up for ${fromSeq}-${toSeq}`, error);
    }
  }

  function onTrigger(trigger: MomentTrigger, event: MatchEvent, releasedAt: number): void {
    if (trigger.kind !== "spoiler_nudge") return; // lineup, bailout, room: skills arrive in Task 8
    // Wall ms until the fan's TV reaches the nudge time (ball − 6 s): their delay, less the lead
    // and how far the stadium clock already is past the ball, at this speed.
    const budgetMs = Math.max(
      0,
      Math.round((event.t - NUDGE_LEAD_MS + clock.delayMs - releasedAt) / clock.speed),
    );
    track(
      deps.orchestrator.teaser({
        sessionId: id,
        trigger,
        ballT: event.t,
        budgetMs,
        tvNow: () => tvTimeAt(clock, deps.now()),
      }),
    );
  }

  /** Re-cuts the session at stadium time `t`: refold, new cursors, a catch-up if it skipped ahead. */
  function moveTo(t: number): void {
    const target = Math.min(endT, Math.max(0, Math.round(t)));
    clock = { ...clock, stadiumT: target, wallAt: deps.now() };
    cursor = countUpTo(events, target);
    const lastSeq = cursor - 1;
    state = foldEvents(matchId, events, lastSeq);
    chatCursor = countUpTo(crowd, target);
    sent.clear();
    if (lastSeq > maxSeenSeq) {
      if (missedLegalBalls(events, maxSeenSeq, lastSeq) >= CATCH_UP_MIN_MISSED_BALLS) {
        startCatchUp(maxSeenSeq + 1, lastSeq, target);
      }
      maxSeenSeq = lastSeq;
    }
    emit("snapshot", snapshotData());
  }

  function jumpTime(target: JumpTarget): number {
    switch (target.kind) {
      case "start":
        return 0;
      case "toss": {
        const toss = events.find((e) => e.kind === "toss");
        if (!toss) throw new ControlError("this match has no toss event");
        return toss.t;
      }
      case "over": {
        try {
          return events[seqAfterOvers(events, target.innings, target.afterOvers)]?.t ?? 0;
        } catch (error) {
          throw new ControlError((error as Error).message);
        }
      }
      case "event": {
        const found = events.find((e) => e.id === target.eventId);
        if (!found) throw new ControlError(`unknown event ${target.eventId}`);
        return found.t;
      }
    }
  }

  /** The clock re-anchored at now, so later changes (speed, pause) start from the current time. */
  function rebased(): ClockState {
    return { ...clock, stadiumT: stadiumNow(), wallAt: deps.now() };
  }

  // A fan who joins late has missed everything before the join point: offer the reel at once.
  if (joined >= 0 && missedLegalBalls(events, -1, joined) >= CATCH_UP_MIN_MISSED_BALLS) {
    startCatchUp(0, joined, startT);
  }

  return {
    id,
    matchId,
    persona,
    lens: () => lens,
    clock: () => ({ ...clock }),
    stadiumNow,
    lastActivity: () => activity,
    listeners: () => listeners.size,
    failed: () => failedFlag,
    moments: () => [...produced],

    tick() {
      if (failedFlag) return;
      const now = stadiumNow();
      const released: MatchEvent[] = [];
      while (cursor < events.length && (events[cursor]?.t ?? Number.POSITIVE_INFINITY) <= now) {
        const event = events[cursor] as MatchEvent;
        const before = structuredClone(state);
        applyEvent(state, event);
        const result = gate.process({ before, after: state, event, events, ctx, chat: crowd });
        deps.telemetry.recordGate(id, result.decisions, result.triggers);
        for (const trigger of result.triggers) onTrigger(trigger, event, now);
        released.push(event);
        cursor += 1;
        maxSeenSeq = Math.max(maxSeenSeq, event.seq);
      }
      if (released.length > 0) emit("events", { events: released });
      const chatFrom = chatCursor;
      chatCursor = countUpTo(crowd, now);
      if (chatCursor > chatFrom) emit("chat", { messages: crowd.slice(chatFrom, chatCursor) });
      for (const moment of produced) {
        if (moment.createdAt <= now && !sent.has(moment.id)) {
          sent.add(moment.id);
          emit("moment", { moment });
        }
      }
      // Everything has happened and the fan's TV has shown it: stop the clock so the stream says the
      // match is over.
      if (
        clock.playing &&
        cursor >= events.length &&
        chatCursor >= crowd.length &&
        now >= finalT()
      ) {
        clock = { ...rebased(), playing: false };
        emit("clock", { clock: { ...clock } });
      }
      const wall = deps.now();
      if (listeners.size > 0 && wall - lastTelemetry >= TELEMETRY_EVERY_MS) {
        lastTelemetry = wall;
        emit("telemetry", { telemetry: deps.telemetry.snapshot("session", id) });
      }
    },

    control(request) {
      touch();
      switch (request.action) {
        case "play":
          clock = { ...rebased(), playing: true };
          break;
        case "pause":
          clock = { ...rebased(), playing: false };
          break;
        case "speed":
          clock = { ...rebased(), speed: request.value };
          break;
        case "delay":
          // The delay lives in the browser's buffer: nothing to refold here.
          clock = { ...rebased(), delayMs: request.ms };
          break;
        case "lens":
          lens = request.lens;
          return { ...clock };
        case "seek":
          moveTo(request.t);
          return { ...clock };
        case "jump":
          moveTo(jumpTime(request.target));
          return { ...clock };
      }
      emit("clock", { clock: { ...clock } });
      return { ...clock };
    },

    async ask(question, lensOverride) {
      touch();
      const asked = lensOverride ?? lens;
      // Only what the fan's TV has shown: the stadium's head start would spoil the answer.
      const tvCount = countUpTo(events, tvTimeAt(clock, deps.now()));
      const tvState = foldEvents(matchId, events, tvCount - 1);
      const recent = events
        .slice(0, tvCount)
        .filter(isDelivery)
        .slice(-RECENT_LINES)
        .map((d) => describeDelivery(d, playersById).text);
      const moment = await deps.orchestrator.ask({
        sessionId: id,
        matchId,
        question,
        lens: asked,
        tvSeq: tvCount - 1,
        context: {
          teams: bundle.context.teams.map((t) => ({ code: t.code, name: t.name })),
          situation: situationOf(tvState),
          recent,
        },
        at: stadiumNow(),
      });
      deliver(moment);
      return moment;
    },

    connect(listener) {
      touch();
      listener(
        message("hello", {
          sessionId: id,
          match: bundle.summary,
          persona,
          aiMode: deps.aiMode(),
        }),
      );
      listener(message("snapshot", snapshotData()));
      if (failedFlag) listener(message("error", FAILED));
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        touch();
      };
    },

    async settle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },

    fail(error) {
      if (failedFlag) return;
      failedFlag = true;
      console.error(`[sideline] session ${id} stopped`, error);
      clock = { ...rebased(), playing: false };
      emit("error", FAILED);
    },
  };
}
