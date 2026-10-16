/**
 * Phase 3 (joining late): the facts behind a "Catch me up" reel for a fan who missed part of
 * the match, and the key that lets every fan who missed the same overs share one reel.
 *
 * Callers: the server session (Task 5), when a fan joins late or resumes after a pause or jump
 * and `missedLegalBalls` is at least 12 (not per event, so this is not a gate detector); the
 * catch-up skill (Task 5) turns the facts into slides and may cite only `window.deliveryIds`.
 * Everything here is computed from events and the model; the model writes the story, not the
 * numbers.
 */
import type { DeliveryEvent, MatchEvent } from "../contracts/events.ts";
import type { InningsNumber, Lens } from "../contracts/primitives.ts";
import type { InningsState, MatchState } from "../contracts/state.ts";
import { describeDelivery } from "../cricket/describe.ts";
import { round2 } from "../cricket/format.ts";
import { applyEvent, foldEvents } from "../cricket/reducer.ts";
import { fantasyPoints, squadPoints } from "../fantasy/scoring.ts";
import { winProbability } from "../models/winprob.ts";
import {
  batterFigures,
  bowlerFigures,
  playerIndex,
  playerRef,
  situationOf,
  situationOfInnings,
} from "./facts.ts";
import type { CatchUpFacts, DetectorContext } from "./types.ts";

/** An over is anomalous at this many population standard deviations above the window's mean. */
const ANOMALY_Z = 2;
/** The reel features this many win-probability swings. */
const TOP_SWINGS = 3;
/** Previous-innings summary: top batters and bowlers. */
const TOP_PERFORMERS = 2;

/** `catchup:<match>:<innings>:<fromOver>-<toOver>:<lens>` (D-015): one reel per window and lens. */
export function catchUpKey(
  matchId: string,
  innings: InningsNumber,
  fromOver: number,
  toOver: number,
  lens: Lens,
): string {
  return `catchup:${matchId}:${innings}:${fromOver}-${toOver}:${lens}`;
}

/** Legal deliveries with `lastSeenSeq < seq <= currentSeq`: extras do not count as balls missed. */
export function missedLegalBalls(
  events: readonly MatchEvent[],
  lastSeenSeq: number,
  currentSeq: number,
): number {
  return events.filter(
    (event) =>
      event.kind === "delivery" &&
      event.isLegal &&
      event.seq > lastSeenSeq &&
      event.seq <= currentSeq,
  ).length;
}

const isDelivery = (event: MatchEvent): event is DeliveryEvent => event.kind === "delivery";

/**
 * The whole overs of `innings` the fan missed: from the over of the first missed delivery (or the
 * innings' start, if it was missed entirely) up to the last complete over at `toSeq`. A finished
 * innings counts its last over even when it ended early (all out, target reached).
 */
function missedWindow(
  deliveries: readonly DeliveryEvent[],
  state: InningsState,
  fromSeq: number,
  toSeq: number,
) {
  const ofInnings = deliveries.filter((d) => d.innings === state.innings && d.seq <= toSeq);
  const firstMissed = ofInnings.find((d) => d.seq >= fromSeq);
  const fromOver = firstMissed ? firstMissed.over : (ofInnings.at(-1)?.over ?? 0) + 1;
  const toOver =
    state.status === "complete"
      ? (ofInnings.at(-1)?.over ?? -1) + 1
      : Math.floor(state.legalBalls / 6);
  return {
    fromOver,
    toOver,
    deliveries: ofInnings.filter((d) => d.over >= fromOver && d.over < toOver),
  };
}

