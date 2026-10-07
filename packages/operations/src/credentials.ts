import { randomBytes, timingSafeEqual } from "node:crypto";
import { revokedCredentialActor } from "./membership-tombstones";
import { z } from "zod";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import type { IdentityVault } from "../../identity/src/index";
import {
  operationsAccess,
  operationsLock,
  operationsAudit,
  nexusRole,
  rolePermissions,
} from "./policy";
export const apiScopes = [
  "guild:read",
  "metrics:read",
  "attention:read",
  "interventions:read",
  "attention:write",
  "organization:read",
] as const;
export type ApiScope = (typeof apiScopes)[number];
export const credentialInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z
      .array(z.enum(apiScopes))
      .min(1)
      .max(6)
      .transform((v) => [...new Set(v)].sort()),
    kind: z.enum(["PERSONAL", "SERVICE_ACCOUNT"]).default("PERSONAL"),
  })
  .strict();
export class ApiCredentials {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  async fence(tx: Tx, scope: Scope, id: string, required?: ApiScope) {
    await privacyReadLock(tx, scope);
    const row = (
      await sql<{
        kind: string;
        scopes: ApiScope[];
        actor_hash: string;
      }>`SELECT kind,scopes,actor_hash FROM api_credentials WHERE ${tenant(scope)} AND id=${id}::uuid AND state='ENABLED' FOR SHARE`.execute(
        tx,
      )
    ).rows[0];
    assert(row, "API_UNAUTHORIZED", 401);
    assert(!(await revokedCredentialActor(tx,this.vault,scope,row.actor_hash)), "API_UNAUTHORIZED", 401);
    const ent = new EntitlementService(tx);
    await ent.require(scope, "api");
    if (
      row.kind === "SERVICE_ACCOUNT" ||
      row.scopes.some(
        (value) =>
          value.endsWith(":write") || value.startsWith("organization:"),
      )
    )
      await ent.require(scope, "advanced_api");
    if (required) {
      assert(row.scopes.includes(required), "API_SCOPE_REQUIRED", 403);
      const role = await nexusRole(tx, scope, row.actor_hash);
      if (required.endsWith(":write") && role)
        assert(
          rolePermissions(role).includes("OPERATE"),
          "NEXUS_ROLE_REQUIRED",
          403,
        );
    }
    assert(
      !(
        await sql`SELECT b.member_id FROM operations_role_bindings b JOIN operations_org_members m ON m.organization_id=b.root_organization_id AND m.id=b.member_id WHERE b.organization_id=${scope.organizationId}::uuid AND b.guild_id=${scope.guildId} AND b.actor_hash=${row.actor_hash} AND m.state<>'ACTIVE'`.execute(
          tx,
        )
      ).rows.length,
      "API_UNAUTHORIZED",
      401,
    );
  }
  async create(s: Scope, actor: Actor, input: unknown) {
    const data = credentialInput.parse(input),
      prefix = "nxs_" + randomBytes(10).toString("hex"),
      token = prefix + "." + randomBytes(32).toString("hex");
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "api");
      if (
        data.kind === "SERVICE_ACCOUNT" ||
        data.scopes.some(
          (scope) =>
            scope.endsWith(":write") || scope.startsWith("organization:"),
        )
      )
        await new EntitlementService(tx).require(s, "advanced_api");
      await operationsLock(tx, s);
      assert(
        Number(
          (
            await sql<{
              n: string;
            }>`SELECT count(*)::text AS n FROM api_credentials WHERE ${tenant(s)} AND state<>'REVOKED'`.execute(
              tx,
            )
          ).rows[0]!.n,
        ) < 20,
        "CREDENTIAL_LIMIT",
        409,
      );
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO api_credentials(organization_id,guild_id,prefix,token_hash,name,scopes,kind,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${prefix},${this.vault.digest("operations-api-token", token)},${data.name},${data.scopes}::text[],${data.kind},${actor.key}) RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      await operationsAudit(
        tx,
        s,
        actor.key,
        "API_CREDENTIAL_CREATED",
        row.id,
        null,
      );
      return { id: row.id, prefix, token };
    });
  }
  async revoke(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      const row = (
        await sql`UPDATE api_credentials SET state='REVOKED',revoked_at=now() WHERE ${tenant(s)} AND id=${id}::uuid RETURNING id`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "CREDENTIAL_NOT_FOUND", 404);
      await operationsAudit(
        tx,
        s,
        actor.key,
        "API_CREDENTIAL_REVOKED",
        id,
        null,
      );
    });
  }
  async resume(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "api");
      const row = (
        await sql<{
          kind: string;
          scopes: ApiScope[];
        }>`SELECT kind,scopes FROM api_credentials WHERE ${tenant(s)} AND id=${id}::uuid AND state='PAUSED_PLAN_LIMIT' FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "CREDENTIAL_NOT_PAUSED", 409);
      if (
        row.kind === "SERVICE_ACCOUNT" ||
        row.scopes.some(
          (scope) =>
            scope.endsWith(":write") || scope.startsWith("organization:"),
        )
      )
        await new EntitlementService(tx).require(s, "advanced_api");
      await sql`UPDATE api_credentials SET state='ENABLED' WHERE ${tenant(s)} AND id=${id}::uuid`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "API_CREDENTIAL_RESUMED",
        id,
        null,
      );
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      return (
        await sql`SELECT id,name,prefix,scopes,kind,state,created_at,last_used_at,revoked_at FROM api_credentials WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 100`.execute(
          tx,
        )
      ).rows;
    });
  }
  async authenticate(token: string, required: ApiScope, now = new Date()) {
    assert(
      /^nxs_[a-f0-9]{20}\.[a-f0-9]{64}$/.test(token),
      "API_UNAUTHORIZED",
      401,
    );
    const prefix = token.split(".")[0]!;
    return this.db.transaction().execute(async (tx) => {
      const candidate = (
        await sql<{
          organization_id: string;
          guild_id: string;
        }>`SELECT organization_id,guild_id FROM api_credentials WHERE prefix=${prefix}`.execute(
          tx,
        )
      ).rows[0];
      assert(candidate, "API_UNAUTHORIZED", 401);
      const scope = {
        organizationId: candidate.organization_id,
        guildId: candidate.guild_id,
      };
      await privacyReadLock(tx, scope);
      const row = (
        await sql<{
          id: string;
          token_hash: string;
          scopes: ApiScope[];
          kind: string;
          state: string;
          actor_hash: string;
        }>`SELECT id,token_hash,scopes,kind,state,actor_hash FROM api_credentials WHERE ${tenant(scope)} AND prefix=${prefix} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(row && row.state === "ENABLED", "API_UNAUTHORIZED", 401);
      assert(!(await revokedCredentialActor(tx,this.vault,scope,row.actor_hash)), "API_UNAUTHORIZED", 401);
      const expected = Buffer.from(row.token_hash, "hex"),
        actual = Buffer.from(
          this.vault.digest("operations-api-token", token),
          "hex",
        );
      assert(
        expected.length === actual.length && timingSafeEqual(expected, actual),
        "API_UNAUTHORIZED",
        401,
      );
      assert(row.scopes.includes(required), "API_SCOPE_REQUIRED", 403);
      const entitlements = new EntitlementService(tx);
      await entitlements.require(scope, "api");
      if (
        row.kind === "SERVICE_ACCOUNT" ||
        required.endsWith(":write") ||
        required.startsWith("organization:")
      )
        await entitlements.require(scope, "advanced_api");
      const state = await entitlements.effective(scope),
        month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        minute = new Date(Math.floor(now.getTime() / 60000) * 60000);
      const monthly = (
        await sql<{
          requests: number;
        }>`INSERT INTO api_guild_usage_months(organization_id,guild_id,month_start,requests) VALUES(${scope.organizationId}::uuid,${scope.guildId},${month.toISOString().slice(0, 10)}::date,1) ON CONFLICT(organization_id,guild_id,month_start) DO UPDATE SET requests=api_guild_usage_months.requests+1 RETURNING requests`.execute(
          tx,
        )
      ).rows[0]!.requests;
      assert(
        state.limits.apiRequestsMonthly === null ||
          monthly <= state.limits.apiRequestsMonthly,
        "API_RATE_LIMIT",
        429,
      );
      for (const [kind, start, limit] of [
        ["MINUTE", minute, state.features.includes("advanced_api") ? 300 : 60],
      ] as const) {
        const n = (
          await sql<{
            requests: number;
          }>`INSERT INTO api_usage_windows(organization_id,guild_id,credential_id,window_kind,window_start,requests) VALUES(${scope.organizationId}::uuid,${scope.guildId},${row.id}::uuid,${kind},${start},1) ON CONFLICT(organization_id,guild_id,credential_id,window_kind,window_start) DO UPDATE SET requests=api_usage_windows.requests+1 RETURNING requests`.execute(
            tx,
          )
        ).rows[0]!.requests;
        assert(limit === null || n <= limit, "API_RATE_LIMIT", 429);
      }
      await sql`UPDATE api_credentials SET last_used_at=${now} WHERE ${tenant(scope)} AND id=${row.id}::uuid`.execute(
        tx,
      );
      return {
        scope,
        credentialId: row.id,
        actorHash: row.actor_hash,
        scopes: row.scopes,
      };
    });
  }
}
