import { defineConfig } from "@playwright/test";
/** Finite new datetime cases using real components and intercepted synthetic APIs. */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "alpha15-datetime-v2.spec.ts",
  outputDir: ".local/alpha15-datetime-20261016/ui-results",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4197",
    locale: "en-US",
    timezoneId: "Pacific/Honolulu",
    screenshot: "only-on-failure",
  },
});
