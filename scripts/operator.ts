import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { z } from "zod";
import { connect } from "../packages/db/src/index";
import {
  OperatorAuth,
  readOperatorCredentials,
} from "../packages/security/src/operator-auth";
import { BetaOperator } from "../packages/security/src/beta-operator";
import { DiscordRest } from "../packages/discord/src/rest";
import { createOperatorServer } from "../apps/operator/src/server";
try {
  loadEnvFile();
} catch {
  /* Environment validation follows. */
}
const port = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65535)
  .default(3210)
  .parse(process.env.NEXUS_OPERATOR_PORT);
if (
  [
    Number(process.env.NEXUS_WEB_PORT ?? 3100),
    Number(process.env.API_PORT ?? 3001),
    Number(process.env.INTERACTION_PORT ?? 3002),
  ].includes(port)
)
  throw new Error("Operator requires a separate port.");
const db = connect(z.url().parse(process.env.DATABASE_URL));
const path = resolve(
  process.env.NEXUS_OPERATOR_CREDENTIALS ?? ".local/operator/credentials.json",
);
const auth = new OperatorAuth(db, () => readOperatorCredentials(path));
const beta = new BetaOperator(db, async (guildId) => {
  const token = z.string().min(1).parse(process.env.DISCORD_TOKEN),
    id = z
      .string()
      .regex(/^\d{17,20}$/)
      .parse(process.env.DISCORD_APPLICATION_ID);
  const bot = await new DiscordRest(token, id).member(guildId, id);
  const permissions = BigInt(bot.permissions);
  return {
    name: bot.guildName ?? guildId,
    present: bot.bot,
    canObserve: (permissions & 8n) !== 0n || (permissions & 1024n) !== 0n,
    checkedAt: Date.now(),
  };
});
const server = createOperatorServer(db, auth, beta, `http://127.0.0.1:${port}`);
await server.listen({ host: "127.0.0.1", port });
process.stdout.write(`NEXUS operator: http://127.0.0.1:${port} (local only)\n`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await db.destroy();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
