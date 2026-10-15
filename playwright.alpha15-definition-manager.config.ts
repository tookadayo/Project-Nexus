import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "alpha15-definition-manager.spec.ts",
  outputDir: ".local/alpha15-definition-manager-results",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4194", screenshot: "only-on-failure" },
});
