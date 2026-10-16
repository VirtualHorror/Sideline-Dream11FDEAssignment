/**
 * The synthetic watch-along crowd: chat messages generated from the match events, a seed and an
 * authored corpus (data/crowd/corpus.json). Every message is `synthetic: true`, and the UI labels
 * the crowd "Simulated crowd" (Task 6).
 *
 * Callers: the server session (Task 5) builds a crowd for its seed and releases it on the fan's
 * TV clock like any other event; the room detector reads it; tests check its shape. The demo
 * needs a lively room without real users, but nothing here pretends to be a real person: the
 * corpus holds placeholders such as `{batter}`, filled with names from players.json.
 *
 * Messages for an event depend only on the seed, that event and the state after it, never on later
 * events, so simulating a prefix of the timeline gives exactly the same messages for those events
 * (a session that seeks can re-simulate without the room changing under the fan).
 */
import { z } from "zod";
import type { ChatMessage } from "../contracts/chat.ts";
import type { DeliveryEvent, MatchEvent } from "../contracts/events.ts";
import type { Player } from "../contracts/match.ts";
import type { MatchState } from "../contracts/state.ts";
import { describeDelivery } from "../cricket/describe.ts";
import { applyEvent, createMatchState } from "../cricket/reducer.ts";
import { mulberry32, seedFrom } from "../util/prng.ts";

/** What a corpus line reacts to. Each event maps to one or more (see `triggersFor`). */
export const CROWD_TRIGGERS = [
  "ambient",
  "toss",
  "playing_xi",
  "innings_start",
  "dot",
  "runs",
  "four",
  "six",
  "wicket",
  "wide",
  "noball",
  "freehit",
  "over_end",
  "pressure",
  "innings_end",
  "match_end",
] as const;
export type CrowdTrigger = (typeof CROWD_TRIGGERS)[number];

/** A line's stance: what the room detector counts and clusters. */
export const CHAT_STANCES = [
  "pro-batting",
  "pro-bowling",
  "neutral",
  "tactics",
  "nerves",
  "banter",
  "celebration",
  "heartbreak",
] as const;

/** Placeholders a line may use; each is filled from the event and state, or the line is skipped. */
export const CHAT_PLACEHOLDERS = [
  "batter",
  "bowler",
  "nonStriker",
  "playerOut",
  "fielder",
  "catcher",
  "battingTeam",
  "bowlingTeam",
  "score",
  "runsRequired",
  "ballsRemaining",
  "tossWinner",
  "winner",
] as const;
type Placeholder = (typeof CHAT_PLACEHOLDERS)[number];

const TriggerSchema = z.enum(CROWD_TRIGGERS);
/** Triggers that happen before any innings, where only "any" lines make sense. */
const PRE_INNINGS: readonly CrowdTrigger[] = ["ambient", "toss", "playing_xi"];

const RateSchema = z
  .object({
    /** Messages per firing, drawn uniformly from min..max. */
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
    /** Reaction delays are exponential with this mean, capped at maxDelayMs. */
    meanDelayMs: z.number().int().positive(),
    maxDelayMs: z.number().int().positive(),
  })
  .refine((rate) => rate.min <= rate.max, { message: "min must not exceed max" });

const LineSchema = z.object({
  id: z.string().regex(/^[a-z_]+-\d{2,3}$/),
  trigger: TriggerSchema,
  stance: z.enum(CHAT_STANCES),
  /** Whose fan says it: the batting or bowling side, the winner or loser (match end), or anyone. */
  side: z.enum(["batting", "bowling", "winner", "loser", "any"]),
  lang: z.enum(["en", "hinglish", "hi"]),
  text: z.string().min(1).max(160),
});

