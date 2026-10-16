/**
 * Replays a demo match through detectors the way the server session will (Task 5): fold every
 * event, and from the persona's join point on hand each detector the state before and after the
 * event. `before` is a copy because the reducer mutates in place.
 */
import {
  applyEvent,
  buildTimeline,
  type ChatMessage,
  createMatchState,
  type Detector,
  type DetectorContext,
  type DetectorInput,
  type DetectorVerdict,
  joinSeq,
  type MatchEvent,
  type Persona,
} from "../../src/index.ts";
import { type FixtureMatchId, loadMatch, loadPriors, loadWinProbModel } from "./data.ts";

export function personaOf(id: FixtureMatchId, personaId: string): Persona {
  const persona = loadMatch(id).personas.personas.find((candidate) => candidate.id === personaId);
  if (!persona) throw new Error(`no persona ${personaId} in ${id}`);
  return persona;
}

export function contextFor(id: FixtureMatchId, persona: Persona): DetectorContext {
  const { players, rules } = loadMatch(id);
  return {
    matchId: id,
    players: players.players,
    rules,
    persona,
    winprob: loadWinProbModel(),
    priors: loadPriors(id),
  };
}

export function timelineOf(id: FixtureMatchId): MatchEvent[] {
  return buildTimeline(loadMatch(id));
}

export interface ReplayStep {
  input: DetectorInput;
  verdicts: { detector: string; verdict: DetectorVerdict }[];
}

/**
 * Every event after the persona's join point, with each detector's verdict. Events up to the join
 * point are folded but not evaluated: the fan was not watching yet.
 */
export function replay(
  id: FixtureMatchId,
  persona: Persona,
  detectors: readonly Detector[],
  opts: { chat?: readonly ChatMessage[]; events?: readonly MatchEvent[] } = {},
): ReplayStep[] {
  const events = opts.events ?? timelineOf(id);
  const ctx = contextFor(id, persona);
  const joined = joinSeq(events, persona.joinAt);
  const state = createMatchState(id);
  const steps: ReplayStep[] = [];
  for (const event of events) {
    if (event.seq <= joined) {
      applyEvent(state, event);
      continue;
    }
    const before = structuredClone(state);
    applyEvent(state, event);
    const input: DetectorInput = { before, after: state, event, events, ctx, chat: opts.chat };
    steps.push({
      input: { ...input, after: structuredClone(state) },
      verdicts: detectors.map((detector) => ({
        detector: detector.name,
        verdict: detector.evaluate(input),
      })),
    });
  }
  return steps;
}

/** The ai_trigger and suppressed verdicts of one detector, with the event they fired on. */
export function firings(steps: readonly ReplayStep[], detector: string) {
  return steps.flatMap((step) =>
    step.verdicts
      .filter((entry) => entry.detector === detector && entry.verdict.outcome !== "deterministic")
      .map((entry) => ({ event: step.input.event, verdict: entry.verdict })),
  );
}
