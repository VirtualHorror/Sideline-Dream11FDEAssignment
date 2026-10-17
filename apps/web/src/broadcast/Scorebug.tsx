/**
 * The broadcast scorebug: score, overs, the chase equation, the batters and the bowler, in condensed
 * tabular numerals so digits never jitter as they change (DESIGN_SYSTEM §3).
 *
 * Callers: broadcast/TvPane.tsx (full) and the phone layout's pinned bar (`compact`), both with the
 * state folded to the fan's TV time. Names and team codes come from the match data.
 */
import type { MatchState, Player, Team } from "@sideline/engine";

const oversOf = (legalBalls: number) => `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;

function TeamChip({ team }: { team: Team | undefined }) {
  if (!team) return null;
  return (
    <span className="bug__team" style={{ background: team.color }}>
      {team.code}
    </span>
  );
}

export function Scorebug({
  state,
  teams,
  players,
  compact = false,
}: {
  state: MatchState;
  teams: readonly Team[];
  players: ReadonlyMap<string, Player>;
  compact?: boolean;
}) {
  const teamOf = (code: string | undefined) => teams.find((t) => t.code === code);
  const name = (id: string | null | undefined) => (id ? (players.get(id)?.shortName ?? id) : "");
  const innings = state.innings.at(-1);
  const style = { fontVariantNumeric: "tabular-nums" } as const;

  if (state.result) {
    const winner = teamOf(state.result.winner ?? undefined);
    return (
      <div className="bug" data-component="scorebug" data-compact={compact} style={style}>
        <TeamChip team={winner} />
        <span className="bug__result">{state.result.text}</span>
      </div>
    );
  }

  if (!innings) {
    const toss = state.toss;
    const tossWinner = teamOf(toss?.winner);
    return (
      <div className="bug" data-component="scorebug" data-compact={compact} style={style}>
        <span className="bug__status">
          {toss && tossWinner
            ? `${tossWinner.name} won the toss and chose to ${toss.decision}`
            : "Before the toss"}
        </span>
      </div>
    );
  }

  const live = state.live;
  const batting = teamOf(innings.battingTeam);
  const line = (id: string | null | undefined, onStrike: boolean) => {
    if (!id) return null;
    const figures = innings.batters.find((b) => b.playerId === id);
    return (
      <span className="bug__batter" data-on-strike={onStrike}>
        <span className="bug__name">
          {name(id)}
          {onStrike ? "*" : ""}
        </span>
        <span className="bug__num">{figures?.runs ?? 0}</span>
        <span className="bug__balls">({figures?.balls ?? 0})</span>
      </span>
    );
  };
  const bowler = innings.bowlers.find((b) => b.playerId === live?.bowlerId);
  const chase =
    innings.target && live?.runsRequired !== null && live?.runsRequired !== undefined
      ? innings.status === "complete"
        ? null
        : `Need ${live.runsRequired} off ${live.ballsRemaining}`
      : null;
  const breakLine =
    state.phase === "innings_break" ? `Innings break: target ${innings.runs + 1}` : null;

  return (
    <div className="bug" data-component="scorebug" data-compact={compact} style={style}>
      <span className="bug__main">
        <TeamChip team={batting} />
        <span className="bug__score">
          {innings.runs}/{innings.wickets}
        </span>
        <span className="bug__overs">{oversOf(innings.legalBalls)}</span>
      </span>
      {chase || breakLine ? <span className="bug__chase">{chase ?? breakLine}</span> : null}
      {compact ? null : (
        <>
          <span className="bug__batters">
            {line(live?.strikerId, true)}
            {line(live?.nonStrikerId, false)}
          </span>
          {bowler ? (
            <span className="bug__bowler">
              <span className="bug__name">{name(bowler.playerId)}</span>
              <span className="bug__num">
                {bowler.wickets}-{bowler.runsConceded}
              </span>
              <span className="bug__balls">({bowler.oversText})</span>
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