export const CrowdCorpusSchema = z
  .object({
    version: z.literal(1),
    synthetic: z.literal(true),
    description: z.string().min(1),
    handles: z.array(z.string().regex(/^[a-z0-9_]{3,24}$/)).min(20),
    /** One rate per trigger (zod 4 enum-keyed records are exhaustive). */
    rates: z.record(TriggerSchema, RateSchema),
    lines: z.array(LineSchema).min(240),
  })
  .superRefine((corpus, ctx) => {
    const ids = new Set<string>();
    corpus.lines.forEach((line, index) => {
      if (ids.has(line.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate id ${line.id}`,
          path: ["lines", index],
        });
      }
      ids.add(line.id);
      for (const [, name] of line.text.matchAll(/\{(\w+)\}/g)) {
        if (!(CHAT_PLACEHOLDERS as readonly string[]).includes(name ?? "")) {
          ctx.addIssue({
            code: "custom",
            message: `unknown placeholder {${name}}`,
            path: ["lines", index, "text"],
          });
        }
      }
      const sided = line.side !== "any";
      if ((line.side === "winner" || line.side === "loser") && line.trigger !== "match_end") {
        ctx.addIssue({
          code: "custom",
          message: "winner/loser lines are for match_end",
          path: ["lines", index],
        });
      }
      if (sided && PRE_INNINGS.includes(line.trigger)) {
        ctx.addIssue({
          code: "custom",
          message: `${line.trigger} lines are side "any"`,
          path: ["lines", index],
        });
      }
    });
    for (const trigger of CROWD_TRIGGERS) {
      if (!corpus.lines.some((line) => line.trigger === trigger)) {
        ctx.addIssue({
          code: "custom",
          message: `no line for trigger ${trigger}`,
          path: ["lines"],
        });
      }
    }
  });
export type CrowdCorpus = z.infer<typeof CrowdCorpusSchema>;

/** Nobody reacts faster than this. */
const MIN_DELAY_MS = 500;
/** Death overs start at over index 15 (labels 15.1-19.6, DOMAIN §1): the chase gets tense. */
const DEATH_OVER = 15;

/** Which corpus triggers an event fires. A delivery has one main reaction plus extras. */
function triggersFor(event: MatchEvent, state: MatchState, index: ReadonlyMap<string, Player>) {
  switch (event.kind) {
    case "coverage_start":
    case "note":
      return ["ambient"] as CrowdTrigger[];
    case "toss":
      return ["toss"] as CrowdTrigger[];
    case "playing_xi":
      return ["playing_xi"] as CrowdTrigger[];
    case "innings_start":
      return ["innings_start"] as CrowdTrigger[];
    case "innings_end":
      // The second innings' end is the match end, which has its own reaction.
      return state.phase === "innings_break" ? (["innings_end"] as CrowdTrigger[]) : [];
    case "match_end":
      return ["match_end"] as CrowdTrigger[];
    case "delivery":
      return deliveryTriggers(event, state, index);
    default:
      return [];
  }
}

function deliveryTriggers(
  event: DeliveryEvent,
  state: MatchState,
  index: ReadonlyMap<string, Player>,
): CrowdTrigger[] {
  const { tags } = describeDelivery(event, index);
  const main: CrowdTrigger = tags.includes("wicket")
    ? "wicket"
    : tags.includes("six")
      ? "six"
      : tags.includes("four")
        ? "four"
        : tags.includes("noball")
          ? "noball"
          : tags.includes("wide")
            ? "wide"
            : tags.includes("dot")
              ? "dot"
              : "runs";
  const triggers: CrowdTrigger[] = [main];
  if (main !== "noball" && tags.includes("noball")) triggers.push("noball");
  if (state.live?.freeHitNext) triggers.push("freehit");
  if (event.isLegal && event.ballInOver === 6) triggers.push("over_end");
  const innings = state.innings.at(-1);
  const target = innings?.target;
  if (
    innings &&
    target &&
    event.over >= DEATH_OVER &&
    innings.runs < target.runs &&
    innings.wickets < 10 &&
    innings.legalBalls < target.balls
  ) {
    triggers.push("pressure");
  }
  triggers.push("ambient");
  return triggers;
}

/** Placeholder values (names from players.json, team codes, the score) and the sides' teams. */
function contextFor(event: MatchEvent, state: MatchState, index: ReadonlyMap<string, Player>) {
  const name = (id: string) => index.get(id)?.shortName ?? id;
  const vars: Partial<Record<Placeholder, string>> = {};
  const sides: Partial<Record<"batting" | "bowling" | "winner" | "loser", string>> = {};
  const innings = state.innings.at(-1);
  if (innings) {
    vars.battingTeam = sides.batting = innings.battingTeam;
    vars.bowlingTeam = sides.bowling = innings.bowlingTeam;
    vars.score = `${innings.runs}/${innings.wickets}`;
    if (innings.target && innings.runs < innings.target.runs) {
      vars.runsRequired = String(innings.target.runs - innings.runs);
      vars.ballsRemaining = String(innings.target.balls - innings.legalBalls);
    }
  }
  if (state.toss) vars.tossWinner = state.toss.winner;
  const teams = Object.keys(state.squads);
  if (event.kind === "match_end" && event.winner) {
    vars.winner = sides.winner = event.winner;
    const loser = teams.find((team) => team !== event.winner);
    if (loser) sides.loser = loser;
  }
  if (event.kind === "delivery") {
    vars.batter = name(event.batter);
    vars.bowler = name(event.bowler);
    vars.nonStriker = name(event.nonStriker);
    const wicket = event.wickets.find((w) => w.kind !== "retired hurt");
    if (wicket) {
      vars.playerOut = name(wicket.playerOut);
      const first = wicket.fielders[0];
      if (first) vars.fielder = name(first);
      if (wicket.kind === "caught" && first) vars.catcher = name(first);
      if (wicket.kind === "caught and bowled") vars.catcher = name(event.bowler);
    }
  }
  return { vars, sides, teams };
}

/** The line with every placeholder filled, or null if one has no value for this event. */
function fill(text: string, vars: Partial<Record<Placeholder, string>>): string | null {
  let missing = false;
  const filled = text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = vars[key as Placeholder];
    if (value === undefined) missing = true;
    return value ?? "";
  });
  return missing ? null : filled;
}

/**
 * The crowd's messages for `events` (a timeline from its first event; a prefix is fine), sorted by
 * stadium time. Each event draws from its own generator, seeded with `seed` and the event id.
 */
export function simulateCrowd(input: {
  events: readonly MatchEvent[];
  players: readonly Player[];
  corpus: CrowdCorpus;
  seed: string;
}): ChatMessage[] {
  const { events, corpus, seed } = input;
  const index = new Map(input.players.map((player) => [player.id, player]));
  const state = createMatchState("");
  const messages: ChatMessage[] = [];
  for (const event of events) {
    applyEvent(state, event);
    const random = mulberry32(seedFrom(`${seed}|${event.id}`));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const { vars, sides, teams } = contextFor(event, state, index);
    let count = 0;
    for (const trigger of triggersFor(event, state, index)) {
      const rate = corpus.rates[trigger];
      const lines = corpus.lines.filter(
        (line) =>
          line.trigger === trigger &&
          (line.side === "any" || sides[line.side] !== undefined) &&
          fill(line.text, vars) !== null,
      );
      if (lines.length === 0) continue;
      const n = rate.min + Math.floor(random() * (rate.max - rate.min + 1));
      // Draw without replacement so one burst does not repeat a line (refill if it runs dry).
      const pool = [...lines];
      for (let i = 0; i < n; i += 1) {
        if (pool.length === 0) pool.push(...lines);
        const [line] = pool.splice(Math.floor(random() * pool.length), 1);
        if (!line) break;
        const delay = Math.min(
          rate.maxDelayMs,
          MIN_DELAY_MS + Math.floor(-Math.log(1 - random()) * rate.meanDelayMs),
        );
        const affinity =
          line.side === "any"
            ? teams.length === 2
              ? pick([...teams, "neutral"])
              : "neutral"
            : (sides[line.side] ?? "neutral");
        messages.push({
          id: `${event.id}:c${count}`,
          t: event.t + delay,
          handle: pick(corpus.handles),
          affinity,
          text: fill(line.text, vars) ?? line.text,
          lang: line.lang,
          stance: line.stance,
          synthetic: true,
          fromYou: false,
        });
        count += 1;
      }
    }
  }
  return messages.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
