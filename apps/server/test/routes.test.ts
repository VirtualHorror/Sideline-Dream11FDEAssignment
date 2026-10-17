import {
  ClockStateSchema,
  MomentSchema,
  SessionCreateResponseSchema,
  TelemetrySnapshotSchema,
} from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { testApp } from "./http.ts";

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

async function newSession(t: ReturnType<typeof testApp>, personaId = "late-from-work") {
  const res = await t.post("/api/sessions", { matchId: "1298150", personaId });
  expect(res.status).toBe(201);
  return SessionCreateResponseSchema.parse(await res.json()).sessionId;
}

describe("GET /api/matches (PLAN 5.7)", () => {
  it("lists both matches with their personas' public fields only", async () => {
    const t = testApp();
    const res = await t.call("/api/matches");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matches: { id: string; personas: Record<string, unknown>[] }[];
    };
    expect(body.matches.map((m) => m.id)).toEqual(["1298150", "1415755"]);
    expect(body.matches[0]?.personas.map((p) => p.id)).toEqual([
      "babar-believer",
      "late-from-work",
      "f1-convert",
    ]);
    for (const match of body.matches) {
      for (const persona of match.personas) {
        expect(Object.keys(persona).sort()).toEqual(["blurb", "delayMs", "id", "label", "lens"]);
      }
    }
  });
});

describe("POST /api/sessions", () => {
  it("creates a session: 201 with its stream URL", async () => {
    const t = testApp();
    const res = await t.post("/api/sessions", {
      matchId: "1415755",
      personaId: "proteas-late",
      delayMs: 40_000,
      lens: "f1",
    });
    expect(res.status).toBe(201);
    const body = SessionCreateResponseSchema.parse(await res.json());
    expect(body.streamUrl).toBe(`/api/sessions/${body.sessionId}/stream`);
    const session = t.manager.get(body.sessionId);
    expect(session?.clock().delayMs).toBe(40_000);
    expect(session?.lens()).toBe("f1");
  });

  it.each([
    ["no persona", { matchId: "1298150" }],
    ["a match id that is not a Cricsheet id", { matchId: "abc", personaId: "f1-convert" }],
    ["a delay over 60 s", { matchId: "1298150", personaId: "f1-convert", delayMs: 90_000 }],
    ["an unknown lens", { matchId: "1298150", personaId: "f1-convert", lens: "cricket" }],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await testApp().post("/api/sessions", body);
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("rejects malformed JSON with 400 and an oversized body with 413", async () => {
    const t = testApp();
    expect((await t.post("/api/sessions", "{not json")).status).toBe(400);
    const huge = JSON.stringify({
      matchId: "1298150",
      personaId: "f1-convert",
      pad: "x".repeat(40_000),
    });
    const res = await t.post("/api/sessions", huge);
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ error: { code: "payload_too_large" } });
  });

  it("answers an unknown match or persona with a JSON 404", async () => {
    const t = testApp();
    const match = await t.post("/api/sessions", { matchId: "1234567", personaId: "f1-convert" });
    expect(match.status).toBe(404);
    expect(await json(match)).toEqual({
      error: { code: "not_found", message: "unknown match 1234567" },
    });
    const persona = await t.post("/api/sessions", { matchId: "1298150", personaId: "nobody" });
    expect(persona.status).toBe(404);
  });

  it("answers 503 when every session slot has an open stream", async () => {
    const t = testApp({ maxSessions: 1 });
    const id = await newSession(t);
    t.manager.get(id)?.connect(() => {});
    const res = await t.post("/api/sessions", { matchId: "1298150", personaId: "f1-convert" });
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: { code: "busy" } });
  });
});

describe("POST /api/sessions/:id/control", () => {
  it("applies a valid control and returns the clock", async () => {
    const t = testApp();
    const id = await newSession(t);
    const res = await t.post(`/api/sessions/${id}/control`, { action: "speed", value: 8 });
    expect(res.status).toBe(200);
    const { clock } = (await res.json()) as { clock: unknown };
    expect(ClockStateSchema.parse(clock).speed).toBe(8);
  });

  it("rejects a bad speed with 400 and a jump to an unknown event with 400", async () => {
    const t = testApp();
    const id = await newSession(t);
    const speed = await t.post(`/api/sessions/${id}/control`, { action: "speed", value: 7 });
    expect(speed.status).toBe(400);
    const jump = await t.post(`/api/sessions/${id}/control`, {
      action: "jump",
      target: { kind: "event", eventId: "1298150:9999" },
    });
    expect(jump.status).toBe(400);
    expect(await json(jump)).toEqual({
      error: { code: "invalid_control", message: "unknown event 1298150:9999" },
    });
  });

  it("answers an unknown session with a JSON 404", async () => {
    const res = await testApp().post("/api/sessions/nope/control", { action: "pause" });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: { code: "not_found", message: "No session nope" } });
  });
});

