/**
 * The AI chain (D-079): one provider made of ordered links (Groq's and Gemini's free tiers, then the
 * OpenAI-compatible key), so a rate limit or an outage on one link is answered by the next one
 * instead of by the labelled fallback.
 *
 * Built by runtime.ts createProvider from config.ai.chain; called by ai/gateway.ts like any provider
 * (one complete() per gateway run, under the skill's timeout). A request goes to the links in order
 * and the first answer wins; the result names the link that gave it (`provider`, `model`) and the
 * links passed over before it (`route`, which the gateway writes into the trace). A link is passed
 * over while it cools down, once it has used its daily cap, and when it fails to answer:
 *   429                      cools down for its retry-after (30 s without one, at most an hour)
 *   401, 403, 404            10 minutes: a bad or blocked key, an account out of credit, a model gone
 *   5xx, a network failure,  15 s (a share under MIN_CALL_MS, cut short by the time left, says
 *   no answer in its share   nothing about the link: not asked again for this request only)
 *   400, 413, 422            not asked again for this request only (it could not take this one)
 * A link that answered, but unusably (a refusal, text that is not JSON), ends the request: the
 * gateway records it against that link, as it would for a single provider. When every link is cooling
 * down, the chain waits for the soonest one if that leaves MIN_CALL_MS of the skill's time (a minute's
 * tokens on Groq's free tier come back within seconds); otherwise it throws ChainExhaustedError, a
 * provider error naming each link's reason. While a later link could still answer, a link gets at
 * most half the time left, so one hung link cannot use up the whole timeout.
 *
 * Cooldowns live in memory (a restart forgets them; the next 429 brings them back). Daily caps count
 * every request sent, answered or not, per Pacific-time day (Google resets its quotas at midnight
 * Pacific) in a LinkLedger: the server's is its SQLite database (ai/budget.ts createLinkLedger), so a
 * restart does not reset them; scripts and tests use memoryLedger.
 */
import { setTimeout as wait } from "node:timers/promises";
import {
  ChainExhaustedError,
  errorParts,
  type LlmProvider,
  ProviderOutputError,
  ProviderRefusalError,
  type ProviderRequest,
  type ProviderResult,
} from "./types.ts";

export interface ChainLink {
  provider: LlmProvider;
  models: { fast: string; smart: string };
  /** At most this many requests a Pacific-time day; null: no cap. */
  dailyCap: number | null;
}

/** Requests sent per link ("<provider>:<model>") and quota day (YYYY-MM-DD). */
export interface LinkLedger {
  count(link: string, day: string): number;
  /** Counts one request, before it is sent. */
  add(link: string, day: string): void;
}

/** A ledger that a restart forgets: `pnpm ai:record`, `pnpm ai:smoke` and tests. */
export function memoryLedger(): LinkLedger {
  const counts = new Map<string, number>();
  return {
    count: (link, day) => counts.get(`${day} ${link}`) ?? 0,
    add(link, day) {
      counts.set(`${day} ${link}`, (counts.get(`${day} ${link}`) ?? 0) + 1);
    },
  };
}

const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The quota day of a wall time (ms): Google resets its daily quotas at midnight Pacific time. */
export function quotaDay(ms: number): string {
  return PACIFIC_DAY.format(ms);
}

const RATE_LIMIT_MS = 30_000;
const RETRY_AFTER_MAX_MS = 3_600_000;
const BROKEN_MS = 600_000;
const OUTAGE_MS = 15_000;
/** A wait for a cooldown must leave this much of the skill's time for the call itself. */
const MIN_CALL_MS = 2_000;
/** Rounds of asking and waiting per request; each wait uses up time, this only bounds a bad clock. */
const MAX_ROUNDS = 5;

/** The retry-after header of an SDK error, in ms (Groq sends whole or decimal seconds). */
function retryAfterMs(error: unknown): number | null {
  const headers = (error as { headers?: unknown } | null)?.headers;
  const value = headers instanceof Headers ? headers.get("retry-after") : null;
  const seconds = value === null ? Number.NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** Why a link did not answer (statuses and codes only) and how long to leave it alone. */
function failure(error: unknown, timedOutMs: number | null): { reason: string; coolMs: number } {
  // A share under MIN_CALL_MS was cut by the time left, not by the link: it says nothing about it.
  if (timedOutMs !== null) {
    const coolMs = timedOutMs >= MIN_CALL_MS ? OUTAGE_MS : 0;
    return { reason: `no answer within ${timedOutMs} ms`, coolMs };
  }
  const parts = errorParts(error);
  const reason =
    parts.length > 0
      ? parts.join(", ")
      : error instanceof Error
        ? error.constructor.name
        : typeof error;
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 429) {
    const after = retryAfterMs(error);
    const coolMs =
      after === null ? RATE_LIMIT_MS : Math.min(Math.max(after, 1_000), RETRY_AFTER_MAX_MS);
    return { reason, coolMs };
  }
  if (status === 401 || status === 403 || status === 404) return { reason, coolMs: BROKEN_MS };
  if (status === 400 || status === 413 || status === 422) return { reason, coolMs: 0 };
  return { reason, coolMs: OUTAGE_MS };
}

