import { defineConfig } from "@playwright/test";

// End-to-end smoke tests against the real production build served by the Node server.
// Uses the machine's installed Google Chrome (channel "chrome"): no browser download, no
// sudo-only system deps. Screenshots land in test-results/ for visual review.
const PORT = 8799;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
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
  webServer: {
    command: "pnpm build && node apps/server/src/index.ts",
    env: { PORT: String(PORT), HOST: "127.0.0.1", NODE_ENV: "test" },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
