/**
 * Phase 3, "Catch Me Up": a short reel for a fan who joined late or skipped ahead, told in their
 * lens from facts the engine computed (`buildCatchUpFacts`).
 *
 * Callers: the orchestrator, when a session starts at a join point or jumps past at least 12 legal
 * balls it never saw. The key is shared per window and lens (`catchUpKey`, D-015), so the squad
 * impact, which is the fan's own (D-045), is dropped before the prompt (Constraint 11): the UI
 * renders it beside the reel. Slides may cite only deliveries inside the missed window
 * (guards/citations.ts); the model writes the story, the engine owns the numbers.
 */
import type { CatchUpFacts, CatchUpPayload } from "@sideline/engine";
import { z } from "zod";
import { citationsGuard } from "../guards/citations.ts";
import {
  clip,
  LENS_INSTRUCTIONS,
  percent,
  plural,
  situationLine,
  type TeamName,
  teamName,
} from "./format.ts";
import type { Skill } from "./types.ts";

/** The facts every fan who missed this window, in this lens, shares. */
export type SharedCatchUpFacts = Omit<CatchUpFacts, "squadImpact">;

export interface CatchUpSkillFacts {
  catchUp: SharedCatchUpFacts;
  teams: readonly TeamName[];
}

/** Drops the per-session squad impact: the only way catch-up facts reach the skill. */
export function catchUpSkillFacts(
  facts: CatchUpFacts,
  teams: readonly TeamName[],
): CatchUpSkillFacts {
  const { squadImpact: _personal, ...shared } = facts;
  return { catchUp: shared, teams };
}

const SlideSchema = z.strictObject({
  kind: z.enum(["plot_twist", "turning_point", "anomaly", "watch_next"]),
  headline: z.string().min(1).max(80),
  body: z.string().min(1).max(280),
  citedEventIds: z.array(z.string()),
});
type Slide = z.infer<typeof SlideSchema>;
const CatchUpOutputSchema = z.strictObject({ slides: z.array(SlideSchema).min(2).max(5) });
type CatchUpOutput = z.infer<typeof CatchUpOutputSchema>;

const systemPrompt = (facts: CatchUpSkillFacts) =>
  [
    "You write a short catch-up reel for a cricket fan who has just come back to a live match and missed part of it.",
    "<facts> holds everything known about the overs they missed and where the match stands now. Use only these facts, and never mention anything that happens later, even if you recognise the match.",
    "Write 2 to 5 slides. Each slide has a kind (plot_twist, turning_point, anomaly or watch_next), a headline of at most 80 characters, a body of at most 280 characters, and citedEventIds: ids from window.deliveryIds of the deliveries the slide is about, or an empty list.",
    "At least one slide must be watch_next: what to watch for from now on.",
    LENS_INSTRUCTIONS[facts.catchUp.lens],
    "Return JSON matching the schema.",
  ].join("\n");

/** The window's batting side: the current innings', or the first innings' if the window is there. */
function windowBattingTeam(c: SharedCatchUpFacts): string {
  return c.window.innings === c.situation.innings
    ? c.situation.battingTeam
    : c.situation.bowlingTeam;
}

