/**
 * The match room (`/match/:matchId?persona=<id>`): the fan's TV and their companion side by side, the
 * control plane docked underneath (DESIGN_SYSTEM §5); on a phone, a pinned compact scorebug and tabs
 * (Companion first: it is a second screen).
 *
 * Flow (§3, §7, §9): GET /api/matches/:id (players, rules, model, D-060) → POST /api/sessions with the
 * persona → the SSE stream into a store (stream/useSessionStream.ts) → every render folds the events
 * the fan's TV has reached (stream/tvClock.ts) and hands the TV view to every panel, so the TV pane,
 * the cards, the chat and the control plane can never show more than the fan's picture. Controls and
 * questions go back over REST; the stream brings the result. A link without a persona shows the
 * picker for this match first.
 *
 * Caller: App.tsx.
 */
import {
  type ControlRequest,
  type DeliveryEvent,
  fantasyPoints,
  type Lens,
  squadPoints,
} from "@sideline/engine";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { PhaseRail } from "../broadcast/PhaseRail.tsx";
import { Scorebug } from "../broadcast/Scorebug.tsx";
import { TvPane } from "../broadcast/TvPane.tsx";
import { ChatFeed } from "../companion/ChatFeed.tsx";
import { Composer } from "../companion/Composer.tsx";
import type { SquadImpact } from "../companion/cards/CatchUpReel.tsx";
import { LensSwitch } from "../companion/LensSwitch.tsx";
import { MomentFeed } from "../companion/MomentFeed.tsx";
import { suggestQuestion } from "../companion/suggest.ts";
import { PersonaPicker } from "../components/PersonaPicker.tsx";
import { ControlPlaneDrawer } from "../controlplane/ControlPlaneDrawer.tsx";
import { ApiError, api, type MatchDetail, type MatchListing } from "../lib/api.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { Link, navigate, useRoute } from "../router.tsx";
import { releasedCount, TvContext, useTvView } from "../stream/tvClock.ts";
import { useSessionStream } from "../stream/useSessionStream.ts";

/** Below this width the room is one column with tabs (DESIGN_SYSTEM §5). */
const PHONE_QUERY = "(max-width: 959px)";

function messageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  if (error.status === 429) {
    return `That's a lot of questions at once: try again in ${error.retryAfterSec ?? 5} s.`;
  }
  if (error.code === "session_failed") return "This session was paused. Start a new one to go on.";
  if (error.code === "invalid_control") return `That jump isn't possible: ${error.message}.`;
  return error.message;
}

