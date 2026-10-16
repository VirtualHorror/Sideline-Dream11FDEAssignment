import { defineConfig } from "vitest/config";

// Root Vitest entry: each workspace package owns its own vitest.config.ts
// (environment, include globs). `pnpm test` runs them all from here.
export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      "scripts/vitest.config.ts",
    ],
  },
});
