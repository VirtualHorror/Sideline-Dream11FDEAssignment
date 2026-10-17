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

/** The JSON inside a prompt's <facts> tag (the scripted answers below pick legal ids from it). */
export function promptFacts<T>(user: string): T {
  const json = user.match(/<facts>\n([\s\S]*?)\n<\/facts>/)?.[1];
  if (!json) throw new Error("no <facts> in the prompt");
  return JSON.parse(json) as T;
}

interface LineupPromptFacts {
  squad: { id: string; armband: string | null; playing: boolean }[];
  notPlaying: { id: string; swapOptions: { inId: string }[] }[];
}

/** A legal lineup answer: each benched pick's first option, the armbands kept or passed on. */
export function legalLineupAnswer(user: string) {
  const facts = promptFacts<LineupPromptFacts>(user);
  const swaps = facts.notPlaying.flatMap((p) => {
    const option = p.swapOptions[0];
    return option ? [{ outId: p.id, inId: option.inId, rationale: "Plays today." }] : [];
  });
  const swapIn = (id: string) => swaps.find((s) => s.outId === id)?.inId ?? id;
  const armband = (mark: string) => swapIn(facts.squad.find((p) => p.armband === mark)?.id ?? "");
  return {
    swaps,
    captainId: armband("C"),
    viceCaptainId: armband("VC"),
    captainRationale: "In form.",
    viceCaptainRationale: "Bats high.",
    conditionsRead: "Scripted read of the conditions.",
  };
}

/** A legal comeback quest: a wicket in the facts' quest window and trivia on the dismissal. */
export function legalBailoutAnswer(user: string) {
  const { questWindow: qw } = promptFacts<{
    questWindow: { innings: number; fromLegalBall: number; toLegalBall: number };
  }>(user);
  const rule = {
    type: "wicket_in_window",
    innings: qw.innings,
    over: null,
    fromLegalBall: qw.fromLegalBall,
    toLegalBall: qw.toLegalBall,
    boundary: null,
    op: null,
    value: null,
    playerId: null,
    byLegalBall: null,
  };
  return {
    title: "Scripted comeback quest",
    predictions: [
      {
        prompt: "Another wicket in the window?",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
        rule,
      },
    ],
    trivia: [
      { question: "How did it happen?", options: ["a", "b"], answerIndex: 0, factId: "dismissal" },
    ],
    banter: {
      tone: "wholesome",
      headline: "Scripted",
      body: "Scripted body.",
      shareText: "Scripted.",
    },
  };
}

/** A legal room read: one pod citing the window's first message, the whole room. */
export function legalRoomAnswer(user: string) {
  const chat = JSON.parse(user.match(/<chat>\n([\s\S]*?)\n<\/chat>/)?.[1] ?? "[]") as {
    id: string;
  }[];
  return {
    mood: { label: "Scripted", emoji: "💬" },
    pods: [
      {
        title: "Everyone",
        stance: "Scripted stance",
        sharePct: 100,
        sampleMessageIds: chat.slice(0, 1).map((m) => m.id),
      },
    ],
    hotTake: null,
    poll: null,
  };
}

/** A valid answer for every skill, so the happy path is the default. */
export const validScript: Script = (req) => {
  if (req.skill === "room_read") return legalRoomAnswer(req.user);
  if (req.skill === "lineup_patch") return legalLineupAnswer(req.user);
  if (req.skill === "bailout") return legalBailoutAnswer(req.user);
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
  return {
    clock,
    db,
    bundles: all,
    traces,
    telemetry,
    provider,
    gateway,
    glossary,
    orchestrator,
    manager,
  };
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
