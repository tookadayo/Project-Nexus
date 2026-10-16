import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "alpha15-datetime-controls.spec.ts",
  outputDir: ".local/alpha15-datetime-20261016/controls/browser-results",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4196",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
});
