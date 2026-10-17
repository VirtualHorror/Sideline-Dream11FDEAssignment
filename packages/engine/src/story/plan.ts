/**
 * Builds the guided story's beats for one match (PLAN 9.3, D-076) from data alone: the story fan is
 * the first pre-match persona with a fantasy team, the catch-up point is the first late joiner's join
 * point, and every other beat is a trigger the entropy gate raises when the story fan watches the whole
 * match (all four detectors, the match's crowd), so a different persona or match yields different beats.
 *
 * Callers: the server's story route (once per bundle); the engine test pins it on both matches. Pure:
 * the gate runs on an injected zero clock, and nothing here knows a label, an over or an id.
 */
import type { ChatMessage } from "../contracts/chat.ts";
import type { MatchEvent } from "../contracts/events.ts";
import type { Player } from "../contracts/match.ts";
import type { Persona } from "../contracts/persona.ts";
import type { FantasyRules } from "../contracts/rules.ts";
import type { StoryBeat, StoryPlan } from "../contracts/story.ts";
import { joinSeq } from "../cricket/join.ts";
import { applyEvent, createMatchState } from "../cricket/reducer.ts";
import { collapseDetector } from "../detectors/collapse.ts";
import { lineupDetector } from "../detectors/lineup.ts";
import { nudgeDetector } from "../detectors/nudge.ts";
import { roomDetector } from "../detectors/room.ts";
import type { MomentTrigger } from "../detectors/types.ts";
import { createGate } from "../gate/gate.ts";
import type { PriorsFile } from "../models/priors.ts";
import type { WinProbModel } from "../models/winprob.ts";

/** T20 death overs start with the 16th over (index 15), as for the room detector and the phase rail. */
const DEATH_OVERS_FROM = 15;
/** The bailout's lead-in: start this many deliveries before the wicket, so the fan sees it bowled. */
const BAILOUT_LEAD_IN = 2;
/** The climax's lead-in: one delivery, so the teaser's whole window plays out on the fan's TV. */
const CLIMAX_LEAD_IN = 1;

export interface StoryInput {
  matchId: string;
  events: readonly MatchEvent[];
  players: readonly Player[];
  rules: FantasyRules;
  personas: readonly Persona[];
  winprob: WinProbModel;
  priors: PriorsFile;
  /** The match's simulated crowd: the room detector reads it. */
  chat: readonly ChatMessage[];
}

/** The delivery `count` deliveries before `event` (or the first delivery of the match). */
function leadIn(events: readonly MatchEvent[], event: MatchEvent, count: number): MatchEvent {
  const earlier = events.filter((e) => e.kind === "delivery" && e.seq < event.seq);
  return earlier[Math.max(0, earlier.length - count)] ?? event;
}

export function buildStoryPlan(input: StoryInput): StoryPlan | null {
  const { events, personas } = input;
  const fan = personas.find((p) => p.joinAt.kind === "pre_match" && p.squad !== null);
  if (!fan) return null;
  const late = personas.find((p) => p.joinAt.kind === "over");

  // Every trigger the story fan's session would raise watching the whole match, in order.
  const ctx = {
    matchId: input.matchId,
    players: input.players,
    rules: input.rules,
    persona: fan,
    winprob: input.winprob,
    priors: input.priors,
  };
  const gate = createGate([lineupDetector, collapseDetector, nudgeDetector, roomDetector], {
    nowMicros: () => 0,
  });
  // Two states folded in lockstep stand in for a copy of the state before each event.
  const before = createMatchState(input.matchId);
  const after = createMatchState(input.matchId);
  const fired: { trigger: MomentTrigger; event: MatchEvent }[] = [];
  for (const event of events) {
    applyEvent(after, event);
    const result = gate.process({ before, after, event, events, ctx, chat: input.chat });
    for (const trigger of result.triggers) fired.push({ trigger, event });
    applyEvent(before, event);
  }
  const first = (kind: MomentTrigger["kind"], from = -1, until = Number.POSITIVE_INFINITY) =>
    fired.find((f) => f.trigger.kind === kind && f.event.t >= from && f.event.t < until);

  const beats: StoryBeat[] = [];
  const lineup = first("lineup_patch");
  if (lineup) {
    const toss = events.some((e) => e.kind === "toss");
    beats.push({
      kind: "lineup",
      jump: toss ? { kind: "toss" } : { kind: "start" },
      eventId: lineup.event.id,
      t: lineup.event.t,
      key: lineup.trigger.key,
    });
  }
  const joinAt = late?.joinAt.kind === "over" ? late.joinAt : null;
  const joinT = joinAt ? (events[joinSeq(events, joinAt)]?.t ?? null) : null;
  const bailout = first("bailout", -1, joinT ?? Number.POSITIVE_INFINITY);
  if (bailout) {
    beats.push({
      kind: "bailout",
      jump: { kind: "event", eventId: leadIn(events, bailout.event, BAILOUT_LEAD_IN).id },
      eventId: bailout.event.id,
      t: bailout.event.t,
      key: bailout.trigger.key,
    });
  }
  if (late && joinAt && joinT !== null) {
    beats.push({
      kind: "catch_up",
      jump: { kind: "over", innings: joinAt.innings, afterOvers: joinAt.afterOvers },
      t: joinT,
      personaLabel: late.label,
    });
  }
  // The first big ball of the last innings' death overs, from the catch-up point on.
  const lastInnings = Math.max(...events.map((e) => (e.kind === "delivery" ? e.innings : 0)));
  const climax = fired.find(
    (f) =>
      f.trigger.kind === "spoiler_nudge" &&
      f.event.kind === "delivery" &&
      f.event.innings === lastInnings &&
      f.event.over >= DEATH_OVERS_FROM &&
      f.event.t >= (joinT ?? -1),
  );
  if (climax) {
    beats.push({
      kind: "climax",
      jump: { kind: "event", eventId: leadIn(events, climax.event, CLIMAX_LEAD_IN).id },
      eventId: climax.event.id,
      t: climax.event.t,
      key: climax.trigger.key,
    });
    const room = first("room_read", climax.event.t);
    if (room) {
      beats.push({
        kind: "room_read",
        eventId: room.event.id,
        t: room.event.t,
        key: room.trigger.key,
      });
    }
  }
  const end = events.at(-1);
  if (end) beats.push({ kind: "result", eventId: end.id, t: end.t });
  return { matchId: input.matchId, personaId: fan.id, personaLabel: fan.label, beats };
}
