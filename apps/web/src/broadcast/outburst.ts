/**
 * Which moments earn the floodlight outburst and the ghost-text headline (VISUAL_REFERENCES.md,
 * "one spectacle at a time"): a delivery the gate flagged as a big ball (it has a spoiler teaser:
 * leverage at or above the model's threshold, or the ball that decided the match, D-046), and the
 * result. Everything else stays calm, however loud it was.
 *
 * Caller: broadcast/TvPane.tsx, only for events newly released on the fan's TV clock during play,
 * never on a snapshot (a seek is not a moment) and never at stadium time (the light would spoil it).
 * Colours carry meaning: a six is gold mixed with the batting side's colour, a wicket the bowling
 * side's, the result the winner's (and lasts longer).
 */
import {
  type DeliveryTag,
  describeDelivery,
  type MatchEvent,
  type Moment,
  type Player,
  type Team,
} from "@sideline/engine";

export interface Outburst {
  eventId: string;
  kind: "six" | "wicket" | "four" | "big" | "result";
  /** A CSS colour for FloodlightGlow's burst. */
  color: string;
  strength: number;
  /** One or two words for the GhostText headline. */
  headline: string;
  /** The commentary line or the result, under the headline. */
  line: string;
}

/** A neutral floodlight white for a big ball that was neither a boundary nor a wicket. */
const FLOODLIGHT_WHITE = "#dfe9ff";

const HEADLINES: [tag: DeliveryTag, word: string][] = [
  ["noball", "No-ball"],
  ["wide", "Wide"],
  ["byes", "Byes"],
  ["single", "Single"],
  ["dot", "Dot ball"],
];

export function outburstFor(
  event: MatchEvent,
  ctx: {
    moments: readonly Moment[];
    teams: readonly Team[];
    players: ReadonlyMap<string, Player>;
  },
): Outburst | null {
  const team = (code: string | null | undefined) => ctx.teams.find((t) => t.code === code);

  if (event.kind === "match_end") {
    const winner = team(event.winner);
    return {
      eventId: event.id,
      kind: "result",
      color: winner?.color ?? FLOODLIGHT_WHITE,
      strength: 1.6,
      headline: winner?.name ?? "Result",
      line: event.resultText,
    };
  }
  if (event.kind !== "delivery") return null;
  const flagged = ctx.moments.some(
    (m) => m.kind === "spoiler_nudge" && m.payload.eventId === event.id,
  );
  if (!flagged) return null;

  const { text, tags } = describeDelivery(event, ctx.players);
  const bowling = ctx.teams.find((t) => ctx.players.get(event.bowler)?.team === t.code);
  const batting = ctx.teams.find((t) => ctx.players.get(event.batter)?.team === t.code);
  const base = { eventId: event.id, strength: 1, line: text };
  if (tags.includes("wicket")) {
    return { ...base, kind: "wicket", headline: "Wicket", color: bowling?.color ?? "#ff5468" };
  }
  if (tags.includes("six")) {
    return {
      ...base,
      kind: "six",
      headline: "Six",
      color: `color-mix(in oklab, var(--six) 62%, ${batting?.color ?? "#ffc94a"})`,
    };
  }
  if (tags.includes("four")) {
    return {
      ...base,
      kind: "four",
      headline: "Four",
      color: `color-mix(in oklab, var(--four) 62%, ${batting?.color ?? "#69b9ec"})`,
    };
  }
  const word = HEADLINES.find(([tag]) => tags.includes(tag))?.[1];
  return {
    ...base,
    kind: "big",
    headline: word ?? `${event.runs.total} runs`,
    color: FLOODLIGHT_WHITE,
    strength: 0.8,
  };
}
