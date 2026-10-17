/**
 * Spend limits for model calls: a global daily USD cap and a per-session cap on provider calls.
 *
 * Called by ai/gateway.ts before every provider call (`admit`) and after it (`charge`). The daily
 * spend starts from today's rows in ai_calls (UTC day), so a restart does not reset the budget, and
 * resets when the UTC day changes. Over the cap the gateway serves cache and replay rows only, and
 * labelled fallbacks for the rest; the stream's aiMode reads "replay" (PLAN Task 5). The cap is
 * checked before a call, so the last call of the day may overshoot it by one call's cost.
 * createLinkLedger keeps the AI chain's per-link request counts for its daily caps (D-079).
 */
import type { DatabaseSync } from "node:sqlite";
import type { LinkLedger } from "./providers/chain.ts";

export interface Budget {
  /** Reserves one provider call for the session, or says why not. */
  admit(sessionId: string | null): { ok: true } | { ok: false; reason: string };
  /** Adds a finished call's cost to today's spend. */
  charge(costUsd: number): void;
  exhausted(): boolean;
  spentTodayUsd(): number;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createBudget(opts: {
  db: DatabaseSync;
  dailyUsd: number;
  sessionCap: number;
  now: () => number;
}): Budget {
  let day = dayOf(opts.now());
  const row = opts.db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM ai_calls WHERE started_at_wall >= ?")
    .get(`${day}T00:00:00.000Z`) as { spent: number };
  let spent = row.spent;
  const calls = new Map<string, number>();

  const rollover = () => {
    const today = dayOf(opts.now());
    if (today !== day) {
      day = today;
      spent = 0;
    }
  };

  return {
    admit(sessionId) {
      rollover();
      if (spent >= opts.dailyUsd) {
        return { ok: false, reason: `daily budget of $${opts.dailyUsd.toFixed(2)} spent` };
      }
      if (sessionId !== null) {
        const used = calls.get(sessionId) ?? 0;
        if (used >= opts.sessionCap) {
          return { ok: false, reason: `session cap of ${opts.sessionCap} calls reached` };
        }
        calls.set(sessionId, used + 1);
      }
      return { ok: true };
    },
    charge(costUsd) {
      rollover();
      spent += costUsd;
    },
    exhausted() {
      rollover();
      return spent >= opts.dailyUsd;
    },
    spentTodayUsd() {
      rollover();
      return spent;
    },
  };
}

/**
 * The AI chain's daily request counts (D-079) in ai_link_requests (migration 3), so a restart does
 * not hand a capped link a fresh day. Called by runtime.ts for the server's chain.
 */
export function createLinkLedger(db: DatabaseSync): LinkLedger {
  const select = db.prepare("SELECT requests FROM ai_link_requests WHERE day = ? AND link = ?");
  const upsert = db.prepare(
    `INSERT INTO ai_link_requests (day, link, requests) VALUES (?, ?, 1)
     ON CONFLICT (day, link) DO UPDATE SET requests = requests + 1`,
  );
  return {
    count(link, day) {
      const row = select.get(day, link) as { requests: number } | undefined;
      return row?.requests ?? 0;
    },
    add(link, day) {
      upsert.run(day, link);
    },
  };
}
