import type { DeliveryEvent, MatchEvent, Moment } from "@sideline/engine";
import { foldEvents } from "@sideline/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { outburstFor } from "../src/broadcast/outburst.ts";
import { suggestQuestion } from "../src/companion/suggest.ts";
import { ApiError, api } from "../src/lib/api.ts";
import { parseRoute } from "../src/router.tsx";
import { delivery, events, MATCH_ID, players, summary } from "./helpers/match.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const playersById = new Map(players.map((p) => [p.id, p]));
const teaserFor = (ball: DeliveryEvent): Moment => ({
  id: `m-${ball.id}`,
  key: `nudge:${MATCH_ID}:${ball.id}`,
  kind: "spoiler_nudge",
  phase: "climax",
  createdAt: ball.t,
  revealAt: ball.t,
  nudgeAt: ball.t - 6000,
  provenance: "fallback",
  traceId: null,
  scope: "shared",
  payload: { eventId: ball.id, nudge: "n", reveal: "r", leverage: 0.4, budgetMs: 0, usedMs: 0 },
});
const ctx = (moments: Moment[]) => ({ moments, teams: summary.teams, players: playersById });
const [pak, ind] = summary.teams;

describe("outbursts fire for big moments revealed on the TV", () => {
  it("lights a flagged six in gold mixed with the batting side's colour", () => {
    const six = delivery(2, "18.6");
    const burst = outburstFor(six, ctx([teaserFor(six)]));
    expect(burst).toMatchObject({ kind: "six", headline: "Six", line: "18.6 Rauf to Kohli, six" });
    expect(burst?.color).toBe(`color-mix(in oklab, var(--six) 62%, ${ind?.color})`);
  });

  it("lights a flagged wicket in the bowling side's colour", () => {
    const wicket = delivery(2, "19.1");
    const burst = outburstFor(wicket, ctx([teaserFor(wicket)]));
    expect(burst).toMatchObject({ kind: "wicket", headline: "Wicket", color: pak?.color });
  });

  it("leaves a six alone when the gate did not flag it as a big ball", () => {
    // 18.5 is a six below the leverage threshold (D-043): no teaser, so no spectacle.
    expect(outburstFor(delivery(2, "18.5"), ctx([]))).toBeNull();
  });

  it("lights the result in the winner's colour, for longer", () => {
    const end = events.at(-1) as MatchEvent;
    expect(outburstFor(end, ctx([]))).toMatchObject({
      kind: "result",
      headline: "India",
      line: "India won by 4 wickets",
      color: ind?.color,
      strength: 1.6,
    });
  });
});

describe("suggestQuestion (from the match state, never AI)", () => {
  it.each([
    ["19.4", "What is a free hit?"],
    ["19.5", "What does stumped mean?"],
    ["18.6", "What is a boundary?"],
    ["13.6", "What is the required run rate?"],
  ])("after %s of the chase suggests a glossary question", (label, question) => {
    const ball = delivery(2, label);
    expect(suggestQuestion(foldEvents(MATCH_ID, events, ball.seq), ball)).toBe(question);
  });

  it("starts with the toss before the match", () => {
    expect(suggestQuestion(foldEvents(MATCH_ID, events, 0), null)).toBe("What is the toss?");
  });
});

describe("api", () => {
  it("turns an error body into an ApiError with the server's code and Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "rate_limited", message: "Too many questions" } }),
            {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "5" },
            },
          ),
      ),
    );
    const error = await api.ask("s-1", "what is a wide?").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "rate_limited", retryAfterSec: 5 });
  });

  it("validates what it receives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ clock: { speed: 3 } }), { status: 200 })),
    );
    await expect(api.control("s-1", { action: "pause" })).rejects.toThrow(ApiError);
  });
});

describe("parseRoute", () => {
  it.each([
    ["/", { name: "landing" }],
    ["/match/1298150", { name: "match", matchId: "1298150" }],
    ["/architecture", { name: "architecture" }],
    ["/architecture/", { name: "architecture" }],
    ["/match/abc", { name: "not_found", path: "/match/abc" }],
    ["/nope", { name: "not_found", path: "/nope" }],
  ])("reads %s", (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });
});
