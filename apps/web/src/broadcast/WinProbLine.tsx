/**
 * Win probability across the match, from the chasing side's point of view: the engine's trained model
 * (`winProbability`, data/models/winprob-v1.json, D-040) evaluated after every delivery the fan's TV
 * has shown. A number that comes from the model, never a constant (Constraint 3).
 *
 * Caller: broadcast/TvPane.tsx with the stream's events and how many of them the TV has released.
 */
import {
  applyEvent,
  createMatchState,
  type MatchEvent,
  type Team,
  type WinProbModel,
  winProbability,
} from "@sideline/engine";
import { useMemo } from "react";

interface Point {
  /** Legal balls since the first ball of the match: 0-120 first innings, 120-240 the chase. */
  x: number;
  /** The chasing side's chance to win, 0-1. */
  p: number;
}

const BALLS = 120;

/** The chasing side's win probability after every delivery (and innings start) in `events`. */
export function winProbSeries(
  matchId: string,
  events: readonly MatchEvent[],
  model: WinProbModel,
): { chaser: string | null; points: Point[] } {
  const state = createMatchState(matchId);
  let chaser: string | null = null;
  const points: Point[] = [];
  for (const event of events) {
    applyEvent(state, event);
    if (event.kind === "innings_start" && event.innings === 1) chaser = event.bowlingTeam;
    if (event.kind !== "delivery" && event.kind !== "innings_start") continue;
    const wp = winProbability(state, model);
    const innings = state.innings.at(-1);
    if (!wp || !innings || !chaser) continue;
    const p = wp.battingTeam === chaser ? wp.pBattingTeamWins : 1 - wp.pBattingTeamWins;
    points.push({ x: (innings.innings - 1) * BALLS + innings.legalBalls, p });
  }
  return { chaser, points };
}

export function WinProbLine({
  events,
  released,
  matchId,
  model,
  teams,
}: {
  events: readonly MatchEvent[];
  released: number;
  matchId: string;
  model: WinProbModel;
  teams: readonly Team[];
}) {
  const { chaser, points } = useMemo(
    () => winProbSeries(matchId, events.slice(0, released), model),
    [matchId, events, released, model],
  );
  const team = teams.find((t) => t.code === chaser);
  const last = points.at(-1);
  if (!team || !last) {
    return (
      <section className="winprob" aria-label="Win probability">
        <p className="winprob__empty">The win-probability line starts with the first innings.</p>
      </section>
    );
  }
  const pct = Math.round(last.p * 100);
  const path = points
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"}${point.x.toFixed(1)} ${((1 - point.p) * 100).toFixed(2)}`,
    )
    .join(" ");
  return (
    <section className="winprob" aria-label="Win probability">
      <header className="winprob__head">
        <span className="winprob__label">{team.name}'s chance to win</span>
        <span className="winprob__value">{pct}%</span>
      </header>
      <svg
        className="winprob__chart"
        viewBox={`0 0 ${BALLS * 2} 100`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${team.name}'s chance to win: ${pct}%`}
      >
        <line className="winprob__mid" x1="0" y1="50" x2={BALLS * 2} y2="50" />
        <line className="winprob__break" x1={BALLS} y1="0" x2={BALLS} y2="100" />
        <path className="winprob__line" d={path} style={{ stroke: team.color }} />
      </svg>
      <div className="winprob__axis" aria-hidden="true">
        <span>1st innings</span>
        <span>Chase</span>
      </div>
    </section>
  );
}
