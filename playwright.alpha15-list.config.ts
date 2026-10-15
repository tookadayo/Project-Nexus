import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "alpha15-list-editor.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4191", screenshot: "only-on-failure" },
});