export function MatchRoom({ matchId }: { matchId: string }) {
  const { search } = useRoute();
  const personaId = search.get("persona");
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [listing, setListing] = useState<MatchListing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setProblem(null);
    Promise.all([api.matchDetail(matchId), api.matches()])
      .then(([found, matches]) => {
        if (!live) return;
        setDetail(found);
        setListing(matches.find((m) => m.id === matchId) ?? null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setProblem(
          error instanceof ApiError && error.status === 404
            ? "Sideline doesn't have that match."
            : messageOf(error),
        );
      });
    return () => {
      live = false;
    };
  }, [matchId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts a stopped session
  useEffect(() => {
    setSessionId(null);
    if (!personaId) return;
    let live = true;
    api
      .createSession({ matchId, personaId })
      .then((created) => live && setSessionId(created.sessionId))
      .catch((error: unknown) => live && setProblem(messageOf(error)));
    return () => {
      live = false;
    };
  }, [matchId, personaId, attempt]);

  if (problem) {
    return (
      <section className="page-message">
        <h1 className="page-message__title">{problem}</h1>
        <p>
          <Link to="/">Pick a match and a fan</Link> to start again.
        </p>
      </section>
    );
  }
  if (!detail) return <p className="page-loading">Loading the match…</p>;
  if (!personaId || !listing?.personas.some((p) => p.id === personaId)) {
    return (
      <section className="room-pick">
        <h1 className="room-pick__title">{detail.match.title}</h1>
        <p className="room-pick__lede">{detail.match.competition}</p>
        {listing ? (
          <PersonaPicker
            matches={[listing]}
            onStart={(id, persona) =>
              navigate(`/match/${id}?persona=${encodeURIComponent(persona)}`, { replace: true })
            }
          />
        ) : null}
      </section>
    );
  }
  if (!sessionId) return <p className="page-loading">Starting your session…</p>;
  return (
    <Room
      key={sessionId}
      matchId={matchId}
      detail={detail}
      sessionId={sessionId}
      onRestart={() => setAttempt((n) => n + 1)}
    />
  );
}

type Tab = "companion" | "tv" | "control";
const TABS: [Tab, string][] = [
  ["companion", "Companion"],
  ["tv", "TV"],
  ["control", "Control plane"],
];

function Room({
  matchId,
  detail,
  sessionId,
  onRestart,
}: {
  matchId: string;
  detail: MatchDetail;
  sessionId: string;
  onRestart(): void;
}) {
  const { store, state } = useSessionStream(sessionId);
  const view = useTvView(matchId, state.clock, state.events);
  const phone = useMediaQuery(PHONE_QUERY);
  const [tab, setTab] = useState<Tab>("companion");
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens | null>(null);
  const players = useMemo(() => new Map(detail.players.map((p) => [p.id, p])), [detail.players]);
  const teams = detail.match.teams;
  const persona = state.session?.persona ?? null;
  const stopped = state.failure !== null || state.connection === "closed";

  const control = (request: ControlRequest): Promise<boolean> =>
    api
      .control(sessionId, request)
      .then((clock) => {
        store.dispatch({ type: "clock", clock });
        setControlError(null);
        return true;
      })
      .catch((error: unknown) => {
        setControlError(messageOf(error));
        return false;
      });
  const chooseLens = (next: Lens) => {
    setLens(next);
    void control({ action: "lens", lens: next });
  };
  const ask = (text: string) => {
    setPending(text);
    setAskError(null);
    api
      .ask(sessionId, text, lens ?? undefined)
      .then((moment) => store.dispatch({ type: "moment", moment }))
      .catch((error: unknown) => setAskError(messageOf(error)))
      .finally(() => setPending(null));
  };

  const chat = state.chat.slice(0, releasedCount(state.chat, view.tvT));
  const lastDelivery = useMemo(() => {
    for (let i = view.released - 1; i >= 0; i -= 1) {
      const event = state.events[i];
      if (event?.kind === "delivery") return event as DeliveryEvent;
    }
    return null;
  }, [state.events, view.released]);
  const impact = useMemo<SquadImpact | null>(() => {
    const squad = persona?.squad;
    if (!squad) return null;
    const result = squadPoints(
      fantasyPoints(view.state, detail.players, detail.rules),
      squad,
      detail.rules,
    );
    const captain = result.perPlayer.find((p) => p.playerId === squad.captainId);
    return {
      total: result.total,
      captain: captain
        ? {
            name: players.get(captain.playerId)?.shortName ?? captain.playerId,
            points: captain.points,
          }
        : null,
    };
  }, [persona, view.state, detail.players, detail.rules, players]);

  const delayMs = state.clock?.delayMs ?? persona?.delayMs ?? 0;
  const teamStyle = {
    "--team-a": teams[0].color,
    "--team-b": teams[1].color,
  } as CSSProperties;

  const banner = state.failure ? (
    <div className="banner" role="alert">
      <p>This session hit an internal error and was paused.</p>
      <button type="button" className="button" onClick={onRestart}>
        Start a new session
      </button>
    </div>
  ) : state.connection === "closed" ? (
    <div className="banner" role="alert">
      <p>This session has ended, maybe because the server restarted.</p>
      <button type="button" className="button" onClick={onRestart}>
        Start a new session
      </button>
    </div>
  ) : null;

  const tv = (
    <TvPane
      matchId={matchId}
      view={view}
      events={state.events}
      moments={state.moments}
      epoch={state.epoch}
      clock={state.clock}
      teams={teams}
      players={players}
      winprob={detail.winprob}
      aiMode={state.session?.aiMode ?? null}
      disabled={stopped || !state.clock}
      onControl={control}
    />
  );
  const companion = (
    <section className="companion" aria-label="Companion">
      <header className="companion__head">
        <h2 className="companion__title">Companion</h2>
        <LensSwitch
          lens={lens ?? persona?.lens ?? "casual"}
          onChange={chooseLens}
          disabled={stopped}
        />
      </header>
      <MomentFeed
        moments={state.moments}
        events={state.events}
        tvT={view.tvT}
        delayMs={delayMs}
        speed={state.clock?.speed ?? 1}
        impact={impact}
        pendingQuestion={pending}
        onAsk={ask}
      />
      <ChatFeed messages={chat} teams={teams} />
      <Composer
        suggestion={suggestQuestion(view.state, lastDelivery)}
        thinking={pending !== null}
        error={askError}
        disabled={stopped || pending !== null}
        onAsk={ask}
      />
    </section>
  );
  const controlPlane = (
    <ControlPlaneDrawer
      telemetry={state.telemetry}
      tvT={view.tvT}
      events={state.events}
      moments={state.moments}
      variant={phone ? "panel" : "drawer"}
    />
  );
  const rail = (
    <PhaseRail
      state={view.state}
      onJump={(target) => void control({ action: "jump", target })}
      disabled={stopped || !state.clock}
    />
  );

  return (
    <TvContext.Provider value={view}>
      <div className="room" data-layout={phone ? "phone" : "desktop"} style={teamStyle}>
        {phone ? (
          <>
            <div className="room__sticky">
              <div className="room__pinned">
                <Scorebug state={view.state} teams={teams} players={players} compact />
                <span className="room__delay">TV {Math.round(delayMs / 1000)} s behind</span>
              </div>
              <div className="room__tabs" role="tablist" aria-label="Match room">
                {TABS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={`panel-${id}`}
                    className="room__tab"
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {banner}
            {controlError ? (
              <p className="room__error" role="alert">
                {controlError}
              </p>
            ) : null}
            <div
              className="room__panel"
              role="tabpanel"
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
            >
              {tab === "companion" ? companion : null}
              {tab === "tv" ? (
                <>
                  {rail}
                  {tv}
                </>
              ) : null}
              {tab === "control" ? controlPlane : null}
            </div>
          </>
        ) : (
          <>
            <div className="room__bar">
              <div className="room__title">
                <h1 className="room__match">{detail.match.title}</h1>
                <p className="room__stage">
                  {detail.match.competition}, {detail.match.stage}
                </p>
              </div>
              {rail}
              {state.connection === "reconnecting" ? (
                <span className="pill">Reconnecting…</span>
              ) : null}
            </div>
            {banner}
            {controlError ? (
              <p className="room__error" role="alert">
                {controlError}
              </p>
            ) : null}
            <div className="room__grid">
              {tv}
              {companion}
            </div>
            {controlPlane}
          </>
        )}
      </div>
    </TvContext.Provider>
  );
}
