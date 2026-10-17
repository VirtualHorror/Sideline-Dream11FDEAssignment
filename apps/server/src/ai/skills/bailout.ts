/**
 * Phase 2, "Bailout": the fan's captain or vice-captain fell cheaply in the powerplay and their
 * fantasy team feels dead; a comeback quest over the next three overs gives them a reason to stay.
 *
 * Callers: the orchestrator, for the collapse detector's trigger. The key is shared by the cohort whose
 * armband this was (`bailout:<match>:<eventId>:<C|VC>`), so the squad projection, which is one fan's
 * (D-045), never reaches the prompt (Constraint 11): `bailoutSkillFacts` splits it off and only the
 * payload carries it, beside the shared words. The model phrases yes-or-no predictions and picks their
 * QuestRules, writes trivia from the grounded facts by id, and the banter; code checks every rule lies
 * inside the quest window after the wicket and is not already decided, and the engine alone settles
 * the predictions as deliveries arrive (quests/resolve.ts). Rewards are simulated DreamBucks.
 */
import type { BailoutFacts, BailoutPayload, QuestRule } from "@sideline/engine";
import { z } from "zod";
import { clip, plural, type TeamName, teamName } from "./format.ts";
import { RuleDraftSchema, ruleSpan as span, toQuestRule } from "./questRules.ts";
import type { GuardResult, Skill } from "./types.ts";

/** Simulated DreamBucks for each prediction called right: a game parameter, not a statistic. */
export const QUEST_REWARD_BUCKS = 100;

/** The facts every fan in the cohort shares: everything but the squad projection. */
export type SharedBailoutFacts = Omit<BailoutFacts, "projection">;

export interface BailoutSkillFacts {
  bailout: SharedBailoutFacts;
  teams: readonly TeamName[];
  /** Per session: the fan's squad projection, for the payload only, never the prompt (D-045). */
  projection: BailoutFacts["projection"];
}

/** Splits the detector's facts into the shared ones and the fan's own projection. */
export function bailoutSkillFacts(
  facts: BailoutFacts,
  teams: readonly TeamName[],
): BailoutSkillFacts {
  const { projection, ...shared } = facts;
  return { bailout: shared, teams, projection };
}

const BailoutOutputSchema = z.strictObject({
  title: z.string().min(1).max(80),
  predictions: z
    .array(
      z.strictObject({
        prompt: z.string().min(1).max(120),
        options: z
          .array(z.strictObject({ id: z.string().min(1).max(8), label: z.string().min(1).max(60) }))
          .min(2)
          .max(4),
        rule: RuleDraftSchema,
      }),
    )
    .min(1)
    .max(3),
  trivia: z
    .array(
      z.strictObject({
        question: z.string().min(1).max(160),
        options: z.array(z.string().min(1).max(60)).min(2).max(4),
        answerIndex: z.number().int().min(0),
        factId: z.string(),
      }),
    )
    .max(2),
  banter: z.strictObject({
    tone: z.enum(["self_roast", "savage", "wholesome"]),
    headline: z.string().min(1).max(80),
    body: z.string().min(1).max(220),
    shareText: z.string().min(1).max(280),
  }),
});
type BailoutOutput = z.infer<typeof BailoutOutputSchema>;

function guard(out: BailoutOutput, facts: BailoutSkillFacts): GuardResult {
  const { questWindow: qw, atCrease, grounded } = facts.bailout;
  const range = `${qw.fromLegalBall}-${qw.toLegalBall}`;
  for (const [index, prediction] of out.predictions.entries()) {
    const n = `prediction ${index + 1}`;
    const rule = toQuestRule(prediction.rule);
    if (!rule) return { ok: false, reason: `${n} is not a valid quest rule` };
    if (rule.innings !== qw.innings) {
      return { ok: false, reason: `${n} is about innings ${rule.innings}, not ${qw.innings}` };
    }
    const { from, to } = span(rule);
    if (from < qw.fromLegalBall) {
      return {
        ok: false,
        reason: `${n} starts at legal ball ${from}, before the quest window (${range})`,
      };
    }
    if (to > qw.toLegalBall) {
      return {
        ok: false,
        reason: `${n} ends at legal ball ${to}, after the quest window (${range})`,
      };
    }
    if (rule.type === "batter_runs_by") {
      const batter = atCrease.find((b) => b.playerId === rule.playerId);
      if (!batter)
        return { ok: false, reason: `${n} names ${rule.playerId}, who is not at the crease` };
      const decided = rule.op === "gte" ? batter.runs >= rule.value : batter.runs > rule.value;
      if (decided) {
        return {
          ok: false,
          reason: `${n} is already decided: ${batter.displayName} has ${batter.runs}`,
        };
      }
    }
    if (prediction.options.length !== 2) {
      return {
        ok: false,
        reason: `${n} needs exactly two options: the rule comes true, or it does not`,
      };
    }
    if (new Set(prediction.options.map((o) => o.id)).size !== prediction.options.length) {
      return { ok: false, reason: `${n} repeats an option id` };
    }
  }
  const factIds = new Set(grounded.map((f) => f.id));
  for (const [index, question] of out.trivia.entries()) {
    const n = `trivia ${index + 1}`;
    if (!factIds.has(question.factId)) {
      return { ok: false, reason: `${n} cites ${question.factId}, which is not one of the facts` };
    }
    if (question.answerIndex >= question.options.length) {
      return { ok: false, reason: `${n}'s answer is not one of its options` };
    }
  }
  return { ok: true };
}

