/**
 * Win probability from the live match state, using the logistic models in
 * data/models/winprob-v1.json (trained by scripts/build-models.ts on real men's T20Is, D-024).
 *
 * Callers: models/leverage.ts (swing per delivery), scripts/build-models.ts (training features and
 * test metrics), and from Task 4 the detectors, server and client. The model file is passed in as
 * data, so this module stays pure. Feature formulas are PLAN Task 3's, fixed: training and live
 * prediction call the same two functions below, so they cannot drift apart.
 */
import { z } from "zod";
import { MatchIdSchema } from "../contracts/primitives.ts";
import type { InningsState, MatchState } from "../contracts/state.ts";
import { predictLogistic } from "./logistic.ts";

/** A T20 side has ten wickets; the innings ends when they are all gone. */
const WICKETS_PER_INNINGS = 10;

/** Names stored beside the weights in the model file, in feature order. */
export const CHASE_FEATURE_NAMES = [
  "bias",
  "rpb",
  "w",
  "b",
  "rpb*w",
  "log1p(runsNeeded)/log(250)",
] as const;
export const FIRST_INNINGS_FEATURE_NAMES = ["bias", "r", "wl", "bb", "r*bb", "wl*bb"] as const;

/**
 * Chase features: required runs per ball (capped at 6 and scaled to 0-1), wickets in hand and balls
 * left as fractions, their interaction, and a log term for the size of the task. Only defined for a
 * live chase (runsNeeded ≥ 1, ballsLeft ≥ 1); terminal states are decided in winProbability.
 */
export function chaseFeatures(
  runsNeeded: number,
  ballsLeft: number,
  wicketsLeft: number,
): number[] {
  const rpb = Math.min(runsNeeded / ballsLeft, 6) / 6;
  const w = wicketsLeft / WICKETS_PER_INNINGS;
  const b = ballsLeft / 120;
  return [1, rpb, w, b, rpb * w, Math.log1p(runsNeeded) / Math.log(250)];
}

/** First-innings features: runs (scaled by a typical 160), wickets lost and balls bowled, with interactions. */
export function firstInningsFeatures(
  runs: number,
  wicketsLost: number,
  ballsBowled: number,
): number[] {
  const r = runs / 160;
  const wl = wicketsLost / WICKETS_PER_INNINGS;
  const bb = ballsBowled / 120;
  return [1, r, wl, bb, r * bb, wl * bb];
}

/**
 * One logistic model in the file. Its feature names must be exactly the ones the code computes, in
 * the same order: a model trained on other features would otherwise give wrong probabilities
 * without any error.
 */
const logisticModelSchema = (names: readonly string[]) =>
  z
    .object({ features: z.array(z.string()), weights: z.array(z.number()) })
    .refine(
      (model) =>
        model.features.length === names.length &&
        model.features.every((feature, index) => feature === names[index]),
      { message: `features must be exactly ${names.join(", ")}`, path: ["features"] },
    )
    .refine((model) => model.weights.length === names.length, {
      message: "a model needs one weight per feature",
      path: ["weights"],
    });

const MetricsSchema = z.object({
  brierTest: z.number().nonnegative(),
  logLossTest: z.number().nonnegative(),
  /** Ten equal-width bins of predicted probability: `bin` i covers [i/10, (i+1)/10); empty bins are omitted. */
  calibration: z.array(
    z.object({
      bin: z.number().int().min(0).max(9),
      predicted: z.number().min(0).max(1),
      observed: z.number().min(0).max(1),
      n: z.number().int().positive(),
    }),
  ),
});

export const WinProbModelSchema = z.object({
  version: z.string().min(1),
  trainedOn: z.object({
    source: z.url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    retrievedAt: z.iso.date(),
    nMatches: z.number().int().positive(),
    nTrainStates: z.number().int().positive(),
    nTestStates: z.number().int().positive(),
    /** Demo matches and archive matches the engine rejects (BUG-002); reasons are in data/models/README.md. */
    excludedMatchIds: z.array(MatchIdSchema),
  }),
  chase: logisticModelSchema(CHASE_FEATURE_NAMES),
  firstInnings: logisticModelSchema(FIRST_INNINGS_FEATURE_NAMES),
  metrics: z.object({ chase: MetricsSchema, firstInnings: MetricsSchema }),
  leverage: z.object({
    weights: z.object({
      swing: z.number(),
      wicket: z.number(),
      six: z.number(),
      four: z.number(),
      noball: z.number(),
      freeHit: z.number(),
    }),
    /** Leverage at or above this marks a "big ball" (the test split's `percentile` of legal balls). */
    nudgeThreshold: z.number().min(0).max(1),
    percentile: z.number().gt(0).lt(1),
  }),
});
export type WinProbModel = z.infer<typeof WinProbModelSchema>;

export interface WinProbability {
  battingTeam: string;
  bowlingTeam: string;
  pBattingTeamWins: number;
}

function chaseProbability(innings: InningsState, model: WinProbModel): number | null {
  if (!innings.target) return null;
  const runsNeeded = innings.target.runs - innings.runs;
  const ballsLeft = innings.target.balls - innings.legalBalls;
  const wicketsLeft = WICKETS_PER_INNINGS - innings.wickets;
  // Terminal chases are decided by the rules, not the model (scripts/build-models.ts skips the same
  // states when it trains): target reached, or all out / out of balls, where level scores tie.
  if (runsNeeded <= 0) return 1;
  if (wicketsLeft <= 0 || ballsLeft <= 0) return runsNeeded === 1 ? 0.5 : 0;
  return predictLogistic(model.chase.weights, chaseFeatures(runsNeeded, ballsLeft, wicketsLeft));
}

/**
 * P(the side batting in the latest innings wins). Null before the first innings starts. During the
 * first innings, and at the break, the first-innings model reads the score so far; from the second
 * innings' start the chase model (or the terminal rules) takes over.
 */
export function winProbability(state: MatchState, model: WinProbModel): WinProbability | null {
  const innings = state.innings.at(-1);
  if (!innings) return null;
  const pBattingTeamWins =
    innings.innings === 1
      ? predictLogistic(
          model.firstInnings.weights,
          firstInningsFeatures(innings.runs, innings.wickets, innings.legalBalls),
        )
      : chaseProbability(innings, model);
  if (pBattingTeamWins === null) return null;
  return { battingTeam: innings.battingTeam, bowlingTeam: innings.bowlingTeam, pBattingTeamWins };
}