describe("POST /api/sessions/:id/ask (Review focus 5)", () => {
  it("answers a glossary question as a deterministic moment", async () => {
    const t = testApp();
    const id = await newSession(t);
    const res = await t.post(`/api/sessions/${id}/ask`, { text: "What is a free hit?" });
    expect(res.status).toBe(200);
    const { moment } = (await res.json()) as { moment: unknown };
    expect(MomentSchema.parse(moment)).toMatchObject({
      kind: "explainer",
      provenance: "deterministic",
      payload: { source: "glossary" },
    });
  });

  it("takes 280 characters and refuses 281, and a 10,000-character question, with 400", async () => {
    const t = testApp();
    const id = await newSession(t);
    expect((await t.post(`/api/sessions/${id}/ask`, { text: "a".repeat(280) })).status).toBe(200);
    const long = await t.post(`/api/sessions/${id}/ask`, { text: "a".repeat(281) }, "198.51.100.9");
    expect(long.status).toBe(400);
    expect(await json(long)).toMatchObject({ error: { code: "invalid_request" } });
    const huge = await t.post(
      `/api/sessions/${id}/ask`,
      { text: "a".repeat(10_000) },
      "198.51.100.9",
    );
    expect(huge.status).toBe(400);
    const blank = await t.post(`/api/sessions/${id}/ask`, { text: "   " }, "198.51.100.9");
    expect(blank.status).toBe(400);
  });

  it("limits one address to its token bucket: the 13th ask in a minute is 429", async () => {
    const t = testApp();
    const id = await newSession(t);
    const statuses: number[] = [];
    for (let i = 0; i < 13; i += 1) {
      statuses.push((await t.post(`/api/sessions/${id}/ask`, { text: "what is a wide?" })).status);
    }
    // Burst of 4, refilled at 12 a minute (one every 5 s): rapid asks get 4 through.
    expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(statuses.slice(4)).toEqual(new Array(9).fill(429));
    const limited = await t.post(`/api/sessions/${id}/ask`, { text: "what is a wide?" });
    expect(limited.headers.get("retry-after")).toBe("5");
    expect(await json(limited)).toMatchObject({ error: { code: "rate_limited" } });
    // Another address has its own bucket; the first refills with time.
    expect(
      (await t.post(`/api/sessions/${id}/ask`, { text: "what is a wide?" }, "198.51.100.2")).status,
    ).toBe(200);
    t.clock.advance(5_000);
    expect((await t.post(`/api/sessions/${id}/ask`, { text: "what is a wide?" })).status).toBe(200);
  });

  it("trusts X-Forwarded-For only from the reverse proxy on this host", async () => {
    const t = testApp();
    const id = await newSession(t);
    const ask = (forwarded: string, peer: string) =>
      t.call(
        `/api/sessions/${id}/ask`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": forwarded },
          body: JSON.stringify({ text: "what is a wide?" }),
        },
        peer,
      );
    // From a remote peer the header is ignored: all five count against that peer.
    const remote = [];
    for (let i = 0; i < 5; i += 1) remote.push((await ask(`10.0.0.${i}`, "203.0.113.50")).status);
    expect(remote).toEqual([200, 200, 200, 200, 429]);
    // Behind the local proxy each forwarded client has its own bucket.
    const proxied = [];
    for (let i = 0; i < 5; i += 1) proxied.push((await ask(`10.0.1.${i}`, "127.0.0.1")).status);
    expect(proxied).toEqual([200, 200, 200, 200, 200]);
  });

  it("answers an unknown session with a JSON 404", async () => {
    const res = await testApp().post("/api/sessions/nope/ask", { text: "what is a wide?" });
    expect(res.status).toBe(404);
  });

  // Task 6 step 6.0 (D-059): the 409 path had no test; the UI shows the session as paused on it.
  it("answers 409 for a session an internal error stopped", async () => {
    const t = testApp();
    const id = await newSession(t);
    t.manager.get(id)?.fail(new Error("stopped by the test"));
    const res = await t.post(`/api/sessions/${id}/ask`, { text: "what is a wide?" });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({
      error: { code: "session_failed", message: "This session was paused." },
    });
  });
});

describe("GET /api/telemetry", () => {
  it("serves the global and a session's snapshot", async () => {
    const t = testApp();
    const id = await newSession(t);
    const global = await t.call("/api/telemetry?scope=global");
    expect(global.status).toBe(200);
    expect(TelemetrySnapshotSchema.parse(await global.json()).scope).toBe("global");
    const own = await t.call(`/api/telemetry?scope=session&sessionId=${id}&viewers=1000`);
    expect(own.status).toBe(200);
    const snap = TelemetrySnapshotSchema.parse(await own.json());
    expect(snap).toMatchObject({ scope: "session", projection: { concurrentViewers: 1000 } });
  });

  it.each([
    ["an unknown scope", "/api/telemetry?scope=everything", 400],
    ["a session scope without an id", "/api/telemetry?scope=session", 400],
    ["zero viewers", "/api/telemetry?scope=global&viewers=0", 400],
    ["an unknown session", "/api/telemetry?scope=session&sessionId=nope", 404],
  ])("answers %s with %i", async (_name, path, status) => {
    expect((await testApp().call(path)).status).toBe(status);
  });
});
