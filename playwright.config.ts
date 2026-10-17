import { defineConfig } from "@playwright/test";

// End-to-end tests against the real production build served by the Node server. Uses the
// machine's installed Google Chrome (channel "chrome"): no browser download, no sudo-only system
// deps. Screenshots land in test-results/ for visual review.
//
// PLAYWRIGHT_BASE_URL=https://<host> runs the same tests against a deployed site instead (Task 7)
// and starts no local server. The local server is always keyless (SIDELINE_AI_PROVIDER=none), so
// no test can spend money, whatever keys the shell exports.
const PORT = 8799;
const deployed = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: deployed ?? `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: deployed
    ? undefined
    : {
        command: "pnpm build && node apps/server/src/index.ts",
        env: {
          PORT: String(PORT),
          HOST: "127.0.0.1",
          NODE_ENV: "test",
          SIDELINE_AI_PROVIDER: "none",
        },
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
