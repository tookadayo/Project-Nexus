import { defineConfig } from "@playwright/test";
const web = Number(process.env.NEXUS_CHECKOUT_WEB_PORT ?? 3160),
  api = Number(process.env.NEXUS_CHECKOUT_API_PORT ?? 3161);
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "checkout.spec.ts",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${web}`,
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "corepack pnpm exec tsx tests/e2e/checkout-server.ts",
      url: `http://127.0.0.1:${api}/health`,
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command: "corepack pnpm exec tsx tests/e2e/checkout-web.ts",
      url: `http://127.0.0.1:${web}`,
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
