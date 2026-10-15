import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "alpha15-temporal-editor.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4193", screenshot: "only-on-failure" },
});
