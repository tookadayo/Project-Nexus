import { loadEnvFile } from "node:process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { connect } from "../packages/db/src/index";
import {
  OperatorAuth,
  readOperatorCredentials,
} from "../packages/security/src/operator-auth";
import { loadAlpha17OperatorConfiguration } from "../packages/security/src/alpha17-operator-config";
import { BetaOperator } from "../packages/security/src/beta-operator";
import { DiscordRest } from "../packages/discord/src/rest";
import { createOperatorServer } from "../apps/operator/src/server";

export async function startOperator(options: { environmentAlreadyLoaded?: boolean } = {}): Promise<{ stop: () => Promise<void> }> {
  const production = process.env.NODE_ENV === "production";
  if (production) {
    const envPath = z.string().min(1).parse(process.env.NEXUS_ENV_FILE);
    if (!isAbsolute(envPath)) throw new Error("PRODUCTION_ENV_PATH_REQUIRED");
    // Production never implicitly reads a source-root .env.
    // The production supervisor passes its validated, fingerprinted snapshot.
    if (!options.environmentAlreadyLoaded) loadEnvFile(envPath);
  } else {
    if (!options.environmentAlreadyLoaded) {
      try { loadEnvFile(process.env.NEXUS_ENV_FILE); } catch { /* Validation follows. */ }
    }
  }
  if (production !== (process.env.NODE_ENV === "production"))
    throw new Error("OPERATOR_ENV_MODE_CHANGED_RESTART_REQUIRED");
  const port = z.coerce.number().int().min(1024).max(65535).default(3210)
    .parse(process.env.NEXUS_OPERATOR_PORT);
  if ([
    Number(process.env.NEXUS_WEB_PORT ?? 3100), Number(process.env.API_PORT ?? 3001),
    Number(process.env.INTERACTION_PORT ?? 3002),
  ].includes(port)) throw new Error("Operator requires a separate port.");
  const policyPath = z.string().min(1).parse(process.env.NEXUS_OPERATOR_POLICY_FILE);
  if (!isAbsolute(policyPath)) throw new Error("OPERATOR_POLICY_PATH_REQUIRED");
  const configuration = await loadAlpha17OperatorConfiguration(policyPath);
  const credentialsPath = production
    ? z.string().min(1).parse(process.env.NEXUS_OPERATOR_CREDENTIALS)
    : process.env.NEXUS_OPERATOR_CREDENTIALS ?? ".local/operator/credentials.json";
  if (production && !isAbsolute(credentialsPath)) throw new Error("OPERATOR_CREDENTIALS_PATH_REQUIRED");
  const dbUrl = z.url().parse(process.env.DATABASE_URL);
  if (production && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(dbUrl).hostname))
    throw new Error("OPERATOR_DATABASE_LOOPBACK_REQUIRED");
  const db = connect(dbUrl);
  try {
    const auth = new OperatorAuth(db, () => readOperatorCredentials(resolve(credentialsPath)));
    const beta = new BetaOperator(db, async (guildId) => {
      const token = z.string().min(1).parse(process.env.DISCORD_TOKEN);
      const id = z.string().regex(/^\d{17,20}$/).parse(process.env.DISCORD_APPLICATION_ID);
      const bot = await new DiscordRest(token, id).member(guildId, id);
      const permissions = BigInt(bot.permissions);
      return {
        name: bot.guildName ?? guildId, present: bot.bot,
        canObserve: (permissions & 8n) !== 0n || (permissions & 1024n) !== 0n,
        checkedAt: Date.now(),
      };
    });
    const server = createOperatorServer(db, auth, beta, `http://127.0.0.1:${port}`, {
      alpha16: configuration.alpha16, alpha17Maintenance: configuration.maintenance,
    });
    try {
      await server.listen({ host: "127.0.0.1", port });
    } catch (error) {
      await server.close();
      throw error;
    }
    process.stdout.write(`NEXUS operator: http://127.0.0.1:${port} (local only)\n`);
    let stopping: Promise<void> | undefined;
    return {
      stop: () => stopping ??= (async () => {
        configuration.maintenance.invalidate();
        try { await server.close(); } finally { await db.destroy(); }
      })(),
    };
  } catch (error) {
    configuration.maintenance.invalidate();
    await db.destroy();
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operator = await startOperator();
  process.on("SIGINT", () => void operator.stop());
  process.on("SIGTERM", () => void operator.stop());
}
