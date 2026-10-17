/**
 * The session manager: creates per-browser sessions, ticks them all from one loop, and evicts the
 * idle ones (D-011, PLAN Task 5: idle TTL 30 min, at most 300 sessions).
 *
 * Callers: src/index.ts (with sessions/ticker.ts driving `tick` every 100 ms) and the HTTP routes.
 * A session is idle when no stream is open and nothing touched it for the TTL. At the cap, the least
 * recently active idle session makes room; if every session has an open stream, creation fails as
 * busy (503). A session whose tick throws (a detector bug, F04 follow-up 3) is stopped on its own;
 * the loop carries on with the others.
 */
import { randomUUID } from "node:crypto";
import {
  type AiMode,
  collapseDetector,
  type Detector,
  lineupDetector,
  nudgeDetector,
  roomDetector,
  type SessionCreateRequest,
} from "@sideline/engine";
import type { MatchBundle } from "../data/bundle.ts";
import type { Orchestrator } from "../orchestrator/orchestrator.ts";
import type { Telemetry } from "../telemetry/collector.ts";
import { createSession, type Session } from "./session.ts";

export type { Session } from "./session.ts";

export const DEFAULT_DETECTORS: readonly Detector[] = [
  lineupDetector,
  collapseDetector,
  nudgeDetector,
  roomDetector,
];
export const SESSION_TTL_MS = 30 * 60_000;
export const MAX_SESSIONS = 300;

/** Why a session could not be created: the routes map these to 404 and 503. */
export class SessionError extends Error {
  readonly code: "unknown_match" | "unknown_persona" | "busy";
  constructor(code: SessionError["code"], message: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

export interface SessionManager {
  create(request: SessionCreateRequest): Session;
  get(id: string): Session | undefined;
  tick(): void;
  size(): number;
  /** Resolves when every session's AI work has finished (tests, shutdown). */
  settle(): Promise<void>;
}

export function createSessionManager(deps: {
  bundles: ReadonlyMap<string, MatchBundle>;
  orchestrator: Orchestrator;
  telemetry: Telemetry;
  aiMode: () => AiMode;
  now: () => number;
  nowMicros?: () => number;
  detectors?: readonly Detector[];
  ttlMs?: number;
  maxSessions?: number;
  newId?: () => string;
}): SessionManager {
  const sessions = new Map<string, Session>();
  const ttlMs = deps.ttlMs ?? SESSION_TTL_MS;
  const maxSessions = deps.maxSessions ?? MAX_SESSIONS;
  const newId = deps.newId ?? randomUUID;
  const nowMicros = deps.nowMicros ?? (() => Number(process.hrtime.bigint() / 1000n));

  const idle = (session: Session) =>
    session.listeners() === 0 && deps.now() - session.lastActivity() > ttlMs;

  function evict(session: Session): void {
    sessions.delete(session.id);
    deps.telemetry.forgetSession(session.id);
  }

  return {
    create(request) {
      const bundle = deps.bundles.get(request.matchId);
      if (!bundle) throw new SessionError("unknown_match", `unknown match ${request.matchId}`);
      const persona = bundle.personas.find((p) => p.id === request.personaId);
      if (!persona) {
        throw new SessionError("unknown_persona", `unknown persona ${request.personaId}`);
      }
      if (sessions.size >= maxSessions) {
        const quiet = [...sessions.values()]
          .filter((s) => s.listeners() === 0)
          .sort((a, b) => a.lastActivity() - b.lastActivity())[0];
        if (!quiet) throw new SessionError("busy", "the server is busy: every session is in use");
        evict(quiet);
      }
      const id = newId();
      deps.telemetry.registerSession(id, bundle.summary.id);
      const session = createSession(
        { id, persona, delayMs: request.delayMs, lens: request.lens },
        {
          bundle,
          orchestrator: deps.orchestrator,
          telemetry: deps.telemetry,
          detectors: deps.detectors ?? DEFAULT_DETECTORS,
          aiMode: deps.aiMode,
          now: deps.now,
          nowMicros,
        },
      );
      sessions.set(id, session);
      return session;
    },

    get: (id) => sessions.get(id),

    tick() {
      for (const session of [...sessions.values()]) {
        if (idle(session)) {
          evict(session);
          continue;
        }
        try {
          session.tick();
        } catch (error) {
          session.fail(error);
        }
      }
    },

    size: () => sessions.size,

    async settle() {
      await Promise.all([...sessions.values()].map((s) => s.settle()));
    },
  };
}
