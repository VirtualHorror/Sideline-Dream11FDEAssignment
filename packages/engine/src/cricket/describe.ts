/**
 * One-line commentary for a delivery ("18.5 Rauf to Kohli, six") and tags for styling it.
 *
 * Callers: the detectors' facts (nudge outcomes, catch-up swings, bailout dismissals), the
 * synthetic crowd (which reaction a ball deserves) and, from Task 6, the commentary strip. Every
 * name comes from players.json through `players`; the words around them are fixed cricket
 * vocabulary. This is deterministic text, never presented as AI output.
 */
import type { DeliveryEvent, Wicket } from "../contracts/events.ts";
import type { Player } from "../contracts/match.ts";

export type DeliveryTag =
  | "dot"
  | "single"
  | "four"
  | "six"
  | "wicket"
  | "wide"
  | "noball"
  | "freehit"
  | "byes";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** How a batter got out, in commentary words ("caught by Babar", "lbw"). */
function howOut(wicket: Wicket, name: (id: string) => string): string {
  const fielders = wicket.fielders.map(name);
  switch (wicket.kind) {
    case "caught":
      return fielders.length > 0 ? `caught by ${fielders[0]}` : "caught";
    case "stumped":
      return fielders.length > 0 ? `stumped by ${fielders[0]}` : "stumped";
    case "run out":
      return fielders.length > 0 ? `run out by ${joinNames(fielders)}` : "run out";
    default:
      return wicket.kind;
  }
}

/**
 * Commentary text and tags. Tags follow the declaration order of `DeliveryTag`: "dot" is a legal
 * ball with nothing scored and no wicket, "single" one run off the bat and nothing else, "byes"
 * covers byes and leg byes, and "wicket" a team wicket (retired hurt is not one, DOMAIN §2).
 */
export function describeDelivery(
  event: DeliveryEvent,
  players: ReadonlyMap<string, Player>,
): { text: string; tags: DeliveryTag[] } {
  const name = (id: string) => players.get(id)?.shortName ?? id;
  const { extras, runs } = event;
  const teamWicket = event.wickets.some((wicket) => wicket.kind !== "retired hurt");
  const strikerOut = event.wickets.some(
    (wicket) => wicket.kind !== "retired hurt" && wicket.playerOut === event.batter,
  );

  const parts: string[] = [];
  if (extras.wides > 0) parts.push(extras.wides === 1 ? "wide" : plural(extras.wides, "wide"));
  if (extras.noballs > 0) parts.push("no-ball");
  if (event.boundary === 6) parts.push("six");
  else if (event.boundary === 4) parts.push("four");
  else if (runs.batter > 0) parts.push(plural(runs.batter, "run"));
  if (extras.byes > 0) parts.push(plural(extras.byes, "bye"));
  if (extras.legbyes > 0) parts.push(plural(extras.legbyes, "leg bye"));
  if (extras.penalty > 0) parts.push(plural(extras.penalty, "penalty run"));
  if (parts.length === 0 && !strikerOut) parts.push("no run");
  for (const wicket of event.wickets) {
    if (wicket.kind === "retired hurt") parts.push(`${name(wicket.playerOut)} retired hurt`);
    else if (wicket.playerOut === event.batter) parts.push(`OUT, ${howOut(wicket, name)}`);
    else parts.push(`${name(wicket.playerOut)} ${howOut(wicket, name)}`);
  }

  const tags: DeliveryTag[] = [];
  if (event.isLegal && runs.total === 0 && !teamWicket) tags.push("dot");
  if (runs.total === 1 && runs.batter === 1) tags.push("single");
  if (event.boundary === 4) tags.push("four");
  if (event.boundary === 6) tags.push("six");
  if (teamWicket) tags.push("wicket");
  if (extras.wides > 0) tags.push("wide");
  if (extras.noballs > 0) tags.push("noball");
  if (event.isFreeHit) tags.push("freehit");
  if (extras.byes > 0 || extras.legbyes > 0) tags.push("byes");

  const freeHit = event.isFreeHit ? " (free hit)" : "";
  const text = `${event.label} ${name(event.bowler)} to ${name(event.batter)}, ${parts.join(", ")}${freeHit}`;
  return { text, tags };
}
