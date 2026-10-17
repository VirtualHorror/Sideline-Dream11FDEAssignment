/**
 * The fan's TV: what their delayed stream shows, folded on their own TV clock (Flow §9). The screen
 * (a night-match picture in both themes, with the floodlights rising from its bottom edge) carries the
 * scorebug and, on a big moment, the outburst and a ghost-text headline; under it the over, both
 * innings as dot matrices, the win-probability line, commentary and the remote control.
 *
 * Caller: pages/MatchRoom.tsx. Outbursts follow broadcast/outburst.ts and fire only for events newly
 * released on the TV clock during play: a snapshot (connect, seek, jump) resets the baseline and
 * lights nothing, and nothing is ever lit on stadium time.
 */
import type {
  AiMode,
  ClockState,
  ControlRequest,
  MatchEvent,
  Moment,
  Player,
  Team,
  WinProbModel,
} from "@sideline/engine";
import { useEffect, useRef, useState } from "react";
import { FloodlightGlow, type FloodlightHandle } from "../effects/FloodlightGlow.tsx";
import { GhostText } from "../effects/GhostText.tsx";
import type { TvView } from "../stream/tvClock.ts";
import { Commentary } from "./Commentary.tsx";
import { DelayControl } from "./DelayControl.tsx";
import { InningsDotMatrix } from "./InningsDotMatrix.tsx";
import { OverStrip } from "./OverStrip.tsx";
import { type Outburst, outburstFor } from "./outburst.ts";
import { PlaybackControls } from "./PlaybackControls.tsx";
import { Scorebug } from "./Scorebug.tsx";
import { WinProbLine } from "./WinProbLine.tsx";

const HEADLINE_MS = 4200;
const RESULT_HEADLINE_MS = 9000;

const AI_MODE: Record<AiMode, string> = {
  live: "Live AI connected",
  replay: "No live AI: recorded answers or labelled fallbacks",
  off: "Rules only",
};

/** A broadcast-style picture of the ground: boundary, inner circle, pitch. */
function Ground() {
  return (
    <svg className="tv__ground" viewBox="0 0 400 240" aria-hidden="true" focusable="false">
      <ellipse cx="200" cy="128" rx="184" ry="104" className="tv__boundary" />
      <ellipse cx="200" cy="128" rx="110" ry="62" className="tv__circle" />
      <rect x="192" y="104" width="16" height="48" rx="2" className="tv__pitch" />
    </svg>
  );
}

export function TvPane({
  matchId,
  view,
  events,
  moments,
  epoch,
  clock,
  teams,
  players,
  winprob,
  aiMode,
  disabled,
  onControl,
}: {
  matchId: string;
  view: TvView;
  events: readonly MatchEvent[];
  moments: readonly Moment[];
  epoch: number;
  clock: ClockState | null;
  teams: readonly Team[];
  players: ReadonlyMap<string, Player>;
  winprob: WinProbModel;
  aiMode: AiMode | null;
  disabled: boolean;
  onControl(request: ControlRequest): Promise<boolean> | undefined;
}) {
  const burstRef = useRef<FloodlightHandle>(null);
  const [headline, setHeadline] = useState<Outburst | null>(null);
  const seen = useRef({ epoch: -1, released: 0 });
  const { released, state } = view;

  useEffect(() => {
    const before = seen.current;
    seen.current = { epoch, released };
    if (before.epoch !== epoch || released <= before.released) return;
    let burst: Outburst | null = null;
    for (const event of events.slice(before.released, released)) {
      burst = outburstFor(event, { moments, teams, players }) ?? burst;
    }
    if (!burst) return;
    burstRef.current?.burst(burst.color, burst.strength);
    setHeadline(burst);
  }, [epoch, released, events, moments, teams, players]);

  useEffect(() => {
    if (!headline) return;
    const timer = setTimeout(
      () => setHeadline(null),
      headline.kind === "result" ? RESULT_HEADLINE_MS : HEADLINE_MS,
    );
    return () => clearTimeout(timer);
  }, [headline]);

  const delayS = Math.round((clock?.delayMs ?? 0) / 1000);
  return (
    <section className="tv" aria-label="Your TV">
      <header className="tv__head">
        <p className="tv__delay">
          Your TV, <strong>{delayS} s</strong> behind the ground
        </p>
        {aiMode ? (
          <span className="pill" data-ai-mode={aiMode}>
            {AI_MODE[aiMode]}
          </span>
        ) : null}
      </header>
      <div className="tv__screen surface-night" data-headline={headline?.kind}>
        <Ground />
        <FloodlightGlow intensity={0.55} burstRef={burstRef} />
        {headline ? (
          <div className="tv__reveal" key={headline.eventId} data-kind={headline.kind}>
            <GhostText text={headline.headline} mode="sweep" className="tv__headline" />
            <p className="tv__reveal-line">{headline.line}</p>
          </div>
        ) : null}
        <div className="tv__bug">
          <Scorebug state={state} teams={teams} players={players} />
        </div>
      </div>
      <OverStrip state={state} />
      <div className="tv__matrices">
        {state.innings.length === 0 ? (
          <p className="tv__note">The ball-by-ball grid fills in from the first delivery.</p>
        ) : (
          state.innings.map((innings) => (
            <InningsDotMatrix key={innings.innings} innings={innings} />
          ))
        )}
      </div>
      <WinProbLine
        events={events}
        released={released}
        matchId={matchId}
        model={winprob}
        teams={teams}
      />
      <Commentary state={state} events={events} players={players} />
      <div className="tv__controls">
        <PlaybackControls
          playing={clock?.playing ?? false}
          speed={clock?.speed ?? 1}
          disabled={disabled}
          onControl={onControl}
        />
        <DelayControl delayMs={clock?.delayMs ?? 0} disabled={disabled} onControl={onControl} />
      </div>
    </section>
  );
}