type Prediction = BailoutPayload["quest"]["predictions"][number];

function payloadOf(
  facts: BailoutSkillFacts,
  title: string,
  predictions: Omit<Prediction, "id" | "rewardBucks">[],
  trivia: BailoutPayload["trivia"],
  banter: BailoutPayload["banter"],
): BailoutPayload {
  const b = facts.bailout;
  return {
    trigger: {
      playerId: b.dismissal.batter.playerId,
      role: b.armband,
      runs: b.dismissal.runs,
      balls: b.dismissal.balls,
      label: b.label,
      eventId: b.eventId,
    },
    projectedBefore: facts.projection.before,
    projectedAfter: facts.projection.after,
    quest: {
      title: clip(title, 80),
      windowFromLabel: b.questWindow.fromLabel,
      windowToLabel: b.questWindow.toLabel,
      predictions: predictions.map((p, index) => ({
        ...p,
        id: `p${index + 1}`,
        rewardBucks: QUEST_REWARD_BUCKS,
      })),
    },
    trivia,
    banter,
  };
}

const factText = (facts: BailoutSkillFacts, id: string) =>
  clip(facts.bailout.grounded.find((f) => f.id === id)?.text ?? id, 200);

/** Common ways out, for the template trivia's other options (the real one is always included). */
const DISMISSALS = ["bowled", "caught", "lbw", "run out", "stumped"];

/**
 * The labelled template quest, from the same facts: a wicket and a boundary in the window (rules the
 * engine settles like any other), one trivia question on how the batter went out, and plain banter.
 */
function fallback(facts: BailoutSkillFacts): BailoutPayload {
  const b = facts.bailout;
  const qw = b.questWindow;
  const window = {
    innings: qw.innings,
    fromLegalBall: qw.fromLegalBall,
    toLegalBall: qw.toLegalBall,
  };
  const stretch = `between ${qw.fromLabel} and ${qw.toLabel}`;
  const batter = b.dismissal.batter.displayName;
  const kind = b.dismissal.kind;
  const options = [kind, ...DISMISSALS.filter((k) => k !== kind).slice(0, 2)].sort();
  const role = b.armband === "C" ? "captain" : "vice-captain";
  const bowling = teamName(facts.teams, b.situation.bowlingTeam);
  return payloadOf(
    facts,
    `Comeback quest: ${qw.fromLabel} to ${qw.toLabel}`,
    [
      {
        prompt: clip(`Another wicket for ${bowling} ${stretch}?`, 120),
        options: [
          { id: "yes", label: "Yes, another wicket" },
          { id: "no", label: "No wicket" },
        ],
        rule: { type: "wicket_in_window", ...window },
      },
      {
        prompt: clip(`A four or a six ${stretch}?`, 120),
        options: [
          { id: "yes", label: "Yes, a boundary" },
          { id: "no", label: "No boundary" },
        ],
        rule: { type: "boundary_in_window", ...window, boundary: "any" },
      },
    ],
    [
      {
        question: clip(`How was ${batter} out?`, 160),
        options,
        answerIndex: options.indexOf(kind),
        fact: factText(facts, "dismissal"),
      },
    ],
    {
      tone: "wholesome",
      headline: clip(`${batter} out for ${b.dismissal.runs}`, 80),
      body: clip(
        `Your ${role} is out: ${b.dismissal.scorecard}. The quest runs ${stretch}, ${plural(qw.toLegalBall - qw.fromLegalBall + 1, "ball")}: call it right for simulated DreamBucks.`,
        220,
      ),
      shareText: clip(
        `${batter} out for ${b.dismissal.runs} (${b.dismissal.balls}) and my fantasy team felt it. Playing the comeback quest on Sideline.`,
        280,
      ),
    },
  );
}

