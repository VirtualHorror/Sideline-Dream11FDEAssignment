import {
  type Detector,
  foldEvents,
  type StreamMessage,
  situationOf,
  tvTimeAt,
} from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { bundle } from "./helpers.ts";
import { delivery, listen, playUntil, testRuntime } from "./runtime.ts";

const b = bundle("1298150");
const events = b.events;
const ofType = <T extends StreamMessage["type"]>(messages: StreamMessage[], type: T) =>
  messages.filter((m): m is Extract<StreamMessage, { type: T }> => m.type === type);
const lastSnapshot = (messages: StreamMessage[]) => {
  const snapshots = ofType(messages, "snapshot");
  const last = snapshots.at(-1);
  if (!last) throw new Error("no snapshot");
  return last.data;
};

describe("sessions (PLAN 5.2)", () => {
  // DOMAIN §4: late-from-work opens the app after 14 overs of the chase, at 90/4.
  it("starts late-from-work at the join point after 14 overs of the chase, with every event up to it", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const joined = delivery(events, 2, "13.6");
    expect(session.clock().stadiumT).toBe(joined.t);
    expect(session.clock()).toMatchObject({ speed: 1, playing: true, delayMs: 15_000 });
    const messages = listen(session);
    expect(messages.map((m) => m.type)).toEqual(["hello", "snapshot"]);
    const snap = lastSnapshot(messages);
    expect(snap.events).toEqual(events.filter((e) => e.seq <= joined.seq));
    expect(situationOf(foldEvents("1298150", snap.events))?.score).toBe("90/4");
    expect(snap.chat).toEqual(b.crowd.filter((m) => m.t <= joined.t));
  });

  it("releases the next events in order as the fake clock runs at 8x", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const start = session.clock().stadiumT;
    const messages = listen(session);
    session.control({ action: "speed", value: 8 });
    // 30 s of wall time at 8x is 240 s of stadium time: the over break and the next few balls.
    rt.clock.advance(30_000);
    rt.manager.tick();
    const released = ofType(messages, "events").flatMap((m) => m.data.events);
    const expected = events.filter((e) => e.t > start && e.t <= start + 240_000);
    expect(expected.length).toBeGreaterThan(0);
    expect(released).toEqual(expected);
    expect(released[0]?.seq).toBe(delivery(events, 2, "13.6").seq + 1);
    // The chat moves with the same clock.
    const chat = ofType(messages, "chat").flatMap((m) => m.data.messages);
    expect(chat).toEqual(b.crowd.filter((m) => m.t > start && m.t <= start + 240_000));
    // Envelope seq numbers rise by one per message.
    expect(messages.map((m) => m.seq)).toEqual(messages.map((_, i) => (messages[0]?.seq ?? 0) + i));
  });

  it("refolds on a jump backwards then forwards to exactly a fresh fold, with no future leaks (Review focus 1)", async () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const messages = listen(session);
    session.control({ action: "speed", value: 8 });
    // The chase's big balls after the join point start at 18.6 (F05 spot-check list).
    const nineteenOne = delivery(events, 2, "19.1");
    await playUntil(rt, session, nineteenOne.t);
    const watched = session.moments().filter((m) => m.kind === "spoiler_nudge");
    expect(watched.map((m) => m.createdAt)).toEqual([delivery(events, 2, "18.6").t, nineteenOne.t]);
    const watchedKeys = new Set(watched.map((m) => m.key));
    const callsForWatched = () => rt.provider.requests.filter((r) => watchedKeys.has(r.key)).length;
    expect(callsForWatched()).toBe(2);

    session.control({ action: "jump", target: { kind: "over", innings: 2, afterOvers: 10 } });
    const back = lastSnapshot(messages);
    const tenOvers = delivery(events, 2, "9.6");
    expect(back.clock.stadiumT).toBe(tenOvers.t);
    expect(back.events).toEqual(events.filter((e) => e.t <= tenOvers.t));
    expect(back.chat.every((m) => m.t <= tenOvers.t)).toBe(true);
    expect(back.moments.every((m) => m.createdAt <= tenOvers.t)).toBe(true);
    // Nor does the next tick stream them: the teasers and the reel are later than 10 overs.
    const afterJump = messages.length;
    rt.clock.advance(1_000);
    rt.manager.tick();
    expect(messages.slice(afterJump).filter((m) => m.type === "moment")).toEqual([]);

    session.control({ action: "jump", target: { kind: "over", innings: 2, afterOvers: 19 } });
    const forward = lastSnapshot(messages);
    const fresh = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const freshMessages = listen(fresh);
    fresh.control({ action: "jump", target: { kind: "over", innings: 2, afterOvers: 19 } });
    fresh.control({ action: "pause" });
    const freshSnap = lastSnapshot(freshMessages);
    expect(forward.clock.stadiumT).toBe(freshSnap.clock.stadiumT);
    expect(forward.events).toEqual(freshSnap.events);
    expect(forward.chat).toEqual(freshSnap.chat);
    expect(foldEvents("1298150", forward.events)).toEqual(
      foldEvents("1298150", events, delivery(events, 2, "18.6").seq),
    );
    // The 18.6 teaser watched live comes back, once; the 19.1 one stays hidden (it is the future).
    const ids = forward.moments.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(forward.moments.every((m) => m.createdAt <= forward.clock.stadiumT)).toBe(true);
    expect(forward.moments.filter((m) => m.kind === "spoiler_nudge").map((m) => m.key)).toEqual(
      watched.slice(0, 1).map((m) => m.key),
    );
    // Re-watching from the 10th over costs no new model call: the session's gate remembers its keys.
    session.control({ action: "jump", target: { kind: "over", innings: 2, afterOvers: 10 } });
    await playUntil(rt, session, nineteenOne.t);
    expect(callsForWatched()).toBe(2);
    expect(session.moments().filter((m) => m.kind === "spoiler_nudge")).toHaveLength(
      watched.length,
    );
  });

  // PLAN Task 5 / Flow §7: a catch-up after skipping at least 12 legal balls the fan never saw.
  it("starts a catch-up on a jump past exactly 12 unseen legal balls, not 11", async () => {
    const rt = testRuntime();
    const joined = delivery(events, 2, "13.6");
    const legalAfter = events.filter(
      (e) => e.kind === "delivery" && e.isLegal && e.seq > joined.seq,
    );
    const reels = (target: (typeof events)[number]) => {
      const s = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
      s.control({ action: "jump", target: { kind: "event", eventId: target.id } });
      return s;
    };
    const eleven = reels(legalAfter[10] as (typeof events)[number]);
    const twelve = reels(legalAfter[11] as (typeof events)[number]);
    await rt.manager.settle();
    const keys = (s: typeof eleven) =>
      s
        .moments()
        .filter((m) => m.kind === "catch_up")
        .map((m) => m.key);
    expect(keys(eleven)).toEqual(["catchup:1298150:2:0-14:casual"]);
    expect(keys(twelve)).toEqual([
      "catchup:1298150:2:0-14:casual",
      "catchup:1298150:2:14-16:casual",
    ]);
  });

  it("stops the clock once the match and its crowd are over", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const end = events.at(-1);
    if (!end) throw new Error("no events");
    session.control({ action: "jump", target: { kind: "event", eventId: end.id } });
    const messages = listen(session);
    rt.clock.advance(120_000);
    rt.manager.tick();
    expect(session.clock().playing).toBe(false);
    expect(ofType(messages, "clock").at(-1)?.data.clock.playing).toBe(false);
    // The stadium clock stops once the fan's TV, `delayMs` behind, has shown the end (BUG-004, D-063).
    expect(session.clock().stadiumT).toBe(
      Math.max(end.t, b.crowd.at(-1)?.t ?? 0) + session.clock().delayMs,
    );
  });

  it("evicts a session that has been idle past its TTL, and keeps one with an open stream", () => {
    const rt = testRuntime({ ttlMs: 30 * 60_000 });
    const idle = rt.manager.create({ matchId: "1298150", personaId: "f1-convert" });
    const watching = rt.manager.create({ matchId: "1298150", personaId: "f1-convert" });
    listen(watching);
    rt.clock.advance(30 * 60_000);
    rt.manager.tick();
    expect(rt.manager.get(idle.id)).toBe(idle);
    rt.clock.advance(1);
    rt.manager.tick();
    expect(rt.manager.get(idle.id)).toBeUndefined();
    expect(rt.manager.get(watching.id)).toBe(watching);
  });

  it("makes room at the session cap by evicting the least recently active idle session", () => {
    const rt = testRuntime({ maxSessions: 2 });
    const first = rt.manager.create({ matchId: "1298150", personaId: "f1-convert" });
    rt.clock.advance(1000);
    const second = rt.manager.create({ matchId: "1298150", personaId: "f1-convert" });
    rt.clock.advance(1000);
    const third = rt.manager.create({ matchId: "1415755", personaId: "football-fan" });
    expect(rt.manager.get(first.id)).toBeUndefined();
    expect(rt.manager.get(second.id)).toBe(second);
    listen(second);
    listen(third);
    expect(() => rt.manager.create({ matchId: "1298150", personaId: "f1-convert" })).toThrow(
      /busy/,
    );
  });

  it("refuses an unknown match or persona", () => {
    const rt = testRuntime();
    expect(() => rt.manager.create({ matchId: "1234567", personaId: "f1-convert" })).toThrow(
      /unknown match/,
    );
    expect(() => rt.manager.create({ matchId: "1298150", personaId: "nobody" })).toThrow(
      /unknown persona/,
    );
  });

  // F04 follow-up 3: a detector that throws is a bug; it stops that session only.
  it("pauses a session whose detector throws, with an error message, and keeps the others running", () => {
    const broken: Detector = {
      name: "broken",
      evaluate: ({ ctx, event }) => {
        if (ctx.persona.id === "babar-believer" && event.kind === "delivery") {
          throw new Error("detector bug");
        }
        return { outcome: "deterministic", reason: "fine" };
      },
    };
    const rt = testRuntime({ detectors: [broken] });
    const bad = rt.manager.create({ matchId: "1298150", personaId: "babar-believer" });
    const good = rt.manager.create({ matchId: "1298150", personaId: "f1-convert" });
    const badMessages = listen(bad);
    const goodMessages = listen(good);
    bad.control({ action: "jump", target: { kind: "over", innings: 1, afterOvers: 0 } });
    rt.clock.advance(60_000);
    rt.manager.tick();
    rt.clock.advance(60_000);
    rt.manager.tick();
    expect(bad.failed()).toBe(true);
    expect(bad.clock().playing).toBe(false);
    expect(ofType(badMessages, "error").map((m) => m.data.code)).toEqual(["session_failed"]);
    // A browser that reconnects later is told too, right after its snapshot.
    expect(listen(bad).map((m) => m.type)).toEqual(["hello", "snapshot", "error"]);
    expect(ofType(goodMessages, "events").length).toBeGreaterThan(0);
  });

  it("changes the delay and lens without refolding", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const messages = listen(session);
    session.control({ action: "delay", ms: 40_000 });
    session.control({ action: "lens", lens: "f1" });
    expect(session.clock().delayMs).toBe(40_000);
    expect(session.lens()).toBe("f1");
    expect(ofType(messages, "snapshot")).toHaveLength(1);
    expect(ofType(messages, "clock").map((m) => m.data.clock.delayMs)).toEqual([40_000]);
  });

  it("rejects a jump to an unknown event", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "f1-convert" });
    expect(() =>
      session.control({ action: "jump", target: { kind: "event", eventId: "1298150:9999" } }),
    ).toThrow(/unknown event/);
  });
});

