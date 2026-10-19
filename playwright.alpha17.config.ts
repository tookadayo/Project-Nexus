import { defineConfig } from "@playwright/test";

// Isolated synthetic acceptance origin. Never use a production endpoint here.
const origin = "https://app.nexus.test:3150";
for (const [key, value] of Object.entries({
  NEXUS_VERIFICATION_WEB_ORIGIN: origin,
  NEXUS_VERIFICATION_WEB_PORT: "3150",
  NEXUS_VERIFICATION_API_PORT: "3151",
})) {
  if (process.env[key] && process.env[key] !== value) throw new Error("TEST_VERIFICATION_ENDPOINT_MISMATCH");
  process.env[key] = value;
}
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["alpha17-core-setup.spec.ts", "alpha17-operations-phases.spec.ts"],
  outputDir: ".local/alpha17-e2e/results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  projects: [
    { name: "alpha17-core", testMatch: "alpha17-core-setup.spec.ts", timeout: 30000 },
    // Retain the existing isolated phases budget, not the monolithic smoke result.
    { name: "alpha17-operations", testMatch: "alpha17-operations-phases.spec.ts", timeout: 60000 },
  ],
  use: {
    baseURL: origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    proxy: { server: "http://127.0.0.1:3155" },
    screenshot: "only-on-failure",
    trace: "off",
    launchOptions: {
      args: [
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--host-resolver-rules=MAP app.nexus.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      ],
    },
  },
  webServer: [
    {
      command: "corepack pnpm exec tsx tests/e2e/verification-server.ts",
      url: "http://127.0.0.1:3151/health",
      timeout: 60000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
    },
    {
      command: "corepack pnpm exec tsx tests/e2e/alpha17-verification-web.ts",
      url: "http://127.0.0.1:3154",
      timeout: 60000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
    },
  ],
});