const SYSTEM = [
  "You write a comeback quest for a fantasy cricket fan whose captain or vice-captain has just been dismissed cheaply, early in an innings.",
  "<facts> holds the wicket, the situation, the batter still at the crease, the bowler, the quest window and numbered facts. Use only these facts; never mention anything that happens later, even if you recognise the match.",
  "Write 1 to 3 yes-or-no predictions about the quest window. Each has a prompt (at most 120 characters), exactly two options (the first if the rule comes true, the second if not; ids of at most 8 characters, labels of at most 60) and a rule the app settles from the real deliveries.",
  "A rule has a type and an innings, with every other field null unless its type uses it. Legal balls count from 1 within the innings, and every rule must lie inside questWindow (fromLegalBall to toLegalBall):",
  'wicket_in_window: fromLegalBall, toLegalBall. boundary_in_window: fromLegalBall, toLegalBall, boundary "4", "6" or "any". dots_in_window: fromLegalBall, toLegalBall, op "gte" or "lte", value (balls with nothing off the bat). runs_in_over: over (0-based, the whole over inside the window), op, value (team runs in it). batter_runs_by: playerId of a batter in atCrease, byLegalBall, op, value (their innings total), not already decided.',
  "Write up to 2 trivia questions, each about one of the numbered facts: its factId, 2 to 4 options and answerIndex (0-based) of the right one.",
  "Write banter for a card the fan can share with their friends' league: a tone (self_roast, savage or wholesome), a headline (at most 80 characters), a body (at most 220) and shareText (at most 280). Keep it kind about the players.",
  "Return JSON matching the schema.",
].join("\n");

function promptView(facts: BailoutSkillFacts) {
  const b = facts.bailout;
  const name = (code: string) => teamName(facts.teams, code);
  const s = b.situation;
  return {
    wicket: {
      ball: b.label,
      innings: b.innings,
      batter: b.dismissal.batter.displayName,
      team: name(b.dismissal.batter.team),
      runs: b.dismissal.runs,
      balls: b.dismissal.balls,
      how: b.dismissal.kind,
      bowler: b.dismissal.bowler?.displayName ?? null,
      fielders: b.dismissal.fielders.map((f) => f.displayName),
      scorecard: b.dismissal.scorecard,
      commentary: b.dismissal.description,
    },
    fanLost: b.armband === "C" ? "their captain (points x2)" : "their vice-captain (points x1.5)",
    situation: {
      battingTeam: name(s.battingTeam),
      bowlingTeam: name(s.bowlingTeam),
      score: s.score,
      overs: s.overs,
      target: s.target,
      runsRequired: s.runsRequired,
      ballsRemaining: s.ballsRemaining,
      requiredRunRate: s.rrr,
      currentRunRate: s.crr,
    },
    atCrease: b.atCrease.map((a) => ({
      playerId: a.playerId,
      name: a.displayName,
      runs: a.runs,
      balls: a.balls,
    })),
    bowler: {
      name: b.bowler.displayName,
      overs: b.bowler.overs,
      runsConceded: b.bowler.runsConceded,
      wickets: b.bowler.wickets,
    },
    questWindow: b.questWindow,
    facts: b.grounded,
  };
}

export const bailoutSkill: Skill<BailoutSkillFacts, BailoutOutput, BailoutPayload> = {
  name: "bailout",
  promptVersion: "bailout-v1",
  tier: "smart",
  effort: "medium",
  maxTokens: 8000,
  // Not deadline-bound: the quest's window starts after the wicket, so a slow answer still lands in time.
  timeoutMs: () => 30_000,
  outputSchema: BailoutOutputSchema,
  buildPrompt: (facts) => ({
    system: SYSTEM,
    user: `<facts>\n${JSON.stringify(promptView(facts))}\n</facts>`,
  }),
  guard,
  toPayload: (out, facts) =>
    payloadOf(
      facts,
      out.title,
      out.predictions.map((p) => ({
        prompt: p.prompt,
        options: p.options,
        rule: toQuestRule(p.rule) as QuestRule,
      })),
      out.trivia.map((q) => ({
        question: q.question,
        options: q.options,
        answerIndex: q.answerIndex,
        fact: factText(facts, q.factId),
      })),
      out.banter,
    ),
  fallback,
};
