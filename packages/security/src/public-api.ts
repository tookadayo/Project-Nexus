import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sql, tenant, type Database } from "../../db/src/index";
import { assert, scopeSchema, type Scope } from "../../shared/src/index";
import type { DiscordPort } from "../../discord/src/rest";
import type { IdentityVault } from "../../identity/src/index";
import { SettingsService } from "../../settings/src/index";
import {
  operationsAccess,
  type OperationPermission,
} from "../../operations/src/policy";
import {
  PublicTokenCipher,
  publicSessionDigest,
  publicSessionPolicy,
} from "./public-sessions";
import { ServerAuthorization } from "./server-authorization";
import { validApiToken } from "./scoping";
import { webOrigin } from "../../config/src/web-origin";

const proofSchema = z
  .object({
    scope: scopeSchema,
    userId: z.string().regex(/^\d{17,20}$/),
    sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: z.string().startsWith("/").max(1024),
    origin: z.string().optional(),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
type Proof = z.infer<typeof proofSchema>;
const proofMac = (secret: string, body: string) =>
  createHmac("sha256", secret)
    .update("public-api:v1:" + body)
    .digest("base64url");

/** Server-only: call after OAuth identity validation and, for mutations, sameOrigin. */
export function createPublicApiProof(
  input: {
    scope: Scope;
    userId: string;
    sessionReference: string;
    method: string;
    path: string;
    origin?: string;
  },
  secret = process.env.NEXUS_SESSION_SECRET,
  now = Date.now(),
) {
  assert(secret && secret.length >= 32, "WEB_CONNECTION_UNAVAILABLE", 503);
  const { sessionReference, ...rest } = input;
  const proof = proofSchema.parse({
    ...rest,
    sessionDigest: publicSessionDigest(sessionReference),
    issuedAt: now,
    expiresAt: now + 30000,
  });
  const body = Buffer.from(JSON.stringify(proof)).toString("base64url");
  return `${body}.${proofMac(secret, body)}`;
}
export function readPublicApiProof(
  value: unknown,
  method: string,
  path: string,
  scope: Scope,
  secret = process.env.NEXUS_SESSION_SECRET,
  now = Date.now(),
): Proof {
  assert(
    secret &&
      secret.length >= 32 &&
      typeof value === "string" &&
      value.length <= 4096,
    "SESSION_REQUIRED",
    401,
  );
  const [body, signature, extra] = value.split(".");
  assert(body && signature && !extra, "SESSION_REQUIRED", 401);
  const expected = Buffer.from(proofMac(secret, body)),
    received = Buffer.from(signature);
  assert(
    expected.length === received.length && timingSafeEqual(expected, received),
    "SESSION_REQUIRED",
    401,
  );
  let proof: Proof;
  try {
    proof = proofSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
  } catch {
    assert(false, "SESSION_REQUIRED", 401);
  }
  assert(
    proof.scope.organizationId === scope.organizationId &&
      proof.scope.guildId === scope.guildId &&
      proof.method === method &&
      proof.path === path &&
      proof.issuedAt <= now &&
      proof.expiresAt > now &&
      proof.expiresAt - proof.issuedAt <= 30000,
    "SESSION_REQUIRED",
    401,
  );
  return proof;
}
export type PublicApiRequest = {
  params: unknown;
  method: string;
  url: string;
  id: string;
  headers: Record<string, unknown>;
};

/** Authenticate both the service hop and the actual still-active public session. */
export async function publicApiIdentity(
  req: PublicApiRequest,
  db: Database,
  key: string,
) {
  const params = req.params as Record<string, unknown>;
  const scope = scopeSchema.parse({
    organizationId: params.organizationId,
    guildId: params.guildId,
  });
  assert(
    validApiToken(
      key,
      scope,
      String(req.headers.authorization ?? "").replace(/^Bearer /, ""),
    ),
    "FORBIDDEN",
    403,
  );
  const proof = readPublicApiProof(
    req.headers["x-nexus-user-proof"],
    req.method,
    req.url.split("?")[0]!,
    scope,
  );
  if (req.method !== "GET") {
    const expected = webOrigin();
    assert(
      proof.origin === expected && req.headers.origin === expected,
      "CROSS_ORIGIN",
      403,
    );
  }
  const row = (
    await sql<{
      user_ciphertext: string;
      token_ciphertext: string;
    }>`SELECT user_ciphertext,token_ciphertext FROM public_oauth_sessions WHERE digest=${proof.sessionDigest} AND revoked_at IS NULL AND token_ciphertext IS NOT NULL AND refresh_owner IS NULL AND expires_at>clock_timestamp() AND access_expires_at>clock_timestamp() AND last_used_at>clock_timestamp()-make_interval(secs=>${publicSessionPolicy().idleSeconds})`.execute(
      db,
    )
  ).rows[0];
  assert(row, "SESSION_EXPIRED", 401);
  const userId = new PublicTokenCipher(process.env.NEXUS_SESSION_SECRET!).open(
    proof.sessionDigest,
    row.user_ciphertext,
  );
  assert(userId === proof.userId, "SESSION_REQUIRED", 401);
  const tokens = z
    .object({
      accessToken: z.string().min(1),
      refreshToken: z.string().optional(),
    })
    .parse(
      JSON.parse(
        new PublicTokenCipher(process.env.NEXUS_SESSION_SECRET!).open(
          proof.sessionDigest,
          row.token_ciphertext,
        ),
      ),
    );
  return { scope, userId, accessToken: tokens.accessToken };
}
export type PublicApiContext = Awaited<ReturnType<typeof publicApiContext>>;
export async function publicApiContext(
  req: PublicApiRequest,
  db: Database,
  key: string,
  discord: DiscordPort | undefined,
  vault: IdentityVault | undefined,
  permission: OperationPermission = "READ",
  options: { setup?: boolean } = {},
) {
  const { scope, userId } = await publicApiIdentity(req, db, key);
  assert(discord && vault, "WEB_CONNECTION_UNAVAILABLE", 503);
  const authority = new ServerAuthorization(
    discord,
    new SettingsService(db),
    vault,
  );
  const snapshot = await authority.snapshot(
    scope,
    userId,
    "WEB_DASHBOARD",
    req.id,
  );
  assert(!snapshot.member.bot, "ADMIN_REQUIRED", 403);
  await db.transaction().execute(async (tx) => {
    if (options.setup) {
      const link = (
        await sql`SELECT 1 FROM server_web_links WHERE ${tenant(scope)} AND revoked_at IS NULL`.execute(
          tx,
        )
      ).rows.length;
      // A first Web connection requires native, current guild-management authority.
      // Existing configured delegation is used only after a connection exists.
      if (!link)
        assert(
          snapshot.member.ownerId === userId ||
            (BigInt(snapshot.member.permissions) & 40n) !== 0n,
          "ADMIN_REQUIRED",
          403,
        );
    } else {
      assert(
        (
          await sql`SELECT 1 FROM server_web_links WHERE ${tenant(scope)} AND revoked_at IS NULL`.execute(
            tx,
          )
        ).rows.length,
        "SERVER_NOT_VERIFIED",
        403,
      );
    }
    await operationsAccess(tx, scope, snapshot.actor, permission);
  });
  return { scope, userId, actor: snapshot.actor, snapshot, authority };
}