// Task 6 step 6.0, the independent spot-check of t05-verified (D-059): each of these failed on a hand
// mutant that every Task 5 test let through, and passes on the code as merged.
describe("sessions: behaviour the t05-verified spot-check found unpinned", () => {
  it("streams the moments again, once each, when play passes them after a jump back (Review focus 1)", async () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const messages = listen(session);
    session.control({ action: "speed", value: 8 });
    const nineteenOne = delivery(events, 2, "19.1");
    await playUntil(rt, session, nineteenOne.t);
    const teasers = session.moments().filter((m) => m.kind === "spoiler_nudge");
    expect(teasers.map((m) => m.createdAt)).toEqual([delivery(events, 2, "18.6").t, nineteenOne.t]);

    session.control({ action: "jump", target: { kind: "over", innings: 2, afterOvers: 18 } });
    const jumpedTo = session.stadiumNow();
    const afterJump = messages.length;
    await playUntil(rt, session, nineteenOne.t);
    const replayed = ofType(messages.slice(afterJump), "moment").map((m) => m.data.moment.id);
    // Both teasers and, since Task 8, the room read after 18.6: each passed again, each sent once.
    const passed = session.moments().filter((m) => m.createdAt > jumpedTo);
    expect(passed.map((m) => m.kind).sort()).toEqual([
      "room_read",
      "spoiler_nudge",
      "spoiler_nudge",
    ]);
    expect(replayed).toEqual(passed.map((m) => m.id));
  });

  it("never streams an event or a chat line before the stadium clock reaches it", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const messages = listen(session);
    session.control({ action: "speed", value: 8 });
    const until = delivery(events, 2, "19.1").t;
    let checked = 0;
    while (session.stadiumNow() < until) {
      rt.clock.advance(100);
      const before = messages.length;
      rt.manager.tick();
      const now = session.stadiumNow();
      for (const message of messages.slice(before)) {
        const stamped =
          message.type === "events"
            ? message.data.events
            : message.type === "chat"
              ? message.data.messages
              : [];
        for (const item of stamped) {
          expect(item.t).toBeLessThanOrEqual(now);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("keeps the clock running after the last event until the crowd's last reaction", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const end = events.at(-1);
    const lastChat = b.crowd.at(-1);
    if (!end || !lastChat) throw new Error("no events or crowd");
    expect(lastChat.t).toBeGreaterThan(end.t);
    session.control({ action: "jump", target: { kind: "event", eventId: end.id } });
    const messages = listen(session);
    rt.clock.advance(1_000);
    rt.manager.tick();
    expect(session.clock().playing).toBe(true);
    // The crowd's last line, then the fan's delay for their TV to show it (BUG-004, D-063).
    rt.clock.advance(lastChat.t - end.t + session.clock().delayMs);
    rt.manager.tick();
    expect(session.clock().playing).toBe(false);
    const streamed = ofType(messages, "chat").flatMap((m) => m.data.messages);
    expect(streamed.at(-1)).toEqual(lastChat);
  });
});

describe("sessions: behaviour the t06-verified spot-check found unpinned", () => {
  // A mutant clamping seeks to the end plus the fan's delay survived (D-065).
  it("clamps a seek past the end to the last thing at the ground, not to the fan's delayed TV (D-063)", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const end = events.at(-1);
    const lastChat = b.crowd.at(-1);
    if (!end || !lastChat) throw new Error("no events or crowd");
    expect(lastChat.t).toBeGreaterThan(end.t);
    expect(session.clock().delayMs).toBe(15_000);
    // Seeks and jumps stop at the crowd's last reaction; only play runs the clock on by the delay.
    const clock = session.control({ action: "seek", t: lastChat.t + 3_600_000 });
    expect(clock.stadiumT).toBe(lastChat.t);
    expect(session.stadiumNow()).toBe(lastChat.t);
  });
});

// BUG-004, found by the Task 6 UI: the clock stopped when the ground was done, so a fan whose TV runs
// behind never saw the last balls or the result.
describe("sessions: the end of the match reaches the fan's TV (BUG-004)", () => {
  it("keeps the clock running until the fan's delayed TV has shown the match end", () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const end = events.at(-1);
    const lastChat = b.crowd.at(-1);
    if (end?.kind !== "match_end" || !lastChat) throw new Error("no match end or crowd");
    // A feed further behind than the crowd's last reaction to the result (22 s here; 25 s for the
    // babar-believer persona, where the Task 6 UI found it).
    const delay = 30_000;
    expect(delay).toBeGreaterThan(lastChat.t - end.t);
    session.control({ action: "delay", ms: delay });
    session.control({ action: "jump", target: { kind: "event", eventId: end.id } });
    // Everything has happened at the ground, but the fan's TV has not shown the result yet.
    rt.clock.advance(lastChat.t - end.t + 1_000);
    rt.manager.tick();
    expect(session.clock().playing).toBe(true);
    expect(tvTimeAt(session.clock(), rt.clock.now())).toBeLessThan(end.t);
    rt.clock.advance(delay);
    rt.manager.tick();
    expect(session.clock().playing).toBe(false);
    expect(tvTimeAt(session.clock(), rt.clock.now())).toBe(lastChat.t);
  });
});

describe("sessions: the TV's AI chip follows the provider (D-071)", () => {
  const telemetryModes = (messages: ReturnType<typeof listen>) =>
    messages.flatMap((m) => (m.type === "telemetry" ? [m.data.aiMode] : []));

  it("a key that fails turns the stream's AI mode to replay within one telemetry message", async () => {
    const rt = testRuntime({
      script: () => {
        throw Object.assign(new Error("403"), { status: 403, code: "key_expired" });
      },
    });
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const messages = listen(session);
    expect(messages[0]?.type === "hello" && messages[0].data.aiMode).toBe("live");
    await session.settle(); // the join point's catch-up reel asked the provider and got a 403
    rt.clock.advance(5_000);
    rt.manager.tick();
    expect(telemetryModes(messages)).toEqual(["replay"]);
  });

  it("an answering provider keeps it live", async () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const messages = listen(session);
    await session.settle();
    rt.clock.advance(5_000);
    rt.manager.tick();
    expect(telemetryModes(messages)).toEqual(["live"]);
  });
});
