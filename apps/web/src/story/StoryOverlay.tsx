/**
 * Story mode's panel (PLAN 9.3): one line on what the tour just stopped at, "Continue", and "Leave the
 * tour" at any point. `useStoryDirector` runs story/director.ts against the fan's real session: each
 * TV tick it advances the director and sends its commands (jumps, pace, pause, play) one after another
 * through the room's own control function.
 *
 * Callers: pages/MatchRoom.tsx when the URL has `story=1`. The callouts are the tour's own words,
 * built from the moment it stopped at (never presented as AI). Focus moves to "Continue" at each stop,
 * so the tour can be followed from the keyboard.
 */
import type { ControlRequest, Moment, StoryPlan } from "@sideline/engine";
import { useEffect, useRef, useState } from "react";
import {
  advanceStory,
  continueStory,
  type DirectorState,
  leaveStory,
  type StoryObservation,
  type StoryStop,
  startStory,
} from "./director.ts";

export interface StoryDirector {
  state: DirectorState;
  /** The tour is steering the session: the room's own controls are off. */
  active: boolean;
  next(): void;
  leave(): void;
}

export function useStoryDirector(
  plan: StoryPlan | null,
  obs: StoryObservation,
  control: (request: ControlRequest) => Promise<boolean> | undefined,
): StoryDirector {
  const [state, setState] = useState<DirectorState>(startStory);
  const sending = useRef(false);
  const { tvT, moments, resultShown } = obs;
  useEffect(() => {
    if (!plan || sending.current) return;
    const { state: next, commands } = advanceStory(plan, state, { tvT, moments, resultShown });
    if (next !== state) setState(next);
    if (commands.length === 0) return;
    sending.current = true;
    void (async () => {
      for (const command of commands) await control(command);
    })().finally(() => {
      sending.current = false;
    });
  }, [plan, state, tvT, moments, resultShown, control]);
  return {
    state,
    active: plan !== null && state.step !== "left" && state.step !== "done",
    next: () => setState((current) => (plan ? continueStory(plan, current) : current)),
    leave: () => setState(leaveStory),
  };
}

function callout(stop: StoryStop, plan: StoryPlan, moments: readonly Moment[], delayMs: number) {
  const moment = moments.find((m) => m.id === stop.momentId);
  switch (stop.kind) {
    case "lineup": {
      const benched = moment?.kind === "lineup_patch" ? moment.payload.notPlaying.length : 0;
      return `The XIs are out and ${benched === 1 ? "1 of your picks is" : `${benched} of your picks are`} not playing. Sideline lists only swaps that keep your team legal; the words say why.`;
    }
    case "bailout":
      return "Your captain is out cheaply. Instead of a dead team, a comeback quest: Sideline's engine settles every call from the real deliveries.";
    case "catch_up": {
      const beat = plan.beats.find((b) => b.kind === "catch_up");
      const who = beat?.kind === "catch_up" ? beat.personaLabel : "a late fan";
      return `You jump to where "${who}" opens the app. The reel tells the overs you skipped, from the match data.`;
    }
    case "teaser":
      return `Your stream is ${Math.round(delayMs / 1000)} s behind the ground. Sideline already knows this ball and holds it; the teaser gives nothing away.`;
    case "reveal":
      return "Now your TV shows the ball, and the card opens with it, never before.";
    case "room_read":
      return "The chat is a firehose. Once an over, the room read sums up its debates.";
    case "result":
      return "That's the match. The control plane shows how much of it ran without any AI call.";
  }
}

export function StoryOverlay({
  plan,
  director,
  moments,
  delayMs,
}: {
  plan: StoryPlan;
  director: StoryDirector;
  moments: readonly Moment[];
  delayMs: number;
}) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const { state } = director;
  const stop = state.step === "stopped" ? state.stop : null;
  useEffect(() => {
    if (stop) continueRef.current?.focus();
  }, [stop]);
  if (state.step === "left") return null;
  const last = state.beat >= plan.beats.length - 1 && stop?.kind === "result";
  return (
    <aside className="story" aria-label="Story mode" data-step={state.step}>
      <p className="story__title">Story mode, watching as {plan.personaLabel}</p>
      <p className="story__line" aria-live="polite">
        {state.step === "done"
          ? "That's the story. The room is yours."
          : stop
            ? callout(stop, plan, moments, delayMs)
            : "Playing on to the next moment…"}
      </p>
      <div className="story__actions">
        {stop ? (
          <button
            ref={continueRef}
            type="button"
            className="button button--primary"
            onClick={director.next}
          >
            {last ? "Finish" : "Continue"}
          </button>
        ) : null}
        {state.step !== "done" ? (
          <button type="button" className="button" onClick={director.leave}>
            Leave the tour
          </button>
        ) : null}
      </div>
    </aside>
  );
}
