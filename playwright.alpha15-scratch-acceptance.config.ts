import { defineConfig } from "@playwright/test";

/** Finite Scratch acceptance checks with real components and synthetic local APIs. */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "alpha15-scratch-acceptance.spec.ts",
  outputDir: ".local/alpha15-scratch-acceptance/results",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4193",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
});
