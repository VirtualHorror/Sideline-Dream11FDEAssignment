/**
 * PLAN 9.3: the story director, driven with a fake session. The plan is the engine's, built from the
 * real 2022 data (personas and the gate's triggers), so the stops below follow from data: the
 * director jumps to each beat's lead-in, waits for that beat's moment on the fan's TV and pauses
 * there; leaving the tour ends its commands, and the room's controls come back.
 */
import {
  buildStoryPlan,
  type ControlRequest,
  type Moment,
  PriorsFileSchema,
  type StoryPlan,
} from "@sideline/engine";
import { describe, expect, it } from "vitest";
import priorsText from "../../../data/models/priors-1298150.json?raw";
import {
  advanceStory,
  continueStory,
  type DirectorState,
  leaveStory,
  STORY_PACE,
  type StoryObservation,
  startStory,
} from "../src/story/director.ts";
import { crowd, events, MATCH_ID, personas, players, rules, winprob } from "./helpers/match.ts";

const plan = buildStoryPlan({
  matchId: MATCH_ID,
  events,
  players,
  rules,
  personas,
  winprob,
  priors: PriorsFileSchema.parse(JSON.parse(priorsText)),
  chat: crowd,
}) as StoryPlan;

/** A moment the fake session produced for a beat, revealed at `revealAt`, teasing from `nudgeAt`. */
const moment = (kind: Moment["kind"], key: string, at: number, nudgeAt: number | null = null) =>
  ({ id: `m-${key}`, key, kind, createdAt: at, revealAt: at, nudgeAt }) as unknown as Moment;

/** Runs the director until it stops (or gives up), collecting every command it sends. */
function runUntilStop(state: DirectorState, obs: StoryObservation, sent: ControlRequest[]) {
  let current = state;
  for (let i = 0; i < 4; i += 1) {
    const { state: next, commands } = advanceStory(plan, current, obs);
    sent.push(...commands);
    current = next;
    if (current.step === "stopped") break;
  }
  return current;
}

describe("the story director (PLAN 9.3)", () => {
  it("stops at every beat the data chose, in order, pausing the session at each", () => {
    expect(plan.beats.map((b) => b.kind)).toEqual([
      "lineup",
      "bailout",
      "catch_up",
      "climax",
      "room_read",
      "result",
    ]);
    const [lineup, bailout, catchUp, climax, room, result] = plan.beats;
    if (!lineup || !bailout || !catchUp || !climax || !room || !result)
      throw new Error("six beats");
    if (
      lineup.kind !== "lineup" ||
      bailout.kind !== "bailout" ||
      climax.kind !== "climax" ||
      room.kind !== "room_read"
    ) {
      throw new Error("beat kinds");
    }
    const sent: ControlRequest[] = [];
    const moments: Moment[] = [];
    const stops: string[] = [];
    let state = startStory();

    // Nothing to see yet: the director steers to the toss and waits.
    state = runUntilStop(state, { tvT: 0, moments, resultShown: false }, sent);
    expect(state.step).toBe("watch");
    expect(sent).toEqual([
      { action: "jump", target: lineup.jump },
      { action: "speed", value: STORY_PACE.between },
      { action: "play" },
    ]);
    const watch = (tvT: number, resultShown = false) => {
      state = runUntilStop(state, { tvT, moments: [...moments], resultShown }, sent);
      if (state.stop) stops.push(state.stop.kind);
      expect(sent.at(-1)).toEqual({ action: "pause" });
      state = continueStory(plan, state);
    };

    moments.push(moment("lineup_patch", lineup.key, lineup.t));
    watch(lineup.t);
    moments.push(moment("bailout", bailout.key, bailout.t));
    watch(bailout.t);
    // The jump to the late joiner's point makes the session's own catch-up reel, at that time.
    moments.push(moment("catch_up", "catchup:test", catchUp.t));
    watch(catchUp.t);
    moments.push(moment("spoiler_nudge", climax.key, climax.t, climax.t - 6_000));
    const climaxSteer = sent.length;
    watch(climax.t - 3_000);
    expect(sent.slice(climaxSteer)).toEqual([
      { action: "jump", target: climax.jump },
      { action: "delay", ms: STORY_PACE.climaxDelayMs },
      { action: "speed", value: STORY_PACE.climax },
      { action: "play" },
      { action: "pause" },
    ]);
    // Continuing from the teaser plays on (the session is paused at the stop) to the reveal.
    const afterTeaser = sent.length;
    watch(climax.t);
    expect(sent.slice(afterTeaser)).toEqual([{ action: "play" }, { action: "pause" }]);
    moments.push(moment("room_read", room.key, room.t));
    watch(room.t);
    watch(result.t, true);
    expect(stops).toEqual([
      "lineup",
      "bailout",
      "catch_up",
      "teaser",
      "reveal",
      "room_read",
      "result",
    ]);
    expect(state.step).toBe("done");
  });

  it("goes straight to the reveal when the teaser came too late for the fan's TV", () => {
    const climax = plan.beats.find((b) => b.kind === "climax");
    if (climax?.kind !== "climax") throw new Error("a climax beat");
    let state: DirectorState = { ...startStory(), beat: plan.beats.indexOf(climax) };
    const sent: ControlRequest[] = [];
    state = runUntilStop(
      state,
      {
        tvT: climax.t + 1,
        moments: [moment("spoiler_nudge", climax.key, climax.t)],
        resultShown: false,
      },
      sent,
    );
    expect(state.stop?.kind).toBe("reveal");
  });

  it("issues nothing more once the fan leaves the tour", () => {
    const sent: ControlRequest[] = [];
    let state = runUntilStop(startStory(), { tvT: 0, moments: [], resultShown: false }, sent);
    state = leaveStory(state);
    expect(state.step).toBe("left");
    const after = advanceStory(plan, state, { tvT: 1e9, moments: [], resultShown: true });
    expect(after.commands).toEqual([]);
    expect(after.state.step).toBe("left");
  });
});
