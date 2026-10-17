/** Shared helpers for the server tests: the real data dir, bundles, and an injected clock. */
import { join } from "node:path";
import {
  applyEvent,
  createMatchState,
  type InningsNumber,
  type NudgeFacts,
  nudgeDetector,
  type Persona,
} from "@sideline/engine";
import type { TeamName } from "../src/ai/skills/format.ts";
import { loadMatchBundles, type MatchBundle } from "../src/data/bundle.ts";

export const DATA_DIR = join(import.meta.dirname, "..", "..", "..", "data");

let cached: Map<string, MatchBundle> | null = null;
/** The real bundles, loaded once per test file (they are read-only). */
export function bundles(): Map<string, MatchBundle> {
  cached ??= loadMatchBundles(DATA_DIR);
  return cached;
}

export function bundle(id: string): MatchBundle {
  const found = bundles().get(id);
  if (!found) throw new Error(`no bundle ${id}`);
  return found;
}

/** A wall clock the test moves by hand (2026-10-16 12:00 UTC at the start). */
export function fakeClock(start = Date.UTC(2026, 9, 16, 12, 0, 0)) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    set: (ms: number) => {
      now = ms;
    },
  };
}

/** Resolves once every pending promise callback has run (lets fire-and-forget work settle). */
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Every teaser trigger of a full replay of a match (the nudge detector is persona-independent). */
export function nudgeFacts(id: string): NudgeFacts[] {
  const b = bundle(id);
  const ctx = {
    matchId: id,
    players: b.players,
    rules: b.rules,
    persona: b.personas[0] as Persona,
    winprob: b.winprob,
    priors: b.priors,
  };
  const state = createMatchState(id);
  const found: NudgeFacts[] = [];
  for (const event of b.events) {
    const before = structuredClone(state);
    applyEvent(state, event);
    const verdict = nudgeDetector.evaluate({ before, after: state, event, events: b.events, ctx });
    if (verdict.outcome === "ai_trigger" && verdict.trigger.kind === "spoiler_nudge") {
      found.push(verdict.trigger.facts);
    }
  }
  return found;
}

export const teamsOf = (id: string): TeamName[] =>
  bundle(id).context.teams.map((t) => ({ code: t.code, name: t.name }));

/** The teaser skill's facts for the teaser on `innings` `label` of match `id`. */
export function teaserFactsAt(id: string, innings: InningsNumber, label: string) {
  const nudge = nudgeFacts(id).find((f) => f.innings === innings && f.label === label);
  if (!nudge) throw new Error(`no teaser at ${id} ${innings}:${label}`);
  return { nudge, teams: teamsOf(id) };
}
