import { defineConfig } from "@playwright/test";

// Render actual Discord payloads locally; no API/Web/Gateway service or live server.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "discord-panels.spec.ts",
  workers: 1,
  fullyParallel: false,
  use: { screenshot: "only-on-failure" },
  outputDir: "test-results/discord-layout",
});
