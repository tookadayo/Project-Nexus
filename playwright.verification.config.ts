import { defineConfig } from "@playwright/test";
import alpha17 from "./playwright.alpha17.config";

// The legacy verification spec imports the same isolated browser fixture.
export default defineConfig({
  ...alpha17,
  projects: undefined,
  testMatch: "verification.spec.ts",
  outputDir: "test-results",
  timeout: 30000,
  use: { ...alpha17.use, screenshot: "off", trace: "off" },
});
