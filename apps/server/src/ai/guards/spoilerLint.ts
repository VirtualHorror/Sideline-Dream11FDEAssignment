/**
 * The spoiler linter: rejects a teaser that states or implies what happened on the ball.
 *
 * Callers: skills/spoilerNudge.ts uses it as the teaser's guard (thesis 3: a teaser that fails it
 * is replaced by the labelled template). The teaser prompt never contains the outcome (D-054), so
 * this is defence in depth against a model guessing, or recognising a famous match.
 *
 * It rejects outcome statements, not ordinary words (PLAN Task 5): "Six balls, 16 to find" passes,
 * "a six" does not. Numbers are checked against what only the ball's result could give: the score
 * after the ball, the striker's runs after it and the runs still needed after it, each only when it
 * differs from the pre-ball value and is not itself a pre-ball number. Numbers written as words are
 * not checked; the phrase list catches the common outcome words.
 */
import type { NudgeFacts } from "@sideline/engine";
import type { GuardResult } from "../skills/types.ts";

const OUTCOME_STATEMENTS: readonly { name: string; pattern: RegExp }[] = [
  { name: "a six", pattern: /\b(?:a|another|massive|for)\s+six\b/i },
  { name: "sixes", pattern: /\bsixes\b/i },
  { name: "six!", pattern: /\bsix\s*!/i },
  { name: "four runs", pattern: /\bfour\s+runs\b/i },
  { name: "boundary", pattern: /\bboundar(?:y|ies)\b/i },
  { name: "is out", pattern: /(?:\bis|['’]s)\s+out\b/i },
  { name: "out for", pattern: /\bout\s+for\b/i },
  { name: "gone", pattern: /\bgone\b/i },
  { name: "wicket falls", pattern: /\bwicket\s+falls\b/i },
  { name: "bowled him", pattern: /\bbowled\s+(?:him|her|them)\b/i },
  { name: "caught", pattern: /\bcaught\b/i },
  { name: "stumped", pattern: /\bstumped\b/i },
  { name: "lbw", pattern: /\blbw\b/i },
  { name: "run out", pattern: /\brun[\s-]+out\b/i },
  { name: "won, wins, lost, loses", pattern: /\b(?:won|wins|lost|loses)\b/i },
  { name: "win it", pattern: /\bwins?\s+it\b/i },
  { name: "maximum", pattern: /\bmaximum\b/i },
  { name: "century", pattern: /\bcentury\b/i },
  { name: "fifty", pattern: /\bfifty\b/i },
  { name: "dropped", pattern: /\bdropped\b/i },
  // The ball that decides the match is a teaser too (D-046), and must not be announced as such.
  {
    name: "decides it",
    pattern: /\bdecid(?:e|es|ed|ing)\s+(?:it|the\s+(?:match|game|contest))\b/i,
  },
  { name: "seals it", pattern: /\bseal(?:s|ed)?\s+(?:it|the\s+(?:match|game|win))\b/i },
  { name: "match-winning", pattern: /\b(?:match|game)[\s-]+winn(?:er|ing)\b/i },
  { name: "winning runs", pattern: /\bwinning\s+(?:runs?|hit|shot|moment)\b/i },
];

/** Every number a fan already knows before the ball (the pre-ball facts). */
function preBallNumbers(before: NudgeFacts["before"]): Set<number> {
  const s = before.situation;
  const numbers = [
    s.runs,
    s.wickets,
    s.legalBalls,
    s.ballsRemaining,
    s.target,
    s.runsRequired,
    before.striker.runs,
    before.striker.balls,
    before.nonStriker.runs,
    before.nonStriker.balls,
    before.bowler.maidens,
    before.bowler.runsConceded,
    before.bowler.wickets,
  ];
  return new Set(numbers.filter((n): n is number => n !== null));
}

export function spoilerLint(text: string, facts: NudgeFacts): GuardResult {
  for (const { name, pattern } of OUTCOME_STATEMENTS) {
    if (pattern.test(text)) return { ok: false, reason: `outcome statement ("${name}")` };
  }
  const { before, outcome } = facts;
  const after = outcome.situation;
  if (after.score !== before.situation.score) {
    const score = new RegExp(
      `(?<!\\d)${after.runs}\\s*(?:/|-|for)\\s*${after.wickets}(?!\\d)`,
      "i",
    );
    if (score.test(text)) return { ok: false, reason: `the score after the ball (${after.score})` };
  }
  // The striker can have gained at most the ball's runs; any of those totals reveals the result.
  const afterOnly = new Set<number>();
  for (let gained = 1; gained <= outcome.runs; gained += 1) {
    afterOnly.add(before.striker.runs + gained);
  }
  if (after.runsRequired !== null && after.runsRequired !== before.situation.runsRequired) {
    afterOnly.add(after.runsRequired);
  }
  for (const known of preBallNumbers(before)) afterOnly.delete(known);
  for (const token of text.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!token.includes(".") && afterOnly.has(Number(token))) {
      return { ok: false, reason: `a number only the ball's result gives (${token})` };
    }
  }
  return { ok: true };
}
