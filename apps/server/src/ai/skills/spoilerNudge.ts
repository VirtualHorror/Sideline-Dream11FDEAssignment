/**
 * Phase 4, "Hold the Spoiler": a spoiler-free teaser for a big ball the fan's delayed stream has
 * not shown yet (thesis 2: the broadcast delay is the AI's latency budget).
 *
 * Callers: the orchestrator, for every `spoiler_nudge` trigger; the moment key is shared per
 * delivery (`nudge:<match>:<eventId>`), so one call serves every fan. The model sees only what is
 * known before the ball (`NudgeFacts.before`, the ball's label, team names and the pre-ball win
 * chance): never the outcome, never why the ball was flagged (D-054, Nabhanyu: outcomes are never
 * passed to teaser prompts). It cannot spoil what it was not told, and spoilerLint checks anyway.
 * The model writes only the teaser; the reveal is the deterministic commentary line and score from
 * the facts, shown once the fan's TV reaches the ball.
 */
import type { NudgeFacts, SpoilerNudgePayload } from "@sideline/engine";
import { z } from "zod";
import { spoilerLint } from "../guards/spoilerLint.ts";
import { clip, percent, situationLine, type TeamName, teamName } from "./format.ts";
import type { Skill } from "./types.ts";

export interface TeaserFacts {
  nudge: NudgeFacts;
  teams: readonly TeamName[];
}

/** The payload before the session adds its own timing (budgetMs, usedMs). */
export type TeaserPayload = Omit<SpoilerNudgePayload, "budgetMs" | "usedMs">;

const TeaserOutputSchema = z.strictObject({ nudge: z.string().min(1).max(160) });
type TeaserOutput = z.infer<typeof TeaserOutputSchema>;

/** The configured endpoint answers in 4-8.5 s (D-033): at most 15 s, never less than 9 s. */
export const TEASER_MAX_TIMEOUT_MS = 15_000;
export const TEASER_MIN_TIMEOUT_MS = 9_000;
/** The teaser should be ready a second before the fan's TV reaches the nudge time. */
const READY_MARGIN_MS = 1_000;

const SYSTEM = [
  "You write one teaser line for a cricket fan whose stream runs behind the live ball.",
  "The next delivery is a big moment. <facts> holds only what is known before it is bowled.",
  "Write one line of at most 140 characters that builds anticipation for that next ball, using only those facts.",
  "Never state or guess what happens on the ball: no runs scored, no boundary, no dismissal, no score after the ball, no result, and never say that this ball decides the match.",
  "Do not use the words six, sixes, four runs, boundary, out, wicket, caught, bowled, stumped, lbw, run out, gone, won, wins, lost, loses, maximum, century, fifty or dropped.",
  "If you recognise the match, ignore anything you remember about it.",
  'Return JSON: {"nudge": "<your line>"}.',
].join("\n");

/** The facts the model may see: the ball's label and the pre-ball state, nothing after it. */
function preBallView(facts: TeaserFacts) {
  const { before, label } = facts.nudge;
  const s = before.situation;
  const name = (code: string) => teamName(facts.teams, code);
  return {
    nextBall: label,
    innings: s.innings,
    battingTeam: name(s.battingTeam),
    bowlingTeam: name(s.bowlingTeam),
    score: s.score,
    overs: s.overs,
    ...(s.target === null
      ? { ballsLeftInInnings: s.ballsRemaining }
      : {
          target: s.target,
          runsRequired: s.runsRequired,
          ballsRemaining: s.ballsRemaining,
          requiredRunRate: s.rrr,
        }),
    currentRunRate: s.crr,
    striker: {
      name: before.striker.displayName,
      runs: before.striker.runs,
      balls: before.striker.balls,
    },
    nonStriker: {
      name: before.nonStriker.displayName,
      runs: before.nonStriker.runs,
      balls: before.nonStriker.balls,
    },
    bowler: {
      name: before.bowler.displayName,
      overs: before.bowler.overs,
      runsConceded: before.bowler.runsConceded,
      wickets: before.bowler.wickets,
    },
    freeHit: before.freeHit,
    battingSideWinChancePercent: percent(facts.nudge.leverage.wpBefore),
  };
}

/** What happened, for the reveal: the commentary line and where the innings stands after it. */
function revealLine(facts: TeaserFacts): string {
  const { outcome } = facts.nudge;
  return clip(`${outcome.description}. ${situationLine(outcome.situation, facts.teams)}`, 200);
}

/** The labelled template: the pre-ball situation and the duel, built from the same facts. */
function templateNudge(facts: TeaserFacts): string {
  const { before } = facts.nudge;
  const s = before.situation;
  const batting = teamName(facts.teams, s.battingTeam);
  const lead =
    s.runsRequired !== null && s.runsRequired > 0
      ? `${batting} need ${s.runsRequired} off ${s.ballsRemaining}.`
      : `${batting} ${s.score} after ${s.overs} overs.`;
  const duel = `${before.striker.shortName} (${before.striker.runs} off ${before.striker.balls}) faces ${before.bowler.shortName}.`;
  return clip(`${lead} ${duel}${before.freeHit ? " Free hit." : ""}`, 160);
}

export const teaserSkill: Skill<TeaserFacts, TeaserOutput, TeaserPayload> = {
  name: "spoiler_nudge",
  promptVersion: "teaser-v1",
  tier: "fast",
  effort: "low",
  // A cap, not a spend: reasoning models count their thinking against it.
  maxTokens: 4000,
  timeoutMs: (_facts, deadlineMs) =>
    deadlineMs === null
      ? TEASER_MAX_TIMEOUT_MS
      : Math.min(
          TEASER_MAX_TIMEOUT_MS,
          Math.max(deadlineMs - READY_MARGIN_MS, TEASER_MIN_TIMEOUT_MS),
        ),
  outputSchema: TeaserOutputSchema,
  buildPrompt: (facts) => ({
    system: SYSTEM,
    user: `<facts>\n${JSON.stringify(preBallView(facts))}\n</facts>`,
  }),
  guard: (out, facts) => spoilerLint(out.nudge, facts.nudge),
  toPayload: (out, facts) => ({
    eventId: facts.nudge.eventId,
    nudge: out.nudge,
    reveal: revealLine(facts),
    leverage: facts.nudge.leverage.value,
  }),
  fallback: (facts) => ({
    eventId: facts.nudge.eventId,
    nudge: templateNudge(facts),
    reveal: revealLine(facts),
    leverage: facts.nudge.leverage.value,
  }),
};
