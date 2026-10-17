/**
 * Per-address token buckets for fan questions (PLAN Task 5: 12 a minute, a burst of 4).
 *
 * Called by the ask route before any work is done. Each client address has a bucket of `burst`
 * tokens refilled at `perMinute`; an empty bucket answers 429 with Retry-After in seconds. The
 * address is the socket's peer; X-Forwarded-For is trusted only when the peer is this host (the
 * reverse proxy, Task 7), since anyone else could write any address into it.
 */
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

export const ASK_BURST = 4;
/** Above this many tracked addresses, full (idle) buckets are dropped. */
const MAX_TRACKED = 10_000;

export interface RateLimiter {
  take(key: string): { ok: true } | { ok: false; retryAfterSec: number };
}

export function createRateLimiter(opts: {
  perMinute: number;
  burst: number;
  now: () => number;
}): RateLimiter {
  const perMs = opts.perMinute / 60_000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  const level = (bucket: { tokens: number; at: number }, now: number) =>
    Math.min(opts.burst, bucket.tokens + (now - bucket.at) * perMs);

  return {
    take(key) {
      const now = opts.now();
      if (buckets.size > MAX_TRACKED) {
        for (const [k, b] of buckets) if (level(b, now) >= opts.burst) buckets.delete(k);
      }
      const tokens = level(buckets.get(key) ?? { tokens: opts.burst, at: now }, now);
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at: now });
        return { ok: true };
      }
      buckets.set(key, { tokens, at: now });
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) };
    },
  };
}

const isLoopback = (address: string) =>
  address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");

/** The client's address: the socket peer, or the proxy's X-Forwarded-For when the peer is local. */
export function clientIp(c: Context): string {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    peer = undefined; // an in-process request (tests without a socket)
  }
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && peer !== undefined && isLoopback(peer)) return forwarded;
  return peer ?? "unknown";
}