export function createChainProvider(opts: {
  links: readonly ChainLink[];
  ledger?: LinkLedger;
  /** Wall clock (ms) for cooldowns, caps and the time left; injected in tests. */
  now?: () => number;
  /** Waits for a cooldown; rejects when the request is aborted. Injected in tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): LlmProvider {
  const ledger = opts.ledger ?? memoryLedger();
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms, signal) => wait(ms, undefined, { signal }));
  const coolingUntil = new Map<string, number>();

  return {
    name: "chain",
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const started = now();
      const left = () => req.timeoutMs - (now() - started);
      const at = (index: number) => {
        const link = opts.links[index] as ChainLink;
        const model = link.models[req.tier];
        return { link, model, id: `${link.provider.name}:${model}` };
      };
      const label = (index: number) => `${at(index).link.provider.name} ${at(index).model}`;
      const coolsUntil = (index: number) => coolingUntil.get(at(index).id) ?? 0;
      const capped = (index: number) => {
        const { link, id } = at(index);
        return link.dailyCap !== null && ledger.count(id, quotaDay(now())) >= link.dailyCap;
      };
      // Why each link has not answered this request (its latest reason), and the links not to ask
      // again in it: over their cap, or unable to take this request.
      const reasons = new Map<number, string>();
      const done = new Set<number>();
      const askable = (index: number) =>
        !done.has(index) && coolsUntil(index) <= now() && !capped(index);

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        for (const [index, link] of opts.links.entries()) {
          if (done.has(index)) continue;
          const { model, id } = at(index);
          if (coolsUntil(index) > now()) {
            if (!reasons.has(index)) reasons.set(index, "cooling down");
            continue;
          }
          if (capped(index)) {
            reasons.set(index, `${link.dailyCap} a day used`);
            done.add(index);
            continue;
          }
          if (req.signal.aborted) throw req.signal.reason;
          const backup = opts.links.some((_, later) => later > index && askable(later));
          const shareMs = Math.max(1, Math.round(backup ? left() / 2 : left()));
          const attempt = new AbortController();
          const timer = setTimeout(() => attempt.abort(), shareMs);
          if (link.dailyCap !== null) ledger.add(id, quotaDay(now()));
          try {
            const result = await link.provider.complete({
              ...req,
              model,
              signal: AbortSignal.any([req.signal, attempt.signal]),
            });
            const passed = [...reasons]
              .filter(([earlier]) => earlier < index)
              .sort(([a], [b]) => a - b)
              .map(([earlier, why]) => `${label(earlier)} (${why})`);
            return {
              ...result,
              provider: link.provider.name,
              ...(passed.length > 0 ? { route: `passed over ${passed.join("; ")}` } : {}),
            };
          } catch (error) {
            // The gateway's own timeout: it records the run, and no other link is asked.
            if (req.signal.aborted) throw error;
            const served = { provider: link.provider.name, model };
            if (error instanceof ProviderRefusalError) {
              throw new ProviderRefusalError(error.message, error.usage, served);
            }
            if (error instanceof ProviderOutputError) {
              throw new ProviderOutputError(error.message, error.usage, served);
            }
            const failed = failure(error, attempt.signal.aborted ? shareMs : null);
            reasons.set(index, failed.reason);
            if (failed.coolMs > 0) coolingUntil.set(id, now() + failed.coolMs);
            else done.add(index);
          } finally {
            clearTimeout(timer);
          }
        }
        // No link answered this round: wait for the soonest cooldown when the call still fits after.
        const soonest = Math.min(
          ...opts.links.flatMap((_, index) =>
            !done.has(index) && coolsUntil(index) > now() ? [coolsUntil(index) - now()] : [],
          ),
        );
        if (!(soonest + MIN_CALL_MS <= left())) break;
        await sleep(soonest, req.signal);
      }
      throw new ChainExhaustedError(
        opts.links
          .map((_, index) => `${label(index)} (${reasons.get(index) ?? "not asked"})`)
          .join("; "),
      );
    },
  };
}
