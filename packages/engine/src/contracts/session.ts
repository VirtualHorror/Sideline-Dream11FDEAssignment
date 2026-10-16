/**
 * Session, playback control and the SSE stream envelope.
 *
 * Each browser gets its own simulated match session on the server: its own stadium
 * clock (play/pause/speed/seek) and its own TV delay. The server pushes
 * StreamMessages over Server-Sent Events; the browser sends ControlRequests over
 * REST. Both sides validate against these schemas.
 */
import { z } from "zod";
import { ChatMessageSchema } from "./chat.ts";
import { MatchEventSchema } from "./events.ts";
import { MatchSummarySchema } from "./match.ts";
import { MomentSchema } from "./moments.ts";
import { MAX_DELAY_MS, PersonaSchema } from "./persona.ts";
import { InningsNumberSchema, LensSchema, MatchIdSchema, MatchTimeSchema } from "./primitives.ts";
import { TelemetrySnapshotSchema } from "./telemetry.ts";

/** Playback speeds offered by the UI. 1 = real time. */
export const SpeedSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(8),
  z.literal(16),
  z.literal(32),
]);
export type Speed = z.infer<typeof SpeedSchema>;

const DelayMsSchema = z.number().int().min(0).max(MAX_DELAY_MS);

export const ClockStateSchema = z.object({
  /** Stadium time at `wallAt`. Clients extrapolate: stadiumT + (now - wallAt) * speed while playing. */
  stadiumT: MatchTimeSchema,
  speed: SpeedSchema,
  playing: z.boolean(),
  delayMs: DelayMsSchema,
  /** Server epoch ms when this snapshot was taken. */
  wallAt: z.number().int().nonnegative(),
});
export type ClockState = z.infer<typeof ClockStateSchema>;

export const JumpTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("toss") }),
  z.object({
    kind: z.literal("over"),
    innings: InningsNumberSchema,
    afterOvers: z.number().int().min(0).max(19),
  }),
  z.object({ kind: z.literal("event"), eventId: z.string() }),
]);
export type JumpTarget = z.infer<typeof JumpTargetSchema>;

export const ControlRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("play") }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("speed"), value: SpeedSchema }),
  z.object({ action: z.literal("seek"), t: MatchTimeSchema }),
  z.object({ action: z.literal("jump"), target: JumpTargetSchema }),
  z.object({ action: z.literal("delay"), ms: DelayMsSchema }),
  z.object({ action: z.literal("lens"), lens: LensSchema }),
]);
export type ControlRequest = z.infer<typeof ControlRequestSchema>;

export const SessionCreateRequestSchema = z.object({
  matchId: MatchIdSchema,
  personaId: z.string().regex(/^[a-z0-9-]+$/),
  delayMs: DelayMsSchema.optional(),
  lens: LensSchema.optional(),
});
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;

export const SessionCreateResponseSchema = z.object({
  sessionId: z.string().min(1),
  streamUrl: z.string().min(1),
});
export type SessionCreateResponse = z.infer<typeof SessionCreateResponseSchema>;

/**
 * live   = an LLM provider is configured and within budget
 * replay = no provider; serve LLM outputs recorded earlier, else deterministic fallback
 * off    = deterministic fallbacks only
 */
export const AiModeSchema = z.enum(["live", "replay", "off"]);
export type AiMode = z.infer<typeof AiModeSchema>;

const envelope = { v: z.literal(1), seq: z.number().int().nonnegative() };

export const StreamMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...envelope,
    type: z.literal("hello"),
    data: z.object({
      sessionId: z.string(),
      match: MatchSummarySchema,
      persona: PersonaSchema,
      aiMode: AiModeSchema,
    }),
  }),
  /** Full resync: sent on connect and after every seek/jump. Clients replace state. */
  z.object({
    ...envelope,
    type: z.literal("snapshot"),
    data: z.object({
      clock: ClockStateSchema,
      events: z.array(MatchEventSchema),
      moments: z.array(MomentSchema),
      chat: z.array(ChatMessageSchema),
    }),
  }),
  z.object({
    ...envelope,
    type: z.literal("events"),
    data: z.object({ events: z.array(MatchEventSchema) }),
  }),
  z.object({ ...envelope, type: z.literal("moment"), data: z.object({ moment: MomentSchema }) }),
  z.object({
    ...envelope,
    type: z.literal("chat"),
    data: z.object({ messages: z.array(ChatMessageSchema) }),
  }),
  z.object({ ...envelope, type: z.literal("clock"), data: z.object({ clock: ClockStateSchema }) }),
  z.object({
    ...envelope,
    type: z.literal("telemetry"),
    data: z.object({ telemetry: TelemetrySnapshotSchema }),
  }),
  z.object({
    ...envelope,
    type: z.literal("error"),
    data: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type StreamMessage = z.infer<typeof StreamMessageSchema>;
export type StreamMessageType = StreamMessage["type"];