/** Mean and population standard deviation (PLAN 4.6: the window's complete overs). */
function meanAndSd(values: readonly number[]): { mean: number; sd: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * Facts for a catch-up reel covering events `fromSeq..toSeq` (the first missed event through the
 * fan's current position). The window is the innings in progress at `toSeq`; if it has no
 * complete missed over yet (a fan back at 0.4 of the chase), the previous innings' missed overs.
 */
export function buildCatchUpFacts(input: {
  events: readonly MatchEvent[];
  fromSeq: number;
  toSeq: number;
  ctx: DetectorContext;
  lens: Lens;
}): CatchUpFacts {
  const { events, fromSeq, toSeq, ctx, lens } = input;
  const state = foldEvents(ctx.matchId, events, toSeq);
  const situation = situationOf(state);
  if (!situation) throw new Error(`no innings has started by event ${toSeq}`);
  const deliveries = events.filter(isDelivery);
  const index = playerIndex(ctx.players);

  // The current innings first, then the one before it.
  const candidates = [...state.innings].reverse();
  let chosen: { innings: InningsState; window: ReturnType<typeof missedWindow> } | null = null;
  for (const innings of candidates) {
    const window = missedWindow(deliveries, innings, fromSeq, toSeq);
    if (window.deliveries.length > 0) {
      chosen = { innings, window };
      break;
    }
  }
  if (!chosen) throw new Error(`no complete over was missed between ${fromSeq} and ${toSeq}`);
  const { innings, window } = chosen;
  const windowDeliveries = window.deliveries;

  const overs = innings.overs
    .filter((over) => over.over >= window.fromOver && over.over < window.toOver)
    .map((over) => ({
      over: over.over,
      runs: over.runs,
      wickets: over.wickets,
      bowler: playerRef(index, over.bowlerId),
    }));
  const complete = innings.overs.filter(
    (over) => over.complete && over.over >= window.fromOver && over.over < window.toOver,
  );
  const { mean, sd } = meanAndSd(complete.map((over) => over.runs));
  const anomalies =
    complete.length > 0 && sd > 0
      ? complete
          .map((over) => ({ over, z: (over.runs - mean) / sd }))
          .filter(({ z }) => z >= ANOMALY_Z)
          .map(({ over, z }) => ({
            over: over.over,
            runs: over.runs,
            z: round2(z),
            bowler: playerRef(index, over.bowlerId),
          }))
      : [];

  // The longest run of consecutive deliveries with nothing scored (the earliest, on a tie).
  let longestRunless: CatchUpFacts["longestRunless"] = null;
  let spell: DeliveryEvent[] = [];
  for (const delivery of windowDeliveries) {
    spell = delivery.runs.total === 0 ? [...spell, delivery] : [];
    const first = spell[0];
    if (first && spell.length > (longestRunless?.balls ?? 0)) {
      longestRunless = {
        balls: spell.length,
        fromLabel: first.label,
        toLabel: delivery.label,
        fromEventId: first.id,
        toEventId: delivery.id,
      };
    }
  }

  // Win probability before and after each delivery of the window, folding forward once.
  const swings: CatchUpFacts["biggestSwings"] = [];
  const firstSeq = windowDeliveries[0]?.seq ?? 0;
  const lastSeq = windowDeliveries.at(-1)?.seq ?? -1;
  const inWindow = new Set(windowDeliveries.map((d) => d.id));
  const replay: MatchState = foldEvents(ctx.matchId, events, firstSeq - 1);
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.seq > lastSeq) break;
    const before = winProbability(replay, ctx.winprob);
    applyEvent(replay, event);
    const after = winProbability(replay, ctx.winprob);
    if (isDelivery(event) && inWindow.has(event.id) && before && after) {
      swings.push({
        eventId: event.id,
        label: event.label,
        description: describeDelivery(event, index).text,
        wpBefore: before.pBattingTeamWins,
        wpAfter: after.pBattingTeamWins,
        swing: after.pBattingTeamWins - before.pBattingTeamWins,
      });
    }
  }
  swings.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));

  const current = state.innings.at(-1);
  const partnership = current?.partnership;
  const previous = state.innings.find((candidate) => candidate.innings === innings.innings - 1);
  const squad = ctx.persona.squad;
  const winNow = winProbability(state, ctx.winprob);

  return {
    matchId: ctx.matchId,
    lens,
    window: {
      innings: innings.innings,
      fromOver: window.fromOver,
      toOver: window.toOver,
      fromLabel: windowDeliveries[0]?.label ?? "",
      toLabel: windowDeliveries.at(-1)?.label ?? "",
      deliveryIds: windowDeliveries.map((d) => d.id),
    },
    previousInnings: previous
      ? {
          innings: previous.innings,
          battingTeam: previous.battingTeam,
          bowlingTeam: previous.bowlingTeam,
          score: situationOfInnings(previous).score,
          overs: situationOfInnings(previous).overs,
          topBatters: [...previous.batters]
            .sort((a, b) => b.runs - a.runs || a.balls - b.balls)
            .slice(0, TOP_PERFORMERS)
            .map((line) => ({
              ...batterFigures(index, previous, line.playerId),
              out: line.out !== null,
            })),
          topBowlers: [...previous.bowlers]
            .sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded)
            .slice(0, TOP_PERFORMERS)
            .map((line) => bowlerFigures(index, previous, line.playerId)),
        }
      : null,
    overs,
    anomalies,
    longestRunless,
    biggestSwings: swings.slice(0, TOP_SWINGS),
    partnership:
      current && partnership
        ? {
            batters: partnership.batterIds.map((id) => batterFigures(index, current, id)),
            runs: partnership.runs,
            balls: partnership.legalBalls,
          }
        : null,
    situation,
    winProbability: winNow ? { ...winNow } : null,
    squadImpact: squad
      ? (() => {
          const scored = squadPoints(
            fantasyPoints(state, ctx.players, ctx.rules),
            squad,
            ctx.rules,
          );
          return {
            total: scored.total,
            players: [...scored.perPlayer]
              .sort((a, b) => b.points - a.points)
              .map((player) => ({
                ...playerRef(index, player.playerId),
                base: player.base,
                multiplier: player.multiplier,
                points: player.points,
              })),
          };
        })()
      : null,
  };
}
