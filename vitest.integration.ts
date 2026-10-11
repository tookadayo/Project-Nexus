import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: { "server-only": resolve("tests/fixtures/server-only.ts") },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
