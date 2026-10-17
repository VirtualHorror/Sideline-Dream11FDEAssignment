/**
 * PLAN 8.2, the bailout skill: a comeback quest for the fan whose captain fell cheaply. The model
 * phrases predictions and picks their rules; code checks every rule is a QuestRule inside the facts'
 * quest window, after the wicket, and the engine alone settles them (resolveQuestRule). Real facts:
 * Babar Azam lbw b Arshdeep Singh 0 (1) at 1.1 of 1298150, so the quest covers innings 1's legal balls
 * 8-25 (1.2 to 4.1). Outcomes below were counted from the raw Cricsheet file in Python, not with the
 * engine: in balls 8-25 Rizwan is caught at ball 24, fours come at 12 and 19 and no six, 12 legal
 * balls have nothing off the bat, and Rizwan has 4 runs when he is out.
 */
import { type BailoutFacts, type QuestRule, resolveQuestRule } from "@sideline/engine";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/ai/budget.ts";
import { createCache } from "../src/ai/cache.ts";
import { createGateway } from "../src/ai/gateway.ts";
import { createScriptedProvider, type Script } from "../src/ai/providers/scripted.ts";
import {
  type BailoutSkillFacts,
  bailoutSkill,
  bailoutSkillFacts,
} from "../src/ai/skills/bailout.ts";
import { openDatabase } from "../src/db/database.ts";
import { createTraceSink } from "../src/telemetry/collector.ts";
import { bailoutFactsFor, bundle, fakeClock, teamsOf } from "./helpers.ts";
import { delivery, playUntil, testRuntime } from "./runtime.ts";

const RIZWAN = "2f26ac1a";
const facts = (): BailoutSkillFacts =>
  bailoutSkillFacts(bailoutFactsFor("1298150", "babar-believer"), teamsOf("1298150"));

/** A rule as the model writes it: every field present, the unused ones null. */
const rule = (fields: Record<string, unknown>) => ({
  type: "wicket_in_window",
  innings: 1,
  over: null,
  fromLegalBall: null,
  toLegalBall: null,
  boundary: null,
  op: null,
  value: null,
  playerId: null,
  byLegalBall: null,
  ...fields,
});
const yesNo = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];
const quest = (predictions: unknown[], trivia: unknown[] = []) => ({
  title: "Win it back in three overs",
  predictions,
  trivia,
  banter: {
    tone: "self_roast",
    headline: "Captain gone first ball",
    body: "Plenty of overs left to recover.",
    shareText: "My captain lasted one ball. Back via the comeback quest.",
  },
});
const wicketWindow = rule({ fromLegalBall: 8, toLegalBall: 25 });

function run(script: Script, input = facts()) {
  const clock = fakeClock();
  const db = openDatabase(":memory:");
  const provider = createScriptedProvider(script);
  const gateway = createGateway({
    provider,
    cache: createCache(db, clock.now),
    budget: createBudget({ db, dailyUsd: 3, sessionCap: 80, now: clock.now }),
    traces: createTraceSink(db),
    models: { fast: "gpt-test-fast", smart: "gpt-test" },
    pricing: { inPerMTok: 5, outPerMTok: 20 },
    now: clock.now,
  });
  return { provider, result: gateway.run(bailoutSkill, "bailout:test", input) };
}

