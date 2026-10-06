import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  apiToken,
  scopeForGuild,
} from "../../../../packages/security/src/scoping";
import { discordInstallUrl } from "../../../../packages/discord/src/install";
import { manageableConnection } from "./server-access";
import type { VerificationState } from "../../../../packages/security/src/server-verification";
import { webAuthMode } from "../../../../packages/config/src/web-auth";
import { webOrigin } from "../../../../packages/config/src/web-origin";
import type { UserFailure } from "../../../../packages/shared/src/error-types";
import { userFailure } from "../../../../packages/shared/src/errors";
import { DiscordFailure } from "../../../../packages/discord/src/rest";

export type AuthorizedGuild = {
  id: string;
  name: string;
  installed: boolean;
  installUrl: string | null;
  state: VerificationState;
  availability?: "AVAILABLE" | "UNAVAILABLE";
  failure?: UserFailure;
};
type Session = { accessToken: string; userId: string; expiresAt: number };
export async function validateOAuthSession(session: Session) {
  const identified = await oauthDiscord(
    "https://discord.com/api/v10/users/@me",
    `Bearer ${session.accessToken}`,
  );
  const identity = (await identified.json()) as { id?: string };
  if (identity.id !== session.userId) throw new Error("SESSION_EXPIRED");
}
export const authMode = () => webAuthMode();
export const oauthRedirectUri = () =>
  new URL("/auth/callback", webOrigin()).toString();
