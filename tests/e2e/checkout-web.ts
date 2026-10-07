import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const { databaseUrl } = JSON.parse(
  await readFile(".local/checkout-e2e.json", "utf8"),
) as { databaseUrl: string };
const port = Number(process.env.NEXUS_CHECKOUT_WEB_PORT ?? 3160),
  apiPort = Number(process.env.NEXUS_CHECKOUT_API_PORT ?? 3161);
const child = spawn(
  process.execPath,
  [
    resolve("apps/web/node_modules/next/dist/bin/next"),
    "start",
    "--port",
    String(port),
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: resolve("apps/web"),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import="${resolve("tests/e2e/checkout-fetch.mjs")}"`,
      NEXUS_VERIFICATION_API_PORT: String(apiPort),
      DATABASE_URL: databaseUrl,
      IDENTITY_KEY: "aa".repeat(32),
      LOOKUP_KEY: "bb".repeat(32),
      COMPONENT_KEY: "checkout-components",
      DISCORD_TOKEN: "checkout-bot",
      DISCORD_APPLICATION_ID: "941111111111111111",
      DISCORD_CLIENT_SECRET: "checkout-client",
      NEXUS_SESSION_SECRET: "s".repeat(64),
      NEXUS_WEB_URL: `http://127.0.0.1:${port}`,
      NEXUS_WEB_AUTH_MODE: "oauth",
      NEXUS_STRIPE_ENABLED: "true",
      NEXUS_STRIPE_MODE: "SANDBOX",
      STRIPE_SECRET_KEY: "sk_test_fixture_checkout",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture_checkout",
      STRIPE_PUBLISHABLE_KEY: "pk_test_fixture_checkout",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
      NEXUS_BILLING_DEVELOPER_COUNTRY: "JP",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
