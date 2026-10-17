import { type StreamMessage, StreamMessageSchema } from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { testApp } from "./http.ts";

interface Frame {
  event: string | null;
  id: string | null;
  data: string | null;
  comment: boolean;
}

/**
 * Reads SSE frames from a response body until `enough` says stop. One read is kept pending across
 * waits (a read abandoned to a timeout would swallow its chunk); `pump` runs after every read or
 * quiet spell, to move the session along.
 */
async function readFrames(
  body: ReadableStream<Uint8Array>,
  enough: (frames: Frame[]) => boolean,
  pump?: () => void,
): Promise<{ frames: Frame[]; text: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let frames: Frame[] = [];
  let pending = reader.read();
  for (let reads = 0; reads < 400 && !enough(frames); reads += 1) {
    const next = await Promise.race([
      pending,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    pump?.();
    if (next === null) continue;
    if (next.done) break;
    pending = reader.read();
    text += decoder.decode(next.value, { stream: true });
    frames = text
      .split("\n\n")
      .slice(0, -1)
      .filter((part) => part !== "")
      .map((raw) => {
        const lines = raw.split("\n");
        const field = (name: string) =>
          lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2) ?? null;
        return {
          event: field("event"),
          id: field("id"),
          data: field("data"),
          comment: lines.every((l) => l.startsWith(":")),
        };
      });
  }
  await reader.cancel();
  return { frames, text };
}

const messagesOf = (frames: Frame[]): StreamMessage[] =>
  frames.filter((f) => !f.comment).map((f) => StreamMessageSchema.parse(JSON.parse(f.data ?? "")));

describe("GET /api/sessions/:id/stream (PLAN 5.3)", () => {
  it("sends StreamMessages in order, hello and snapshot first, with id = seq and event = type", async () => {
    const t = testApp({ env: { ANTHROPIC_API_KEY: "sk-ant-SECRET-STREAM-1" } });
    const session = t.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    session.control({ action: "speed", value: 8 });
    const res = await t.call(`/api/sessions/${session.id}/stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const { frames, text } = await readFrames(
      res.body as ReadableStream<Uint8Array>,
      (f) => messagesOf(f).some((m) => m.type === "events"),
      () => {
        t.clock.advance(30_000);
        t.manager.tick();
      },
    );
    const messages = messagesOf(frames);
    expect(messages.slice(0, 2).map((m) => m.type)).toEqual(["hello", "snapshot"]);
    expect(messages.map((m) => m.type)).toContain("events");
    for (const [index, frame] of frames.filter((f) => !f.comment).entries()) {
      const message = messages[index] as StreamMessage;
      expect(frame.event).toBe(message.type);
      expect(frame.id).toBe(String(message.seq));
    }
    const seqs = messages.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const hello = messages[0];
    expect(hello?.type === "hello" && hello.data).toMatchObject({
      sessionId: session.id,
      match: { id: "1298150" },
      persona: { id: "late-from-work" },
      aiMode: "live",
    });
    // No key, and nothing that looks like one, ever goes down the stream.
    expect(text).not.toMatch(/SECRET|sk-ant|sk-[A-Za-z0-9]{20}/);
  });

  it("sends heartbeat comments while nothing happens", async () => {
    const t = testApp();
    const session = t.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    session.control({ action: "pause" });
    const res = await t.call(`/api/sessions/${session.id}/stream`);
    const { frames } = await readFrames(res.body as ReadableStream<Uint8Array>, (f) =>
      f.some((frame) => frame.comment),
    );
    expect(frames.some((frame) => frame.comment)).toBe(true);
  });

  it("closes the subscription when the client goes away", async () => {
    const t = testApp();
    const session = t.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const res = await t.call(`/api/sessions/${session.id}/stream`);
    await readFrames(res.body as ReadableStream<Uint8Array>, (f) => messagesOf(f).length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.listeners()).toBe(0);
  });

  it("answers an unknown session with a JSON 404", async () => {
    const t = testApp();
    const res = await t.call("/api/sessions/no-such-session/stream");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "No session no-such-session" },
    });
  });
});
