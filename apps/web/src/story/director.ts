/**
 * The story director (PLAN 9.3, D-076): walks a reviewer through one match's beats, a pure state
 * machine over the fan's own session. For each beat of the plan (built on the server from the
 * personas and the gate's triggers, never from labels) it steers: a jump to the beat's lead-in and
 * the beat's pace; then watches the fan's TV for that beat's moment, and pauses the session there
 * with a stop the overlay explains. The climax beat stops twice: at the teaser (when it came in time)
 * and at the reveal. "Continue" steers to the next beat; leaving ends the tour and its commands, and
 * the room's own controls come back.
 *
 * Callers: story/StoryOverlay.tsx (`useStoryDirector`) and the web tests. Pace (speeds, the 25 s OTT
 * delay of the climax, DOMAIN's preset) is the tour's, not the match's.
 */
import {
  type ControlRequest,
  type Moment,
  momentVisibility,
  type StoryBeat,
  type StoryPlan,
} from "@sideline/engine";

/** Speeds and the climax's delay: fast between beats, slow enough at the climax to see the hold. */
export const STORY_PACE = {
  between: 32,
  climax: 2,
  roomRead: 8,
  result: 16,
  climaxDelayMs: 25_000,
} as const;

export type StopKind =
  | "lineup"
  | "bailout"
  | "catch_up"
  | "teaser"
  | "reveal"
  | "room_read"
  | "result";

export interface StoryStop {
  kind: StopKind;
  /** The moment the stop is about (null for the result). */
  momentId: string | null;
}

export interface DirectorState {
  /** Index into the plan's beats. */
  beat: number;
  /** steer: send the beat's jump and pace; resume: play on after the teaser stop; watch; stopped. */
  step: "steer" | "resume" | "watch" | "stopped" | "done" | "left";
  /** The climax beat's second stop: after the teaser comes the reveal. */
  revealNext: boolean;
  stop: StoryStop | null;
}

export interface StoryObservation {
  /** The fan's TV time. */
  tvT: number;
  moments: readonly Moment[];
  /** The fan's TV has shown the end of the match. */
  resultShown: boolean;
}

export const startStory = (): DirectorState => ({
  beat: 0,
  step: "steer",
  revealNext: false,
  stop: null,
});

/** What steering to a beat sends: its jump (if any) and its pace, then play. */
function steer(beat: StoryBeat): ControlRequest[] {
  switch (beat.kind) {
    case "lineup":
    case "bailout":
    case "catch_up":
      return [
        { action: "jump", target: beat.jump },
        { action: "speed", value: STORY_PACE.between },
        { action: "play" },
      ];
    case "climax":
      return [
        { action: "jump", target: beat.jump },
        { action: "delay", ms: STORY_PACE.climaxDelayMs },
        { action: "speed", value: STORY_PACE.climax },
        { action: "play" },
      ];
    case "room_read":
      return [{ action: "speed", value: STORY_PACE.roomRead }, { action: "play" }];
    case "result":
      return [{ action: "speed", value: STORY_PACE.result }, { action: "play" }];
  }
}

/** The stop a beat has reached on the fan's TV, or null while it is still coming. */
function reached(beat: StoryBeat, state: DirectorState, obs: StoryObservation): StoryStop | null {
  const shown = (m: Moment) => momentVisibility(m, obs.tvT);
  switch (beat.kind) {
    case "lineup":
    case "bailout":
    case "room_read": {
      const found = obs.moments.find((m) => m.key === beat.key && shown(m) === "revealed");
      return found ? { kind: beat.kind, momentId: found.id } : null;
    }
    case "catch_up": {
      // The session makes the reel itself when the jump skips past unseen balls, stamped at the jump.
      const found = obs.moments.find(
        (m) => m.kind === "catch_up" && m.createdAt >= beat.t && shown(m) === "revealed",
      );
      return found ? { kind: "catch_up", momentId: found.id } : null;
    }
    case "climax": {
      const found = obs.moments.find((m) => m.key === beat.key);
      if (!found) return null;
      const visibility = shown(found);
      if (visibility === "revealed") return { kind: "reveal", momentId: found.id };
      if (!state.revealNext && visibility === "teaser")
        return { kind: "teaser", momentId: found.id };
      return null;
    }
    case "result":
      return obs.resultShown ? { kind: "result", momentId: null } : null;
  }
}

/** One step: the commands to send now and the state after them. */
export function advanceStory(
  plan: StoryPlan,
  state: DirectorState,
  obs: StoryObservation,
): { state: DirectorState; commands: ControlRequest[] } {
  const beat = plan.beats[state.beat];
  if (state.step === "done" || state.step === "left" || state.step === "stopped") {
    return { state, commands: [] };
  }
  if (!beat) return { state: { ...state, step: "done" }, commands: [] };
  if (state.step === "steer") return { state: { ...state, step: "watch" }, commands: steer(beat) };
  if (state.step === "resume") {
    return { state: { ...state, step: "watch" }, commands: [{ action: "play" }] };
  }
  const stop = reached(beat, state, obs);
  if (!stop) return { state, commands: [] };
  return { state: { ...state, step: "stopped", stop }, commands: [{ action: "pause" }] };
}

/** "Continue": the climax's reveal after its teaser, else the next beat (or the end). */
export function continueStory(plan: StoryPlan, state: DirectorState): DirectorState {
  if (state.step !== "stopped") return state;
  if (state.stop?.kind === "teaser") {
    return { ...state, step: "resume", revealNext: true, stop: null };
  }
  const next = state.beat + 1;
  if (next >= plan.beats.length) return { ...state, step: "done", stop: null };
  return { beat: next, step: "steer", revealNext: false, stop: null };
}

/** Leaving the tour: no more commands; the room's own controls take over. */
export const leaveStory = (state: DirectorState): DirectorState => ({
  ...state,
  step: "left",
  stop: null,
});
