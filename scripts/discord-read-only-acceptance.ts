import { loadEnvFile } from "node:process";
import { createHmac, randomBytes } from "node:crypto";
import { DiscordRest, isDiscordFailure } from "../packages/discord/src/rest.js";
import { buildCapabilitySnapshot } from "../packages/discord/src/discovery.js";

try {
  loadEnvFile();
} catch {
  /* Environment may be supplied by the operator. */
}
const token = process.env.DISCORD_TOKEN,
  application = process.env.DISCORD_APPLICATION_ID,
  guild = process.env.DISCORD_GUILD_ID || process.env.NEXUS_GUILD_ID;
if (!token || !application || !guild) {
  process.stdout.write(
    JSON.stringify({
      status: "NOT_RUN",
      reason: "Required development Discord configuration unavailable",
    }) + "\n",
  );
} else {
  try {
    const secret = randomBytes(32),
      discord = new DiscordRest(token, application),
      bot = await discord.member(guild, application),
      source = await discord.capabilityState(guild, (id) =>
        createHmac("sha256", secret).update(id).digest("hex"),
      ),
      snapshot = buildCapabilitySnapshot(source);
    // Emit categories and counts only. No channel names, guild/user IDs or credentials.
    process.stdout.write(
      JSON.stringify({
        status: "PARTIAL",
        checks: {
          restCapabilityDiscovery: "PASS",
          channelMetadataContract: "PASS",
          visibleChannels: snapshot.coverage.observableChannels,
          totalState: snapshot.coverage.totalState,
          coverageState: snapshot.coverage.coverageState,
          botScreeningObserved: typeof bot.pending === "boolean",
          botFlagsObserved: bot.flags !== undefined,
        },
        notRun: [
          "Controlled human activity scenarios",
          "Gateway reconnect and intent-loss acceptance",
          "OAuth live flow",
          "Developer Portal early Channel Obfuscation",
        ],
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: "NOT_RUN",
        reason: isDiscordFailure(error)
          ? error.kind === "http"
            ? "Configured development Discord access could not be verified"
            : "Discord REST connection unavailable"
          : "Development capability discovery failed",
        httpStatus: isDiscordFailure(error) ? error.status : null,
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