function promptView(facts: CatchUpSkillFacts) {
  const c = facts.catchUp;
  const name = (code: string) => teamName(facts.teams, code);
  const s = c.situation;
  return {
    window: {
      innings: c.window.innings,
      battingTeam: name(windowBattingTeam(c)),
      fromLabel: c.window.fromLabel,
      toLabel: c.window.toLabel,
      overNumbers: `${c.window.fromOver + 1}-${c.window.toOver}`,
      deliveryIds: c.window.deliveryIds,
    },
    previousInnings: c.previousInnings && {
      battingTeam: name(c.previousInnings.battingTeam),
      score: c.previousInnings.score,
      overs: c.previousInnings.overs,
      topBatters: c.previousInnings.topBatters.map((b) => ({
        name: b.displayName,
        runs: b.runs,
        balls: b.balls,
        out: b.out,
      })),
      topBowlers: c.previousInnings.topBowlers.map((b) => ({
        name: b.displayName,
        overs: b.overs,
        runsConceded: b.runsConceded,
        wickets: b.wickets,
      })),
    },
    overs: c.overs.map((o) => ({
      overNumber: o.over + 1,
      runs: o.runs,
      wickets: o.wickets,
      bowler: o.bowler.displayName,
    })),
    unusualOvers: c.anomalies.map((a) => ({
      overNumber: a.over + 1,
      runs: a.runs,
      standardDeviationsAboveAverage: a.z,
      bowler: a.bowler.displayName,
    })),
    longestScorelessSpell: c.longestRunless && {
      balls: c.longestRunless.balls,
      fromLabel: c.longestRunless.fromLabel,
      toLabel: c.longestRunless.toLabel,
      eventIds: [c.longestRunless.fromEventId, c.longestRunless.toEventId],
    },
    biggestWinChanceMoves: c.biggestSwings.map((m) => ({
      eventId: m.eventId,
      label: m.label,
      description: m.description,
      battingSideWinChanceBeforePercent: percent(m.wpBefore),
      battingSideWinChanceAfterPercent: percent(m.wpAfter),
    })),
    partnership: c.partnership && {
      batters: c.partnership.batters.map((b) => ({
        name: b.displayName,
        runs: b.runs,
        balls: b.balls,
      })),
      runs: c.partnership.runs,
      balls: c.partnership.balls,
    },
    now: {
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
    winChanceNow: c.winProbability && {
      team: name(c.winProbability.battingTeam),
      percent: percent(c.winProbability.pBattingTeamWins),
    },
  };
}

/** The labelled template reel: the same facts, in fixed sentences. */
function templateSlides(facts: CatchUpSkillFacts): Slide[] {
  const c = facts.catchUp;
  const name = (code: string) => teamName(facts.teams, code);
  const slides: Slide[] = [];
  const swing = c.biggestSwings[0];
  if (swing) {
    slides.push({
      kind: "turning_point",
      headline: clip(`The big moment: ${swing.label}`, 80),
      body: clip(
        `${swing.description}. ${name(windowBattingTeam(c))}'s win chance went from ${percent(swing.wpBefore)}% to ${percent(swing.wpAfter)}%.`,
        280,
      ),
      citedEventIds: [swing.eventId],
    });
  }
  const anomaly = c.anomalies[0];
  if (anomaly) {
    slides.push({
      kind: "anomaly",
      headline: clip(`Over ${anomaly.over + 1} cost ${plural(anomaly.runs, "run")}`, 80),
      body: clip(
        `${anomaly.bowler.displayName} went for ${anomaly.runs} in over ${anomaly.over + 1}, ${anomaly.z} standard deviations above the average over in this stretch.`,
        280,
      ),
      citedEventIds: [],
    });
  }
  const spell = c.longestRunless;
  if (spell) {
    // A one-ball spell starts and ends on the same ball: "From 15.1 to 15.1" read as a typo.
    const span =
      spell.balls === 1 ? `At ${spell.fromLabel}` : `From ${spell.fromLabel} to ${spell.toLabel}`;
    slides.push({
      kind: "plot_twist",
      headline: clip(`${plural(spell.balls, "ball")} without a run`, 80),
      body: clip(`${span}, nothing was scored.`, 280),
      citedEventIds: [spell.fromEventId, spell.toEventId],
    });
  }
  if (slides.length === 0) {
    const runs = c.overs.reduce((sum, o) => sum + o.runs, 0);
    const wickets = c.overs.reduce((sum, o) => sum + o.wickets, 0);
    slides.push({
      kind: "plot_twist",
      headline: clip(`${plural(c.overs.length, "over")} in brief`, 80),
      body: clip(
        `${plural(runs, "run")} and ${plural(wickets, "wicket")} from ${c.window.fromLabel} to ${c.window.toLabel}.`,
        280,
      ),
      citedEventIds: [],
    });
  }
  const s = c.situation;
  const pace =
    s.rrr !== null && s.runsRequired !== null && s.runsRequired > 0
      ? `Required rate ${s.rrr} an over, against ${s.crr} so far.`
      : `Run rate ${s.crr} an over.`;
  const stand = c.partnership
    ? `${c.partnership.batters.map((b) => b.shortName).join(" and ")} have added ${c.partnership.runs} off ${c.partnership.balls}.`
    : "";
  const chance = c.winProbability
    ? `Win chance for ${name(c.winProbability.battingTeam)}: ${percent(c.winProbability.pBattingTeamWins)}%.`
    : "";
  slides.push({
    kind: "watch_next",
    headline: clip(situationLine(s, facts.teams), 80),
    body: clip([pace, stand, chance].filter((part) => part !== "").join(" "), 280),
    citedEventIds: [],
  });
  return slides;
}

function payloadOf(facts: CatchUpSkillFacts, slides: Slide[]): CatchUpPayload {
  const c = facts.catchUp;
  return {
    innings: c.window.innings,
    fromLabel: c.window.fromLabel,
    toLabel: c.window.toLabel,
    lens: c.lens,
    situation: clip(situationLine(c.situation, facts.teams), 200),
    slides,
  };
}

export const catchUpSkill: Skill<CatchUpSkillFacts, CatchUpOutput, CatchUpPayload> = {
  name: "catch_up",
  promptVersion: "catchup-v1",
  tier: "smart",
  effort: "medium",
  maxTokens: 8000,
  // Not deadline-bound: the reel shows a thinking state (D-033) and arrives when it is ready.
  timeoutMs: () => 30_000,
  outputSchema: CatchUpOutputSchema,
  buildPrompt: (facts) => ({
    system: systemPrompt(facts),
    user: `<facts>\n${JSON.stringify(promptView(facts))}\n</facts>`,
  }),
  guard: (out, facts) => citationsGuard(out.slides, facts.catchUp.window.deliveryIds),
  toPayload: (out, facts) => payloadOf(facts, out.slides),
  fallback: (facts) => payloadOf(facts, templateSlides(facts)),
};
