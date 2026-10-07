import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import { FakeDiscord } from "../fixtures/discord";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import {
  BillingOperationService,
  EntitlementService,
  DefinitiveBillingFailure,
} from "../../packages/settings/src/billing";
import { abandonCheckout } from "../../packages/settings/src/billing/checkout-lifecycle";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { ServerVerification } from "../../packages/security/src/server-verification";
import { BillingAuthorization } from "../../packages/security/src/billing-authorization";
let db: Database, infra: Awaited<ReturnType<typeof infrastructure>>;
const vault = new IdentityVault("11".repeat(32), "22".repeat(32)),
  a = "911111111111111111",
  b = "911111111111111112",
  admin = "911111111111111113",
  manager = "911111111111111114";
let guild = 933333333333330000n;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
  vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "JP");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.destroy();
  await infra?.stop();
});
async function fixture() {
  const scope = { organizationId: randomUUID(), guildId: String(guild++) };
  await ensureGuild(db, scope);
  const discord = new FakeDiscord(),
    settings = new SettingsService(db),
    authority = new ServerAuthorization(discord, settings, vault),
    billing = new BillingAuthorization(authority, db, vault),
    verification = new ServerVerification(db, vault, authority),
    operations = new BillingOperationService(db, vault);
  for (const [id, permissions] of [
    [a, "8"],
    [b, "0"],
    [admin, "8"],
    [manager, "32"],
  ] as const)
    discord.members.set(id, {
      ownerId: a,
      roles: [],
      permissions,
      bot: false,
      joinedAt: "",
      guildName: "Owner community",
    });
  const offeringId = randomUUID();
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior) VALUES(${offeringId}::uuid,'GROWTH',2,'STRIPE',true,'USD',4900,${"prod_fixture_" + offeringId},${"price_fixture_" + offeringId},'EXCLUSIVE')`.execute(
    db,
  );
  const snapshot = await authority.snapshot(
      scope,
      a,
      "WEB_DASHBOARD",
      "owner-test",
    ),
    principalActorHash = billing.principalHash(scope, a);
  const revalidate = async (
    tx: Parameters<typeof authority.revalidateOwner>[3],
  ) => {
    await authority.revalidateOwner(scope, a, snapshot, tx);
  };
  const input = {
    scope,
    provider: "STRIPE" as const,
    operation: "CHECKOUT" as const,
    offeringId,
    idempotencyKey: randomUUID(),
    principalActorHash,
    checkoutUi: "ELEMENTS" as const,
    revalidate,
  };
  const execute = vi.fn(async () => ({
    kind: "ELEMENTS" as const,
    clientSecret: "cs_fixture_secret_checkout",
    expiresAt: new Date(Date.now() + 2100000).toISOString(),
    providerCheckoutRef: "cs_fixture_" + scope.guildId,
  }));
  return {
    scope,
    discord,
    authority,
    billing,
    verification,
    operations,
    offeringId,
    input,
    execute,
    principalActorHash,
  };
}
it("Owner only: administrator, ManageGuild and altered guild cannot authorize checkout or portal", async () => {
  const f = await fixture();
  await f.billing.authorize(f.scope, a, "CHECKOUT", "WEB_DASHBOARD", "owner");
  for (const user of [admin, manager, b]) {
    await expect(
      f.billing.authorize(f.scope, user, "CHECKOUT", "WEB_DASHBOARD", "denied"),
    ).rejects.toThrow("BILLING_OWNER_REQUIRED");
    await expect(
      f.billing.authorize(f.scope, user, "PORTAL", "WEB_DASHBOARD", "denied"),
    ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
  }
  await expect(
    db.transaction().execute(async (tx) =>
      f.authority.revalidateOwner(
        { ...f.scope, guildId: String(guild++) },
        a,
        {
          ...(await f.authority.snapshot(
            f.scope,
            a,
            "WEB_DASHBOARD",
            "tampered",
          )),
        },
        tx,
      ),
    ),
  ).rejects.toThrow("BILLING_OWNER_REQUIRED");
});
it("live transfer after selection denies creation and explicit web connection", async () => {
  const f = await fixture();
  for (const member of f.discord.members.values()) member.ownerId = b;
  await expect(f.operations.session(f.input, f.execute)).rejects.toThrow(
    "BILLING_OWNER_REQUIRED",
  );
  expect(f.execute).not.toHaveBeenCalled();
  await expect(f.verification.connectOwner(f.scope, a)).rejects.toThrow(
    "BILLING_OWNER_REQUIRED",
  );
});
it("live owner recheck just before provider mutation catches a transfer after durable claim", async () => {
  const f = await fixture();
  let write = false;
  await expect(
    f.operations.session(f.input, async (ctx) => {
      for (const member of f.discord.members.values()) member.ownerId = b;
      try {
        await ctx.beforeMutation!();
      } catch (error) {
        throw new DefinitiveBillingFailure("OWNER_CHANGED", error);
      }
      write = true;
      return f.execute();
    }),
  ).rejects.toThrow("BILLING_OWNER_REQUIRED");
  expect(write).toBe(false);
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM billing_operations WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0]!.state,
  ).toBe("FAILED");
});
it("durable Primary Principal survives transfer without granting community access or portal to new owner", async () => {
  const f = await fixture();
  const result = await f.operations.session(f.input, f.execute);
  expect(
    (
      await sql<{
        actor_hash: string;
      }>`SELECT actor_hash FROM billing_authorizations WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ actor_hash: f.principalActorHash }]);
  for (const [id, member] of f.discord.members) {
    member.ownerId = b;
    if (id === a) member.permissions = "0";
  }
  await f.billing.authorize(f.scope, a, "PORTAL", "WEB_DASHBOARD", "principal");
  await expect(
    f.billing.authorize(f.scope, b, "PORTAL", "WEB_DASHBOARD", "owner-b"),
  ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
  await expect(
    f.authority.actor(f.scope, a, "WEB_DASHBOARD", "community"),
  ).rejects.toThrow("ADMIN_REQUIRED");
  expect(await f.billing.ownership(f.scope, b)).toBe(
    "BILLING_OWNERSHIP_REVIEW",
  );
  expect((await new EntitlementService(db).effective(f.scope)).plan).toBe(
    "FREE",
  );
  expect(result.kind).toBe("ELEMENTS");
});
it("same request caches one result; changed Offering conflicts; concurrent fresh request creates one session", async () => {
  const f = await fixture();
  const requests=[f.input,{...f.input,idempotencyKey:randomUUID()}];
  const outcomes=await Promise.allSettled(requests.map(input=>f.operations.session(input,f.execute)));
  expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(f.execute).toHaveBeenCalledTimes(1);
  const index=outcomes.findIndex(r=>r.status==="fulfilled"),first=outcomes[index]!;
  if(first.status!=="fulfilled")throw first.reason;
  const winner=requests[index]!;
  expect((await f.operations.session(winner,f.execute)).clientSecret).toBe(first.value.clientSecret);
  expect(f.execute).toHaveBeenCalledTimes(1);
  const second = await fixture();
  await expect(
    f.operations.session(
      { ...winner, offeringId: second.offeringId },
      f.execute,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
it("confirmed abandonment expires the provider session before permitting a new operation; unknown expiry stays fenced", async () => {
  const f = await fixture(),
    result = await f.operations.session(f.input, f.execute),
    expire = vi.fn(async () => {});
  await abandonCheckout(
    db,
    vault,
    f.scope,
    result.operationId!,
    f.principalActorHash,
    expire,
  );
  expect(expire).toHaveBeenCalledOnce();
  expect((await new EntitlementService(db).effective(f.scope)).plan).toBe(
    "FREE",
  );
  await expect(f.operations.session(f.input, f.execute)).rejects.toThrow(
    "BILLING_SESSION_EXPIRED",
  );
  await f.operations.session(
    { ...f.input, idempotencyKey: randomUUID() },
    f.execute,
  );
  const g = await fixture(),
    pending = await g.operations.session(g.input, g.execute);
  await expect(
    abandonCheckout(
      db,
      vault,
      g.scope,
      pending.operationId!,
      g.principalActorHash,
      async () => {
        throw new Error("transport timeout");
      },
    ),
  ).rejects.toThrow("transport timeout");
  await expect(
    g.operations.session(
      { ...g.input, idempotencyKey: randomUUID() },
      g.execute,
    ),
  ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
});
it("privacy deletion and disabled Offering deny before provider writes", async () => {
  const f = await fixture();
  await sql`UPDATE billing_offerings SET enabled=false WHERE id=${f.offeringId}::uuid`.execute(
    db,
  );
  await expect(f.operations.session(f.input, f.execute)).rejects.toThrow(
    "BILLING_OFFERING_UNAVAILABLE",
  );
  expect(f.execute).not.toHaveBeenCalled();
  const g = await fixture();
  await sql`INSERT INTO deletion_requests(id,organization_id,guild_id,completed_at) VALUES(${randomUUID()}::uuid,${g.scope.organizationId}::uuid,${g.scope.guildId},now())`.execute(
    db,
  );
  await expect(g.verification.connectOwner(g.scope, a)).rejects.toThrow(
    "PRIVACY_DELETED",
  );
  await expect(g.operations.session(g.input, g.execute)).rejects.toThrow(
    "PRIVACY_DELETED",
  );
  expect(g.execute).not.toHaveBeenCalled();
});
it("member deletion scrubs principal receipt provenance without canceling or exposing provider references", async () => {
  const f = await fixture();
  const result = await f.operations.session(f.input, async () => ({
    ...(await f.execute()),
    confirmationToken: "sealed-identity-receipt",
  }));
  const { deleteBillingActor } =
    await import("../../packages/security/src/billing-privacy");
  await db
    .transaction()
    .execute((tx) => deleteBillingActor(tx, f.scope, a, vault));
  const row = (
    await sql<{
      principal_actor_hash: string | null;
      result_ciphertext: string;
      state: string;
    }>`SELECT principal_actor_hash,result_ciphertext,state FROM billing_operations WHERE id=${result.operationId}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(row.principal_actor_hash).toBeNull();
  expect(row.state).toBe("FINALIZED");
  const sealed = JSON.parse(vault.open(f.scope, row.result_ciphertext));
  expect(sealed).not.toHaveProperty("confirmationToken");
  expect(sealed.providerCheckoutRef).toBe("cs_fixture_" + f.scope.guildId);
  await expect(
    f.billing.authorize(f.scope, a, "PORTAL", "WEB_DASHBOARD", "deleted"),
  ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
});