export const secureCookies = () => webOrigin().startsWith("https://");
const key = () => {
  const secret = process.env.NEXUS_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("NEXUS_SESSION_SECRET must be at least 32 characters");
  return createHash("sha256").update(secret).digest();
};
export function sealSession(session: Session) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv),
    data = Buffer.concat([
      cipher.update(JSON.stringify(session), "utf8"),
      cipher.final(),
    ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openSession(value: string | undefined): Session | null {
  if (!value || value.length > 8192) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length < 30) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const session = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    ) as Session;
    if (
      typeof session.accessToken !== "string" ||
      !session.accessToken ||
      !/^\d{17,20}$/.test(session.userId) ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now()
    )
      return null;
    return session;
  } catch {
    return null;
  }
}
export function validOAuthState(
  expected: string | undefined,
  received: string | null,
) {
  if (!expected || !received) return false;
  const a = Buffer.from(expected),
    b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function installUrl(guildId?: string) {
  const id = process.env.DISCORD_APPLICATION_ID;
  return id ? discordInstallUrl(id, guildId) : null;
}
let installationCache: { expires: number; ids: Set<string> } | null = null;
type DiscordGuild = {
  id: string;
  name: string;
  owner?: boolean;
  permissions?: string;
};
async function oauthDiscord(url: string | URL, authorization: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new DiscordFailure(0, 0, {
      kind:
        error instanceof Error && /abort|timeout/i.test(error.name)
          ? "timeout"
          : "network",
      routeCategory: "oauth-identity",
    });
  }
  if (response.status === 401 && authorization.startsWith("Bearer "))
    throw new Error("SESSION_EXPIRED");
  if (!response.ok)
    throw new DiscordFailure(
      response.status,
      Number(response.headers.get("retry-after")) || 0,
      { routeCategory: "oauth-identity" },
    );
  return response;
}
async function discordGuilds(authorization: string): Promise<DiscordGuild[]> {
  const rows: DiscordGuild[] = [];
  let after = "";
  for (;;) {
    const url = new URL("https://discord.com/api/v10/users/@me/guilds");
    url.searchParams.set("limit", "200");
    if (after) url.searchParams.set("after", after);
    const response = await oauthDiscord(url, authorization);
    const page = (await response.json()) as DiscordGuild[];
    if (!Array.isArray(page)) throw new Error("DISCORD_GUILDS_UNAVAILABLE");
    rows.push(...page);
    if (page.length < 200) return rows;
    const last = page.at(-1)?.id;
    if (!last || !/^\d{17,20}$/.test(last) || last === after)
      throw new Error("DISCORD_GUILDS_UNAVAILABLE");
    after = last;
  }
}
export async function installedGuildIds() {
  if (installationCache && installationCache.expires > Date.now())
    return installationCache.ids;
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN_REQUIRED");
  const ids = new Set(
    (await discordGuilds(`Bot ${token}`)).map((row) => row.id),
  );
  installationCache = { ids, expires: Date.now() + 60000 };
  return ids;
}
export async function authorizedGuilds(
  token: string,
  userId: string,
): Promise<AuthorizedGuild[]> {
  const rows = await discordGuilds(`Bearer ${token}`);
  const installed = await installedGuildIds();
  const guilds: AuthorizedGuild[] = [];
  for (let start = 0; start < rows.length; start += 4) {
    const batch = await Promise.all(
      rows.slice(start, start + 4).map(async (row) => {
        if (!/^\d{17,20}$/.test(row.id)) return null;
        if (installed.has(row.id)) {
          try {
            const connection = await manageableConnection(row.id, userId);
            return connection
              ? {
                  id: row.id,
                  name: row.name,
                  installed: true,
                  installUrl: installUrl(row.id),
                  state: connection.state,
                }
              : null;
          } catch (error) {
            return {
              id: row.id,
              name: row.name,
              installed: true,
              installUrl: null,
              state: "INSTALLED_NOT_VERIFIED" as const,
              availability: "UNAVAILABLE" as const,
              failure: userFailure(error, "NOT_STARTED", {
                action: "servers",
                stage: "guild-check",
              }),
            };
          }
        }
        return row.owner === true ||
          (BigInt(row.permissions ?? "0") & 40n) !== 0n
          ? {
              id: row.id,
              name: row.name,
              installed: false,
              installUrl: installUrl(row.id),
              state: "NOT_INSTALLED" as const,
            }
          : null;
      }),
    );
    for (const guild of batch) if (guild) guilds.push(guild);
  }
  return guilds;
}
export async function dashboardContext(
  sessionCookie: string | undefined,
  guildCookie: string | undefined,
) {
  const base = process.env.NEXUS_API_URL ?? "http://127.0.0.1:3001";
  if (authMode() === "development") {
    const { NEXUS_ORGANIZATION_ID, NEXUS_GUILD_ID, NEXUS_API_TOKEN } =
      process.env;
    if (!NEXUS_ORGANIZATION_ID || !NEXUS_GUILD_ID || !NEXUS_API_TOKEN)
      return null;
    if (guildCookie && guildCookie !== NEXUS_GUILD_ID) return null;
    return {
      base,
      organizationId: NEXUS_ORGANIZATION_ID,
      guildId: NEXUS_GUILD_ID,
      token: NEXUS_API_TOKEN,
      guilds: [
        {
          id: NEXUS_GUILD_ID,
          name: "Development guild",
          installed: true,
          installUrl: null,
          state: "VERIFIED" as const,
        },
      ],
      userId: "development",
      operationsRole: null,
      operationsCanConfigure: true,
    };
  }
  const session = openSession(sessionCookie);
  if (!session) return null;
  if (!guildCookie || !/^\d{17,20}$/.test(guildCookie)) return null;
  // One identity request checks that the OAuth grant has not been revoked.
  await validateOAuthSession(session);
  // The Bot's live guild/member lookup proves installation and current authority.
  // OAuth's entire guild list is needed only on /servers.
  const connection = await manageableConnection(guildCookie, session.userId);
  if (!connection || connection.state !== "VERIFIED") return null;
  const selected: AuthorizedGuild = {
    id: guildCookie,
    name: connection.name,
    installed: true,
    installUrl: null,
    state: "VERIFIED",
  };
  if (!process.env.API_KEY)
    throw new Error("API_KEY is required for OAuth dashboard access");
  const scope = scopeForGuild(selected.id);
  return {
    base,
    organizationId: scope.organizationId,
    guildId: scope.guildId,
    token: apiToken(process.env.API_KEY, scope),
    guilds: [selected],
    userId: session.userId,
    operationsRole: connection.operationsRole,
    operationsCanConfigure: connection.operationsCanConfigure,
  };
}
