import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";

// A throwaway "repo" whose apps/web/dist holds a fake build, plus a secret one level up
// that must never be reachable over HTTP.
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sideline-app-test-"));
  const dist = join(root, "apps", "web", "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Sideline test build</title>");
  writeFileSync(join(dist, "assets", "app.js"), "console.log('app')");
  writeFileSync(join(root, "apps", "web", "secret.txt"), "TOP-SECRET-OUTSIDE-DIST");
});

const makeApp = (env: Record<string, string> = {}) =>
  createApp({ config: loadConfig(env, root), version: "9.9.9", startedAt: Date.now() - 5_000 });

describe("GET /api/health", () => {
  it("reports ok, version, uptime and the AI provider without secrets", async () => {
    const res = await makeApp({ ANTHROPIC_API_KEY: "sk-ant-SECRET" }).request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      service: "sideline",
      version: "9.9.9",
      aiProvider: "anthropic",
    });
    expect(body.uptimeSec).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
});

describe("routing", () => {
  it("answers unknown /api routes with a JSON 404, never the SPA page", async () => {
    const res = await makeApp().request("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "No API route for GET /api/nope" },
    });
  });

  it("serves built assets and falls back to index.html for client-side routes", async () => {
    const app = makeApp();
    const asset = await app.request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log('app')");
    const route = await app.request("/match/1298150");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("Sideline test build");
  });

  it("does not serve files outside the web build directory", async () => {
    const app = makeApp();
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]) {
      const res = await app.request(path);
      expect(await res.text(), path).not.toContain("TOP-SECRET-OUTSIDE-DIST");
    }
  });
});

describe("security headers", () => {
  it("sends a same-origin CSP and anti-sniffing/framing headers on every response", async () => {
    for (const path of ["/api/health", "/"]) {
      const res = await makeApp().request(path);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("default-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
    }
  });
});
