import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const { databaseUrl } = JSON.parse(
  await readFile(".local/verification-e2e.json", "utf8"),
) as { databaseUrl: string };
const port = Number(process.env.NEXUS_VERIFICATION_WEB_PORT ?? 3150),
  apiPort = Number(process.env.NEXUS_VERIFICATION_API_PORT ?? 3151);
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
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require="${resolve("tests/e2e/verification-fetch.cjs").replaceAll("\\", "/")}"`,
      DATABASE_URL: databaseUrl,
      IDENTITY_KEY: "aa".repeat(32),
      LOOKUP_KEY: "bb".repeat(32),
      COMPONENT_KEY: "verification-components",
      DISCORD_TOKEN: "verification-bot",
      DISCORD_APPLICATION_ID: "941111111111111111",
      DISCORD_CLIENT_SECRET: "verification-client",
      NEXUS_SESSION_SECRET: "s".repeat(64),
      NEXUS_WEB_URL: `http://127.0.0.1:${port}`,
      NEXUS_WEB_AUTH_MODE: "oauth",
      NEXUS_API_URL: `http://127.0.0.1:${apiPort + 2}`,
      API_KEY: "verification-api-key",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXUS_DISCORD_BILLING_ENABLED: "false",
      // Explicit developer locale lets this fixture exercise the unconfigured
      // provider boundary. Discord parity failures have dedicated tests.
      NEXUS_BILLING_DEVELOPER_COUNTRY: "JP",
      NEXUS_INTERNAL_ADMIN_IDS: "911111111111111111",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
