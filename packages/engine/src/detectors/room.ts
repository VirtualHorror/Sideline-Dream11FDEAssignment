/**
 * Phase 4 (climax): when to read the watch-along room. A busy chat is a firehose nobody can
 * follow; a room read clusters it into the few debates that matter, once per over.
 *
 * Callers: the gate (every event) and, through the trigger, the room-read skill (Task 8), whose
 * guard accepts only message ids listed in the facts. Two rules (PLAN Task 4): after each over
 * from the 16th (labels 15.6 on, the death overs), or when the last minute of chat runs more than
 * two standard deviations above the session's per-minute average.
 *
 * The key is shared (`room:<match>:<innings>:<over>`), so the facts hold only shared data: the
 * crowd's messages, never the fan's own (`fromYou`), which belong to one session (D-045).
 */
import type { ChatMessage } from "../contracts/chat.ts";
import { situationOfInnings, WICKETS_PER_INNINGS } from "./facts.ts";
import type { Detector, RoomFacts } from "./types.ts";

/** Room reads after every over from this over index on (the 16th over, labels 15.6+). */
const DEATH_OVER = 15;
/** A room read summarises the last five minutes of chat, about one over of play. */
const WINDOW_MS = 300_000;
/** At most this many distinct messages go into the facts (PLAN Task 4). */
const MAX_MESSAGES = 60;
const MINUTE_MS = 60_000;
/** A spike is a last minute above mean + 2 SD of the earlier minutes... */
const SPIKE_SD = 2;
/** ...measured over at least ten earlier minutes, so a quiet start cannot look like a spike. */
const MIN_HISTORY_MINUTES = 10;

/**
 * The last minute's count against the per-minute counts before it. Minute k (k ≥ 1) is
 * (now − 60 s·(k+1), now − 60 s·k], back to the minute holding the first message; empty minutes
 * count as 0. Standard deviation is the population one.
 */
export function chatRate(messages: readonly ChatMessage[], now: number): RoomFacts["rate"] {
  const lastMinute = messages.filter((m) => m.t > now - MINUTE_MS && m.t <= now).length;
  const first = Math.min(...messages.map((m) => m.t));
  const minutes = Math.max(0, Math.ceil((now - first) / MINUTE_MS) - 1);
  const counts = new Array<number>(minutes).fill(0);
  for (const message of messages) {
    const k = Math.ceil((now - message.t) / MINUTE_MS) - 1;
    if (k >= 1 && k <= minutes) counts[k - 1] = (counts[k - 1] ?? 0) + 1;
  }
  const mean = minutes > 0 ? counts.reduce((sum, n) => sum + n, 0) / minutes : 0;
  const sd =
    minutes > 0 ? Math.sqrt(counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / minutes) : 0;
  return {
    lastMinute,
    meanPerMinute: mean,
    sdPerMinute: sd,
    threshold: mean + SPIKE_SD * sd,
    minutes,
  };
}

export const roomDetector: Detector = {
  name: "room",
  evaluate({ after, event, events, ctx, chat }) {
    if (event.kind !== "delivery") return { outcome: "deterministic", reason: "not_delivery" };
    // Shared messages up to this moment only: nothing from the future, nothing personal.
    const crowd = (chat ?? []).filter((message) => !message.fromYou && message.t <= event.t);
    if (crowd.length === 0) return { outcome: "deterministic", reason: "no_chat" };
    // The rate compares minutes of this innings only: the quiet pre-match half hour and the
    // innings break are a different regime and would make the first balls look like a spike.
    const inningsStart = events.find(
      (candidate) =>
        candidate.kind === "innings_start" &&
        candidate.innings === event.innings &&
        candidate.seq < event.seq,
    );
    const inPlay = crowd.filter((message) => message.t > (inningsStart?.t ?? -1));

    const innings = after.innings.find((candidate) => candidate.innings === event.innings);
    if (!innings) throw new Error(`no innings ${event.innings} at ${event.id}`);
    // An innings that ends mid-over (all out, target reached) also closes its last over.
    const inningsOver =
      innings.wickets >= WICKETS_PER_INNINGS ||
      (innings.target !== null && innings.runs >= innings.target.runs);
    const overEnd =
      event.over >= DEATH_OVER && ((event.isLegal && event.ballInOver === 6) || inningsOver);
    const rate = inPlay.length > 0 ? chatRate(inPlay, event.t) : null;
    const spike =
      rate !== null && rate.minutes >= MIN_HISTORY_MINUTES && rate.lastMinute > rate.threshold;
    if (!overEnd && !spike) return { outcome: "deterministic", reason: "quiet" };

    const fromT = event.t - WINDOW_MS;
    const inWindow = crowd.filter((message) => message.t > fromT).sort((a, b) => a.t - b.t);
    // Deduplicate by text, keeping each line's latest posting, then the most recent 60.
    const latest = new Map<string, ChatMessage>();
    for (const message of inWindow) {
      latest.delete(message.text);
      latest.set(message.text, message);
    }
    const messages = [...latest.values()].slice(-MAX_MESSAGES).map((message) => ({
      id: message.id,
      text: message.text,
      stance: message.stance,
      affinity: message.affinity,
    }));
    const stanceCounts: Record<string, number> = {};
    for (const message of inWindow) {
      const stance = message.stance ?? "none";
      stanceCounts[stance] = (stanceCounts[stance] ?? 0) + 1;
    }
    const why = overEnd ? "death_over_end" : "chat_spike";
    const facts: RoomFacts = {
      matchId: ctx.matchId,
      innings: event.innings,
      over: event.over,
      why,
      window: { fromT, toT: event.t },
      messageCount: inWindow.length,
      messages,
      stanceCounts,
      rate: rate ?? chatRate(crowd, event.t),
      situation: situationOfInnings(innings),
    };
    return {
      outcome: "ai_trigger",
      reason: why,
      trigger: {
        kind: "room_read",
        key: `room:${ctx.matchId}:${event.innings}:${event.over}`,
        scope: "shared",
        facts,
      },
    };
  },
};
