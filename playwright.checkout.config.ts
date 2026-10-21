import { defineConfig } from "@playwright/test";
import { checkoutContextOptions, checkoutOrigin } from "./tests/e2e/checkout-transport";
for (const [key, value] of Object.entries({ NEXUS_CHECKOUT_WEB_PORT: "3160", NEXUS_CHECKOUT_API_PORT: "3161", NEXUS_CHECKOUT_WEB_ORIGIN: checkoutOrigin })) {
  if (process.env[key] && process.env[key] !== value) throw new Error("TEST_CHECKOUT_ENDPOINT_MISMATCH");
  process.env[key] = value;
}
export default defineConfig({
  testDir: "tests/e2e", testMatch: "checkout.spec.ts", workers: 1, fullyParallel: false,
  use: {
    ...checkoutContextOptions, screenshot: "only-on-failure", trace: "off",
    launchOptions: { args: ["--proxy-bypass-list=<-loopback>", "--disable-quic",
      "--host-resolver-rules=MAP checkout.nexus.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"] },
  },
  webServer: [
    { command: "node --import tsx tests/e2e/alpha17-fixture-server-runner.ts checkout", url: "http://127.0.0.1:3161/health", timeout: 60000, reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15000 } },
    { command: "corepack pnpm exec tsx tests/e2e/checkout-web.ts", url: "http://127.0.0.1:3164", timeout: 60000, reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15000 } },
  ],
});
