import { MomentSchema } from "@sideline/engine";
import { describe, expect, it } from "vitest";
import type { Script } from "../src/ai/providers/scripted.ts";
import type { Session } from "../src/sessions/manager.ts";
import { bundle } from "./helpers.ts";
import { delivery, listen, playUntil, testRuntime, validScript } from "./runtime.ts";

const b = bundle("1298150");
const six = delivery(b.events, 2, "18.6");
const before = delivery(b.events, 2, "18.5");
const sixKey = `nudge:1298150:${six.id}`;
const momentAt = (session: Session, key: string) => session.moments().find((m) => m.key === key);

/** Puts a session on 18.5 at `speed` and moves the wall clock just far enough to release 18.6. */
async function releaseSix(rt: ReturnType<typeof testRuntime>, session: Session, speed: 1 | 32) {
  session.control({ action: "jump", target: { kind: "event", eventId: before.id } });
  session.control({ action: "speed", value: speed });
  const wallMs = Math.ceil((six.t - before.t) / speed);
  rt.clock.advance(wallMs);
  rt.manager.tick();
  await rt.manager.settle();
  // How far past the ball the stadium clock was when the tick released it.
  return before.t + wallMs * speed - six.t;
}

describe("orchestrator (PLAN 5.6)", () => {
  // Thesis 1 (amended by D-043: 18.6, not 18.5, is the big ball).
  it("two sessions reach innings-2 18.6: the first makes the call, the second is a cache hit", async () => {
    const rt = testRuntime();
    const first = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    first.control({ action: "speed", value: 8 });
    await playUntil(rt, first, six.t);
    const second = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    second.control({ action: "speed", value: 8 });
    await playUntil(rt, second, six.t);
    expect(momentAt(first, sixKey)?.provenance).toBe("live");
    expect(momentAt(second, sixKey)?.provenance).toBe("cache");
    expect(rt.provider.requests.filter((r) => r.key === sixKey)).toHaveLength(1);
  });

  it("a teaser ready in time keeps its nudge six seconds before the ball", async () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const messages = listen(session);
    const late = await releaseSix(rt, session, 1);
    const moment = momentAt(session, sixKey);
    // It is streamed as it is produced, and its reveal is the scorecard after the six (DOMAIN §4).
    expect(
      messages
        .filter((m) => m.type === "moment")
        .map((m) => m.type === "moment" && m.data.moment.key),
    ).toContain(sixKey);
    expect(moment?.kind === "spoiler_nudge" && moment.payload.reveal).toContain("144/4");
    expect(MomentSchema.parse(moment)).toMatchObject({
      kind: "spoiler_nudge",
      phase: "climax",
      provenance: "live",
      createdAt: six.t,
      revealAt: six.t,
      nudgeAt: six.t - 6_000,
      scope: "shared",
      payload: { eventId: six.id, usedMs: 0 },
    });
    // The budget is the wall time until the fan's TV (15 s behind) reaches the nudge time.
    expect(moment?.payload).toMatchObject({ budgetMs: 15_000 - 6_000 - late });
  });

  // Review focus 3: the AI result arrives after the fan's TV passed the moment.
  it("a slow call at 32x skips the teaser (nudgeAt null) and the trace shows usedMs > budgetMs", async () => {
    const holder: { advance?: (ms: number) => void } = {};
    const slow: Script = (req, signal) => {
      if (req.key === sixKey) holder.advance?.(3_000);
      return validScript(req, signal);
    };
    const rt = testRuntime({ script: slow });
    holder.advance = rt.clock.advance;
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    const late = await releaseSix(rt, session, 32);
    const budgetMs = Math.round((15_000 - 6_000 - late) / 32);
    expect(budgetMs).toBeGreaterThan(0);
    expect(budgetMs).toBeLessThanOrEqual(281);
    const moment = momentAt(session, sixKey);
    expect(moment).toMatchObject({ provenance: "live", nudgeAt: null, revealAt: six.t });
    expect(moment?.payload).toMatchObject({ budgetMs, usedMs: 3_000 });
    const row = rt.db
      .prepare("SELECT budget_ms, latency_ms, outcome FROM ai_calls WHERE moment_key = ?")
      .get(sixKey);
    expect(row).toEqual({ budget_ms: budgetMs, latency_ms: 3_000, outcome: "ok" });
  });

  it("gives a late joiner one shared catch-up reel, held until their TV reaches the join point", async () => {
    const rt = testRuntime();
    const joinT = delivery(b.events, 2, "13.6").t;
    const a = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    await rt.manager.settle();
    expect(a.moments().find((m) => m.kind === "catch_up")).toMatchObject({
      key: "catchup:1298150:2:0-14:casual",
      phase: "mid_match",
      provenance: "live",
      createdAt: joinT,
      revealAt: joinT,
      nudgeAt: null,
      scope: "shared",
      payload: { innings: 2, fromLabel: "0.1", toLabel: "13.6", lens: "casual" },
    });
    const c = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    await rt.manager.settle();
    expect(c.moments().find((m) => m.kind === "catch_up")?.provenance).toBe("cache");
    expect(rt.provider.requests.filter((r) => r.skill === "catch_up")).toHaveLength(1);
  });

  // 23 = the 22 big balls plus the deciding ball (D-046; re-derived independently in the F05 spot-check).
  it("a full 1298150 replay: 23 teasers, and no model call for lineup, bailout or room triggers yet", async () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "babar-believer" });
    session.control({ action: "speed", value: 32 });
    await playUntil(rt, session, b.events.at(-1)?.t ?? 0, 10_000);
    const kinds = session.moments().map((m) => m.kind);
    expect(kinds).toHaveLength(23);
    expect(new Set(kinds)).toEqual(new Set(["spoiler_nudge"]));
    expect(rt.provider.requests).toHaveLength(23);
    expect(new Set(rt.provider.requests.map((r) => r.skill))).toEqual(new Set(["spoiler_nudge"]));
    for (const moment of session.moments())
      expect(MomentSchema.safeParse(moment).success).toBe(true);
  });

  it("answers a glossary question as a deterministic moment with no model call", async () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    await rt.manager.settle();
    const before = rt.provider.requests.length;
    const moment = await session.ask("what is a free hit?");
    expect(rt.provider.requests).toHaveLength(before);
    expect(moment).toMatchObject({
      kind: "explainer",
      phase: "any",
      provenance: "deterministic",
      traceId: null,
      revealAt: null,
      scope: "session",
      payload: { source: "glossary", lens: "casual" },
    });
  });

  // The explainer's facts are the fan's TV, never the stadium's head start (no spoiler by question).
  it("grounds a contextual question in what the fan's TV has shown", async () => {
    const rt = testRuntime();
    const session = rt.manager.create({ matchId: "1298150", personaId: "late-from-work" });
    await rt.manager.settle();
    await session.ask("why is everyone so tense right now?", "analyst");
    const request = rt.provider.requests.find((r) => r.skill === "explainer");
    // 15 s behind the join point the TV has not yet shown the over's last ball: 13.5 is the latest.
    const tvT = delivery(b.events, 2, "13.6").t - 15_000;
    const shown = b.events.filter((e) => e.kind === "delivery" && e.t <= tvT).at(-1);
    expect(shown && "label" in shown ? shown.label : null).toBe("13.5");
    // 13.6 was a Kohli single (raw file): the TV shows 89/4 after 13.5, not the stadium's 90/4.
    expect(request?.user).toContain('"score":"89/4","overs":"13.5"');
    expect(request?.user).not.toContain('"score":"90/4"');
    expect(request?.system).toContain("tactically minded");
  });
});
