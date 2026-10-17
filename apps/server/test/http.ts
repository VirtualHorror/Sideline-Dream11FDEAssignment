/** The HTTP app over a test runtime, plus helpers to call it as a given client address. */
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";
import { testRuntime } from "./runtime.ts";

export const ROOT = "/srv/sideline-test";

export function testApp(
  opts: Parameters<typeof testRuntime>[0] & { env?: Record<string, string> } = {},
) {
  const rt = testRuntime(opts);
  const config = loadConfig(opts.env ?? {}, ROOT);
  const app = createApp({
    config,
    version: "9.9.9",
    startedAt: rt.clock.now(),
    now: rt.clock.now,
    runtime: {
      bundles: rt.bundles,
      manager: rt.manager,
      telemetry: rt.telemetry,
      askPerMinute: config.ai.askPerMinute,
      heartbeatMs: 50,
    },
  });
  /** A request from `ip`: the socket's peer address, where @hono/node-server reads it. */
  const call = (path: string, init: RequestInit = {}, ip = "203.0.113.7") =>
    app.request(path, init, { incoming: { socket: { remoteAddress: ip } } });
  const post = (path: string, body: unknown, ip?: string) =>
    call(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      ip,
    );
  return { ...rt, app, call, post };
}
