/**
 * A whole server runtime for tests: real bundles, glossary, gateway, orchestrator, telemetry and
 * session manager, with the scripted provider, an in-memory database and a hand-moved clock.
 */
import type { Detector, MatchEvent, StreamMessage } from "@sideline/engine";
import { createBudget } from "../src/ai/budget.ts";
import { createCache } from "../src/ai/cache.ts";
import { createGateway } from "../src/ai/gateway.ts";
import { createScriptedProvider, type Script } from "../src/ai/providers/scripted.ts";
import { loadGlossary } from "../src/data/glossary.ts";
import { openDatabase } from "../src/db/database.ts";
import { createOrchestrator } from "../src/orchestrator/orchestrator.ts";
import { createSessionManager, type Session } from "../src/sessions/manager.ts";
import { createTelemetry, createTraceSink } from "../src/telemetry/collector.ts";
import { bundles, DATA_DIR, fakeClock } from "./helpers.ts";

/** A valid answer for every Task 5 skill, so the happy path is the default. */
export const validScript: Script = (req) => {
  if (req.skill === "spoiler_nudge") return { nudge: "Everything rides on the next delivery." };
  if (req.skill === "catch_up") {
    return {
      slides: [
        { kind: "turning_point", headline: "What you missed", body: "Plenty.", citedEventIds: [] },
        { kind: "watch_next", headline: "From here", body: "Watch the chase.", citedEventIds: [] },
      ],
    };
  }
  return { answer: "A scripted answer.", relatedTerms: [] };
};

export function testRuntime(
  opts: {
    script?: Script;
    noProvider?: boolean;
    ttlMs?: number;
    maxSessions?: number;
    detectors?: readonly Detector[];
  } = {},
) {
  const clock = fakeClock();
  let micros = 0;
  const db = openDatabase(":memory:");
  const traces = createTraceSink(db);
  const all = bundles();
  const telemetry = createTelemetry({
    traces,
    eventsPerMatch: new Map([...all].map(([id, b]) => [id, b.events.length])),
  });
  const provider = createScriptedProvider(opts.script ?? validScript);
  const gateway = createGateway({
    provider: opts.noProvider ? null : provider,
    cache: createCache(db, clock.now),
    budget: createBudget({ db, dailyUsd: 3, sessionCap: 80, now: clock.now }),
    traces,
    models: { fast: "gpt-test-fast", smart: "gpt-test" },
    pricing: { inPerMTok: 5, outPerMTok: 20 },
    now: clock.now,
  });
  const glossary = loadGlossary(DATA_DIR);
  const orchestrator = createOrchestrator({ gateway, glossary, telemetry, bundles: all });
  const manager = createSessionManager({
    bundles: all,
    orchestrator,
    telemetry,
    aiMode: () => gateway.mode(),
    now: clock.now,
    nowMicros: () => {
      micros += 5;
      return micros;
    },
    ttlMs: opts.ttlMs,
    maxSessions: opts.maxSessions,
    detectors: opts.detectors,
  });
  return { clock, db, traces, telemetry, provider, gateway, glossary, orchestrator, manager };
}

/** Collects a session's stream messages. */
export function listen(session: Session): StreamMessage[] {
  const messages: StreamMessage[] = [];
  session.connect((message) => messages.push(message));
  return messages;
}

/**
 * Moves the wall clock in steps, ticking the manager after each, until the session's stadium time
 * reaches `stadiumT`; then lets the AI work started on the way finish.
 */
export async function playUntil(
  rt: ReturnType<typeof testRuntime>,
  session: Session,
  stadiumT: number,
  stepMs = 1000,
): Promise<void> {
  for (let guard = 0; guard < 100_000; guard += 1) {
    rt.manager.tick();
    if (session.stadiumNow() >= stadiumT) break;
    rt.clock.advance(stepMs);
  }
  rt.manager.tick();
  await rt.manager.settle();
}

/** The legal delivery of `innings` with this scoreboard label (a wide may share the label). */
export function delivery(events: readonly MatchEvent[], innings: 1 | 2, label: string): MatchEvent {
  const found = events.find(
    (e) => e.kind === "delivery" && e.innings === innings && e.label === label && e.isLegal,
  );
  if (!found) throw new Error(`no legal ${innings}:${label}`);
  return found;
}
