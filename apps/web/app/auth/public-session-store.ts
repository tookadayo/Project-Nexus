import "server-only";
import { connect } from "../../../../packages/db/src/index";
import { PublicSessions } from "../../../../packages/security/src/public-sessions";
import { assert } from "../../../../packages/shared/src/index";
const shared = globalThis as typeof globalThis & {
  nexusPublicSessions?: PublicSessions;
};
export function publicSessions() {
  if (shared.nexusPublicSessions) return shared.nexusPublicSessions;
  const { DATABASE_URL, NEXUS_SESSION_SECRET } = process.env;
  assert(
    DATABASE_URL && NEXUS_SESSION_SECRET,
    "WEB_CONNECTION_UNAVAILABLE",
    503,
  );
  const refresh = async (refreshToken: string) => {
    const id = process.env.DISCORD_APPLICATION_ID,
      secret = process.env.DISCORD_CLIENT_SECRET;
    assert(id && secret, "SESSION_EXPIRED", 401);
    const response = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    assert(response.ok, "SESSION_EXPIRED", 401);
    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };
    assert(
      token.token_type?.toLowerCase() === "bearer" &&
        token.scope?.split(" ").includes("identify") &&
        token.scope.split(" ").includes("guilds"),
      "SESSION_EXPIRED",
      401,
    );
    return {
      accessToken: token.access_token!,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in!,
    };
  };
  return (shared.nexusPublicSessions = new PublicSessions(
    connect(DATABASE_URL),
    NEXUS_SESSION_SECRET,
    refresh,
  ));
}
