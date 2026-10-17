/**
 * Real match data for the web tests, built by the engine from data/ exactly as the server builds its
 * bundles (apps/server/src/data/bundle.ts), so a stream fixture here is what a real session sends.
 * The files come in through Vite `?raw` imports: no Node APIs in the web project's type space.
 */
import {
  buildMatchSummary,
  buildTimeline,
  type ChatMessage,
  CrowdCorpusSchema,
  type DeliveryEvent,
  FantasyRulesSchema,
  MatchContextFileSchema,
  type MatchEvent,
  PersonasFileSchema,
  PlayersFileSchema,
  simulateCrowd,
  WinProbModelSchema,
} from "@sideline/engine";
import corpusText from "../../../../data/crowd/corpus.json?raw";
import contextText from "../../../../data/matches/1298150/context.json?raw";
import personasText from "../../../../data/matches/1298150/personas.json?raw";
import playersText from "../../../../data/matches/1298150/players.json?raw";
import winprobText from "../../../../data/models/winprob-v1.json?raw";
import rawText from "../../../../data/raw/cricsheet/1298150.json?raw";
import rulesText from "../../../../data/rules/t20-fantasy.json?raw";

export const MATCH_ID = "1298150";

const raw: unknown = JSON.parse(rawText);
const playersFile = PlayersFileSchema.parse(JSON.parse(playersText));
const context = MatchContextFileSchema.parse(JSON.parse(contextText));

export const players = playersFile.players;
export const personas = PersonasFileSchema.parse(JSON.parse(personasText)).personas;
export const rules = FantasyRulesSchema.parse(JSON.parse(rulesText));
export const winprob = WinProbModelSchema.parse(JSON.parse(winprobText));
export const summary = buildMatchSummary(raw, context);
export const events: MatchEvent[] = buildTimeline({ raw, players: playersFile, context });
export const crowd: ChatMessage[] = simulateCrowd({
  events,
  players,
  corpus: CrowdCorpusSchema.parse(JSON.parse(corpusText)),
  seed: MATCH_ID,
});

export function persona(id: string) {
  const found = personas.find((p) => p.id === id);
  if (!found) throw new Error(`no persona ${id}`);
  return found;
}

/** The legal delivery of `innings` labelled `label` (extras can share a label). */
export function delivery(innings: 1 | 2, label: string): DeliveryEvent {
  const found = events.find(
    (e): e is DeliveryEvent =>
      e.kind === "delivery" && e.innings === innings && e.label === label && e.isLegal,
  );
  if (!found) throw new Error(`no legal delivery ${innings}:${label}`);
  return found;
}
