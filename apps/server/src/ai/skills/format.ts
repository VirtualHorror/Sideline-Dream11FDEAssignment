/**
 * Small text helpers shared by the skills' prompts and labelled fallback templates.
 *
 * Callers: skills/{spoilerNudge,catchUp,explainer}.ts. Everything here formats facts the engine
 * computed (names come from players.json and the match context, numbers from the state); nothing
 * here knows a match.
 */
import type { Lens, Situation } from "@sideline/engine";

/** A team's code and display name, from the match context (facts carry codes only). */
export interface TeamName {
  code: string;
  name: string;
}

export function teamName(teams: readonly TeamName[], code: string): string {
  return teams.find((team) => team.code === code)?.name ?? code;
}

/** Shortens to `max` characters with an ellipsis; schema limits are never exceeded. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export const percent = (p: number): number => Math.round(p * 100);

/** "1 ball", "4 balls": a count with its noun, for the labelled fallback templates. */
export const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Where an innings stands in one line: "<team> 90/4, need 70 off 36" in a live chase, the score
 * after N overs in a first innings, and how a finished chase ended.
 */
export function situationLine(s: Situation, teams: readonly TeamName[]): string {
  const team = teamName(teams, s.battingTeam);
  if (s.target === null || s.runsRequired === null)
    return `${team} ${s.score} after ${s.overs} overs`;
  if (s.runsRequired === 0) return `${team} ${s.score}: target reached`;
  if (s.ballsRemaining === 0 || s.wickets >= 10) {
    // Ending one run short of the target is a tie; the margin is the runs still needed less one.
    const margin = s.runsRequired - 1;
    return margin === 0
      ? `${team} ${s.score}: scores level`
      : `${team} ${s.score}, ${margin} short`;
  }
  return `${team} ${s.score}, need ${s.runsRequired} off ${s.ballsRemaining}`;
}

/** How each lens asks the model to explain (the UI calls `engineer` "Systems", D-032). */
export const LENS_INSTRUCTIONS: Readonly<Record<Lens, string>> = {
  casual:
    "Write for a casual fan in plain English, with no jargon; explain any cricket term in a few words.",
  analyst:
    "Write for a tactically minded fan: lead with the numbers (run rates, the required rate, matchups, phases of the innings).",
  f1: "Write for a Formula 1 fan who is new to cricket: explain through F1 analogies (race pace against the pace needed, stints, tyre wear, closing a gap), keeping every cricket fact exact.",
  football:
    "Write for a football fan who is new to cricket: explain through football analogies (game state, chasing a deficit, pressure late in a match), keeping every cricket fact exact.",
  engineer:
    "Write for an engineer: describe the match as a system under load (throughput is the run rate, the backlog is the runs required, capacity is the balls and wickets left, incidents are wickets), keeping every cricket fact exact.",
};
