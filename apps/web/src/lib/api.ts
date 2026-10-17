/**
 * The browser's side of the REST API (Flow §2; shapes in HANDOFF7's "Code Context" and D-060). Every
 * response is validated with the engine's own schemas; every failure becomes an `ApiError` carrying
 * the server's `{ error: { code, message } }` and, for a 429, its Retry-After.
 *
 * Callers: pages/Landing.tsx (matches), pages/MatchRoom.tsx (match detail, session, control, ask).
 * The SSE stream itself is opened by stream/useSessionStream.ts.
 */
import {
  type ClockState,
  ClockStateSchema,
  type ControlRequest,
  type FantasyRules,
  FantasyRulesSchema,
  type Lens,
  type MatchSummary,
  MatchSummarySchema,
  type Moment,
  MomentSchema,
  type Persona,
  PersonaSchema,
  type Player,
  PlayerSchema,
  type SessionCreateRequest,
  type SessionCreateResponse,
  SessionCreateResponseSchema,
  type WinProbModel,
  WinProbModelSchema,
} from "@sideline/engine";

export type PersonaChoice = Pick<Persona, "id" | "label" | "blurb" | "lens" | "delayMs">;
export type MatchListing = MatchSummary & { personas: PersonaChoice[] };
export interface MatchDetail {
  match: MatchSummary;
  players: Player[];
  rules: FantasyRules;
  winprob: WinProbModel;
}

const ListingSchema = MatchSummarySchema.extend({
  personas: PersonaSchema.pick({
    id: true,
    label: true,
    blurb: true,
    lens: true,
    delayMs: true,
  }).array(),
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;
  constructor(status: number, code: string, message: string, retryAfterSec: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch {
    throw new ApiError(0, "network", "Sideline's server is not answering. Check your connection.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const retry = Number(response.headers.get("retry-after"));
    throw new ApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "http_error",
      typeof error?.message === "string"
        ? error.message
        : `The server answered ${response.status}.`,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  return body;
}

function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(200, "invalid_response", "The server sent something Sideline cannot read.");
  }
  return parsed.data;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export const api = {
  async matches(): Promise<MatchListing[]> {
    const body = (await call("/api/matches")) as { matches?: unknown };
    return parse(ListingSchema.array(), body?.matches);
  },

  async matchDetail(matchId: string): Promise<MatchDetail> {
    const body = (await call(`/api/matches/${encodeURIComponent(matchId)}`)) as Record<
      string,
      unknown
    >;
    return {
      match: parse(MatchSummarySchema, body?.match),
      players: parse(PlayerSchema.array(), body?.players),
      rules: parse(FantasyRulesSchema, body?.rules),
      winprob: parse(WinProbModelSchema, body?.winprob),
    };
  },

  async createSession(request: SessionCreateRequest): Promise<SessionCreateResponse> {
    return parse(SessionCreateResponseSchema, await call("/api/sessions", post(request)));
  },

  async control(sessionId: string, request: ControlRequest): Promise<ClockState> {
    const body = (await call(`${sessionPath(sessionId)}/control`, post(request))) as {
      clock?: unknown;
    };
    return parse(ClockStateSchema, body?.clock);
  },

  async ask(sessionId: string, text: string, lens?: Lens): Promise<Moment> {
    const body = (await call(`${sessionPath(sessionId)}/ask`, post({ text, lens }))) as {
      moment?: unknown;
    };
    return parse(MomentSchema, body?.moment);
  },
};