describe("bailout: the model phrases the quest, the engine settles it (PLAN 8.2)", () => {
  it("rejects a rule whose window starts before the trigger", async () => {
    const early = rule({ fromLegalBall: 5, toLegalBall: 20 });
    const { result } = run(() =>
      quest([{ prompt: "A wicket soon?", options: yesNo, rule: early }]),
    );
    const { provenance, trace } = await result;
    expect(provenance).toBe("fallback");
    expect(trace.detail).toBe(
      "guard: prediction 1 starts at legal ball 5, before the quest window (8-25)",
    );
  });

  it("accepts a quest whose predictions later resolve through resolveQuestRule on real events", async () => {
    const { result } = run(() =>
      quest(
        [
          { prompt: "Another wicket by 4.1?", options: yesNo, rule: wicketWindow },
          {
            prompt: "A six in the window?",
            options: yesNo,
            rule: rule({
              type: "boundary_in_window",
              fromLegalBall: 8,
              toLegalBall: 25,
              boundary: "6",
            }),
          },
          {
            prompt: "12 or more dot balls?",
            options: yesNo,
            rule: rule({
              type: "dots_in_window",
              fromLegalBall: 8,
              toLegalBall: 25,
              op: "gte",
              value: 12,
            }),
          },
        ],
        [
          {
            question: "How was Babar out?",
            options: ["lbw", "bowled"],
            answerIndex: 0,
            factId: "dismissal",
          },
        ],
      ),
    );
    const { payload, provenance, trace } = await result;
    expect(provenance).toBe("live");
    expect(trace.outcome).toBe("ok");
    const rules = payload.quest.predictions.map((p) => p.rule as QuestRule);
    expect(rules[1]).toEqual({
      type: "boundary_in_window",
      innings: 1,
      fromLegalBall: 8,
      toLegalBall: 25,
      boundary: 6,
    });
    const events = bundle("1298150").events;
    expect(rules.map((r) => resolveQuestRule(r, events))).toEqual(["won", "lost", "won"]);
    // Up to 3.1 (legal ball 19) Rizwan is still in: the wicket call is not settled yet.
    const upTo = events.filter((e) => e.seq <= delivery(events, 1, "3.1").seq);
    expect(resolveQuestRule(rules[0] as QuestRule, upTo)).toBe("pending");
    expect(payload.quest.predictions.map((p) => [p.id, p.rewardBucks])).toEqual([
      ["p1", 100],
      ["p2", 100],
      ["p3", 100],
    ]);
    expect(payload.quest).toMatchObject({ windowFromLabel: "1.2", windowToLabel: "4.1" });
    expect(payload.trivia[0]?.fact).toBe("Babar Azam lbw b Arshdeep Singh 0 (1)");
    expect(payload.trigger).toEqual({
      playerId: "8a75e999",
      role: "C",
      runs: 0,
      balls: 1,
      label: "1.1",
      eventId: "1298150:0018",
    });
    expect([payload.projectedBefore, payload.projectedAfter]).toEqual([718.64, 606.92]);
  });

  it.each([
    [
      "a window that runs past the quest window",
      [{ prompt: "A wicket?", options: yesNo, rule: rule({ fromLegalBall: 10, toLegalBall: 30 }) }],
      [],
      "prediction 1 ends at legal ball 30, after the quest window (8-25)",
    ],
    [
      "a rule that is not a quest rule",
      [
        {
          prompt: "Runs?",
          options: yesNo,
          rule: rule({ type: "runs_in_over", op: "gte", value: 6 }),
        },
      ],
      [],
      "prediction 1 is not a valid quest rule",
    ],
    [
      "an over that starts before the window",
      [
        {
          prompt: "Six off the over?",
          options: yesNo,
          rule: rule({ type: "runs_in_over", over: 1, op: "gte", value: 6 }),
        },
      ],
      [],
      "prediction 1 starts at legal ball 7, before the quest window (8-25)",
    ],
    [
      "a batter who is not at the crease",
      [
        {
          prompt: "Kohli 10?",
          options: yesNo,
          rule: rule({
            type: "batter_runs_by",
            playerId: "ba607b88",
            byLegalBall: 25,
            op: "gte",
            value: 10,
          }),
        },
      ],
      [],
      "prediction 1 names ba607b88, who is not at the crease",
    ],
    [
      "a negative target",
      [
        {
          prompt: "Rizwan scores?",
          options: yesNo,
          rule: rule({
            type: "batter_runs_by",
            playerId: RIZWAN,
            byLegalBall: 25,
            op: "lte",
            value: -1,
          }),
        },
      ],
      [],
      "prediction 1 is not a valid quest rule",
    ],
    [
      "options that repeat an id",
      [
        {
          prompt: "A wicket?",
          options: [
            { id: "a", label: "Yes" },
            { id: "a", label: "No" },
          ],
          rule: wicketWindow,
        },
      ],
      [],
      "prediction 1 repeats an option id",
    ],
    [
      "three options for a yes-or-no rule",
      [
        {
          prompt: "A wicket?",
          options: [...yesNo, { id: "maybe", label: "Maybe" }],
          rule: wicketWindow,
        },
      ],
      [],
      "prediction 1 needs exactly two options: the rule comes true, or it does not",
    ],
    [
      "trivia grounded in a fact that does not exist",
      [{ prompt: "A wicket?", options: yesNo, rule: wicketWindow }],
      [
        {
          question: "Who bowled?",
          options: ["Arshdeep", "Bhuvneshwar"],
          answerIndex: 0,
          factId: "weather",
        },
      ],
      "trivia 1 cites weather, which is not one of the facts",
    ],
    [
      "trivia whose answer is not an option",
      [{ prompt: "A wicket?", options: yesNo, rule: wicketWindow }],
      [{ question: "How?", options: ["lbw", "bowled"], answerIndex: 2, factId: "dismissal" }],
      "trivia 1's answer is not one of its options",
    ],
  ])("rejects %s", async (_label, predictions, trivia, reason) => {
    const { result } = run(() => quest(predictions, trivia));
    const { provenance, trace } = await result;
    expect(provenance).toBe("fallback");
    expect(trace.detail).toBe(`guard: ${reason}`);
  });

  it("rejects a batter call that is already decided", async () => {
    // Rizwan has 0 when Babar falls (atCrease): "0 or more" is won before a ball is bowled.
    const settled = rule({
      type: "batter_runs_by",
      playerId: RIZWAN,
      byLegalBall: 25,
      op: "gte",
      value: 0,
    });
    const { result } = run(() =>
      quest([{ prompt: "Rizwan scores?", options: yesNo, rule: settled }]),
    );
    const { trace } = await result;
    expect(trace.detail).toBe("guard: prediction 1 is already decided: Mohammad Rizwan has 0");
  });

  it("keeps the fan's projection out of the shared prompt", () => {
    const shared = facts();
    const other: BailoutFacts = {
      ...bailoutFactsFor("1298150", "babar-believer"),
      projection: {
        before: 1,
        after: 0.5,
        dismissedProjected: 1,
        dismissedPoints: 0,
        multiplier: 2,
      },
    };
    const prompt = bailoutSkill.buildPrompt(shared);
    expect(bailoutSkill.buildPrompt(bailoutSkillFacts(other, teamsOf("1298150")))).toEqual(prompt);
    expect(`${prompt.system}${prompt.user}`).not.toMatch(/718\.64|606\.92/);
    expect(prompt.user).toContain("Babar Azam lbw b Arshdeep Singh 0 (1)");
    expect(prompt.user).toContain('"fromLegalBall":8');
  });

  it("falls back to a labelled quest built from the same facts, settled by the same engine", () => {
    const payload = bailoutSkill.fallback(facts());
    expect(payload.quest.title).toBe("Comeback quest: 1.2 to 4.1");
    const rules = payload.quest.predictions.map((p) => p.rule);
    expect(rules).toEqual([
      { type: "wicket_in_window", innings: 1, fromLegalBall: 8, toLegalBall: 25 },
      {
        type: "boundary_in_window",
        innings: 1,
        fromLegalBall: 8,
        toLegalBall: 25,
        boundary: "any",
      },
    ]);
    expect(rules.map((r) => resolveQuestRule(r, bundle("1298150").events))).toEqual(["won", "won"]);
    expect(payload.trivia[0]).toMatchObject({ fact: "Babar Azam lbw b Arshdeep Singh 0 (1)" });
    const trivia = payload.trivia[0];
    if (!trivia) throw new Error("the template has a trivia question");
    expect(trivia.options[trivia.answerIndex]).toBe("lbw");
    expect(payload.banter.headline).toContain("Babar");
  });
});

describe("bailouts in a session (PLAN 8.2)", () => {
  it("the captain's golden duck brings a shared quest, revealed with the wicket; a second fan hits the cache", async () => {
    const rt = testRuntime();
    const ball = delivery(bundle("1298150").events, 1, "1.1");
    // At 32x: an unwatched session at 1x would sit idle past the 30-minute TTL before 1.1.
    const first = rt.manager.create({ matchId: "1298150", personaId: "babar-believer" });
    first.control({ action: "speed", value: 32 });
    await playUntil(rt, first, ball.t);
    const quest = first.moments().find((m) => m.kind === "bailout");
    expect(quest).toMatchObject({
      key: "bailout:1298150:1298150:0018:C",
      phase: "early_collapse",
      createdAt: ball.t,
      revealAt: ball.t,
      nudgeAt: null,
      scope: "shared",
      provenance: "live",
    });
    const second = rt.manager.create({ matchId: "1298150", personaId: "babar-believer" });
    second.control({ action: "speed", value: 32 });
    await playUntil(rt, second, ball.t);
    expect(second.moments().find((m) => m.kind === "bailout")?.provenance).toBe("cache");
    expect(rt.provider.requests.filter((r) => r.skill === "bailout")).toHaveLength(1);
  });
});
