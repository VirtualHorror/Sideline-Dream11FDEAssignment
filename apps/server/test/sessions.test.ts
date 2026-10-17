import { type Detector, foldEvents, type StreamMessage, situationOf } from "@sideline/engine";
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
