import { defineConfig } from "@playwright/test";
/** Real UI components with intercepted synthetic APIs; no production server or Discord calls. */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "alpha15-*.spec.ts",
  outputDir: ".local/alpha15-scratch-ui/results",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4193", screenshot: "only-on-failure" },
});
