import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { BillingService } from "../../packages/settings/src/billing";
import { EntitlementService } from "../../packages/settings/src/billing";
import {
  PromotionService,
  campaignSchema,
  type PromotionCampaign,
} from "../../packages/settings/src/billing";
import { internalBillingActor } from "../../packages/security/src/billing-authorization";
import { plans, planRegistry } from "../../packages/settings/src/plan-registry";
import type { NormalizedBillingEvent } from "../../packages/settings/src/billing";
import { SettingsService } from "../../packages/settings/src/index";
import { BillingAuthorization } from "../../packages/security/src/billing-authorization";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { PrivacyService } from "../../packages/security/src/privacy";
import { Components } from "../../packages/security/src/index";
import { FakeDiscord } from "../fixtures/discord";
import { HelperWorker } from "../../apps/worker/src/helpers";
import { BillingWorker } from "../../apps/worker/src/billing";
import {
  currentRecipe,
  saveCustomRecipe,
} from "../../packages/settings/src/recipes";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
  user = "555555555555555555";
const admin = internalBillingActor(user, vault, "Commercial regression test", {
  NEXUS_INTERNAL_ADMIN_IDS: user,
});
let guild = 111111111111110000n;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db, { throughVersion: 34 });
  const s = { organizationId: randomUUID(), guildId: String(guild++) };
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_settings VALUES(${s.organizationId}::uuid,${s.guildId},0,'{"helperEnabled":true,"weeklySummaryEnabled":true}'::jsonb)`.execute(
    db,
  );
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key) VALUES(${s.organizationId}::uuid,${s.guildId},'STARTER')`.execute(
    db,
  );
  await migrate(db);
  expect(await new EntitlementService(db).can(s, "attention_automation")).toBe(
    true,
  );
  expect(await new EntitlementService(db).plan(s)).toBe("STARTER");
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture() {
  const s = { organizationId: randomUUID(), guildId: String(guild++) };
  await ensureGuild(db, s);
  return {
    s,
    billing: new BillingService(db, vault),
    promotions: new PromotionService(db, vault),
    entitlements: new EntitlementService(db),
  };
}
function event(
  s: NormalizedBillingEvent["scope"],
  patch: Partial<NormalizedBillingEvent> = {},
): NormalizedBillingEvent {
  return {
    scope: s,
    eventId: randomUUID(),
    provider: "MANUAL",
    subscriptionRef: "fixture-reference-" + s.guildId,
    plan: "GROWTH",
    status: "ACTIVE",
    occurredAt: new Date().toISOString(),
    version: 1,
    periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    scheduledPlan: null,
    scheduledAt: null,
    authoritative: true,
    ...patch,
  };
}
function campaign(patch: Partial<PromotionCampaign> = {}) {
  return campaignSchema.parse({
    name: "Integration benefit",
    benefitType: "PLAN_GRANT",
    targetPlan: "GROWTH",
    durationDays: 90,
    validFrom: new Date(Date.now() - 60000).toISOString(),
    allowedPlans: plans,
    allowedProviders: ["MANUAL", "STRIPE", "DISCORD"],
    stackingPolicy: "MAX",
    ...patch,
  });
}
it("seeds every immutable catalog revision without altering legacy usage or prices", async () => {
  for (const plan of plans) {
    const row = (
      await sql<{
        features: string[];
        limits: unknown;
      }>`SELECT features,limits FROM billing_plan_versions WHERE plan_key=${plan} AND revision=${planRegistry[plan].revision}`.execute(
        db,
      )
    ).rows[0]!;
    expect(row.features).toEqual(planRegistry[plan].features);
    expect(row.limits).toEqual(planRegistry[plan].limits);
  }
  expect(
    (
      await sql<{
        n: number;
      }>`SELECT count(*)::integer AS n FROM schema_migrations`.execute(db)
    ).rows[0]!.n,
  ).toBe(45);
  await expect(
    sql`UPDATE billing_plan_versions SET limits='{}' WHERE plan_key='FREE'`.execute(
      db,
    ),
  ).rejects.toThrow("immutable");
});
it("projects duplicate and reordered verified events with restart-safe state", async () => {
  const { s, billing, entitlements } = await fixture(),
    confirmed = event(s);
  expect(await billing.storeVerified(confirmed)).toMatchObject({
    duplicate: false,
  });
  expect(await billing.storeVerified(confirmed)).toMatchObject({
    duplicate: true,
  });
  expect(await entitlements.plan(s)).toBe("FREE");
  await Promise.all([
    billing.projectOne(),
    new BillingService(db, vault).projectOne(),
  ]);
  expect(await entitlements.plan(s)).toBe("GROWTH");
  await billing.storeVerified({
    ...confirmed,
    eventId: randomUUID(),
    occurredAt: confirmed.occurredAt.replace("Z", "+00:00"),
    periodEnd: confirmed.periodEnd!.replace("Z", "+00:00"),
  });
  await billing.projectOne();
  expect((await entitlements.effective(s)).conflict).toBe(false);
  await billing.storeVerified(event(s, { plan: "STARTER", version: 0 }));
  await billing.projectOne();
  expect(await entitlements.plan(s)).toBe("GROWTH");
  await expect(
    billing.storeVerified(event(s, { authoritative: false })),
  ).rejects.toThrow("BILLING_EVENT_UNVERIFIED");
  const stored = (
    await sql<{
      normalized: unknown;
    }>`SELECT normalized FROM billing_provider_events WHERE ${tenant(s)} LIMIT 1`.execute(
      db,
    )
  ).rows[0]!.normalized;
  expect(JSON.stringify(stored)).not.toContain(confirmed.subscriptionRef);
});
it("keeps known-good access during provider outage and surfaces paid-provider conflicts", async () => {
  const f = await fixture();
  await f.billing.storeVerified(event(f.s));
  await f.billing.projectOne();
  await f.billing.markProviderUnavailable(f.s, "MANUAL");
  expect(await f.entitlements.plan(f.s)).toBe("GROWTH");
  expect((await f.billing.status(f.s)).grace).toBe(true);
  await f.billing.storeVerified(
    event(f.s, {
      provider: "DISCORD",
      subscriptionRef: "other-provider",
      plan: "STARTER",
    }),
  );
  await f.billing.projectOne();
  expect(await f.billing.status(f.s)).toMatchObject({
    plan: "GROWTH",
    conflict: true,
    reason: "BILLING_CONFLICT",
  });
});
it("scheduled downgrade remains confirmed plan; cancellation and expired grace reduce visibility with recovery", async () => {
  const f = await fixture();
  await f.billing.storeVerified(
    event(f.s, {
      scheduledPlan: "STARTER",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    }),
  );
  await f.billing.projectOne();
  expect(await f.entitlements.plan(f.s)).toBe("GROWTH");
  await sql`INSERT INTO guild_settings VALUES(${f.s.organizationId}::uuid,${f.s.guildId},0,'{"helperEnabled":true}'::jsonb)`.execute(
    db,
  );
  await f.billing.storeVerified(
    event(f.s, {
      status: "CANCELED",
      version: 2,
      periodEnd: new Date().toISOString(),
    }),
  );
  await f.billing.projectOne();
  expect(await f.entitlements.plan(f.s)).toBe("FREE");
  expect((await f.billing.status(f.s)).recoveryUntil).not.toBeNull();
  expect(
    (await f.billing.status(f.s)).pausedRules.some(
      (row) => row.rule_key === "helper",
    ),
  ).toBe(true);
});
it("a valid promotion grants timed access and keeps plaintext out of persisted records", async () => {
  const f = await fixture(),
    c = await f.promotions.createCampaign(admin, campaign()),
    code = await f.promotions.generateCode(admin, c.id);
  expect(/^NXP-[A-F0-9]{48}$/.test(code.code)).toBe(true);
  const result = await f.promotions.redeem(
    f.s,
    vault.hash(f.s, user),
    code.code,
  );
  expect(result.plan).toBe("GROWTH");
  expect(result.benefitEnd).not.toBeNull();
  const rows = (
    await sql`SELECT * FROM promotion_codes WHERE id=${code.id}::uuid`.execute(
      db,
    )
  ).rows;
  expect(JSON.stringify(rows).includes(code.code)).toBe(false);
  await expect(
    f.promotions.redeem(f.s, vault.hash(f.s, user), code.code),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
});
it("campaign and code caps hold under racing redeemers on different guilds", async () => {
  const a = await fixture(),
    b = await fixture(),
    c = await a.promotions.createCampaign(
      admin,
      campaign({ maxRedemptions: 1 }),
    ),
    code = await a.promotions.generateCode(admin, c.id, { maxRedemptions: 10 });
  const results = await Promise.allSettled([
    a.promotions.redeem(a.s, "actor-a", code.code),
    b.promotions.redeem(b.s, "actor-b", code.code),
  ]);
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
});
it("expiry, revocation and guild/organization binding fail with the same public category", async () => {
  const f = await fixture();
  for (const patch of [
    { validUntil: new Date(Date.now() - 1000).toISOString() },
    { targetGuildId: "999999999999999999" },
    { targetOrganizationId: (await fixture()).s.organizationId },
  ]) {
    const c = await f.promotions.createCampaign(admin, campaign(patch)),
      code = await f.promotions.generateCode(admin, c.id);
    await expect(f.promotions.redeem(f.s, "actor", code.code)).rejects.toThrow(
      "PROMOTION_UNAVAILABLE",
    );
  }
  const c = await f.promotions.createCampaign(admin, campaign()),
    code = await f.promotions.generateCode(admin, c.id);
  await f.promotions.revoke(admin, "code", code.id);
  await expect(f.promotions.redeem(f.s, "actor", code.code)).rejects.toThrow(
    "PROMOTION_UNAVAILABLE",
  );
});
it("stacking denial, per-guild limits and campaign revoke apply independently", async () => {
  const f = await fixture(),
    c = await f.promotions.createCampaign(
      admin,
      campaign({ stackingPolicy: "DENY", maxRedemptionsPerGuild: 2 }),
    ),
    code = await f.promotions.generateCode(admin, c.id);
  await f.promotions.redeem(f.s, "actor", code.code);
  const next = await f.promotions.generateCode(admin, c.id);
  await expect(f.promotions.redeem(f.s, "actor", next.code)).rejects.toThrow(
    "PROMOTION_UNAVAILABLE",
  );
  await f.promotions.revoke(admin, "campaign", c.id);
  await expect(
    f.promotions.redeem((await fixture()).s, "actor", next.code),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
});
it("partner/debug grants are internal, bounded/revocable overlays scoped to a guild", async () => {
  const f = await fixture(),
    other = await fixture();
  expect(() => internalBillingActor(user, vault, "test reason", {})).toThrow(
    "NEXUS_INTERNAL_ADMIN_REQUIRED",
  );
  const partner = await f.promotions.issueGrant(f.s, admin, {
    source: "PARTNER",
    plan: "GROWTH",
    untilRevoked: true,
  });
  expect((await f.entitlements.effective(f.s)).source).toBe("PARTNER");
  expect(await other.entitlements.plan(other.s)).toBe("FREE");
  await f.promotions.revokeGrant(f.s, admin, partner.id);
  expect(await f.entitlements.plan(f.s)).toBe("FREE");
  const debug = await f.promotions.issueGrant(f.s, admin, {
    source: "DEBUG",
    plan: "SCALE",
  });
  expect(debug.endsAt).not.toBeNull();
  await expect(
    f.promotions.issueGrant(f.s, admin, {
      source: "DEBUG",
      plan: "GROWTH",
      untilRevoked: true,
    }),
  ).rejects.toThrow("DEBUG_EXPIRY_REQUIRED");
});
it("discount benefit remains unavailable without a real configured provider", async () => {
  const f = await fixture(),
    c = await f.promotions.createCampaign(
      admin,
      campaign({
        benefitType: "DISCOUNT",
        discountType: "PERCENT",
        discountValue: 20,
      }),
    );
  await expect(f.promotions.activateCampaign(admin, c.id)).rejects.toThrow(
    "OFFERING_PRICE_UNVERIFIED",
  );
});
it("promotion job replay returns the original grant exactly once", async () => {
  const f = await fixture(),
    c = await f.promotions.createCampaign(admin, campaign()),
    code = await f.promotions.generateCode(admin, c.id),
    actor = vault.hash(f.s, user),
    id = randomUUID();
  const first = await f.promotions.redeem(
      f.s,
      actor,
      code.code,
      "MANUAL",
      new Date(),
      id,
    ),
    replay = await f.promotions.redeem(
      f.s,
      actor,
      code.code,
      "MANUAL",
      new Date(),
      id,
    );
  expect(replay).toEqual(first);
  expect(
    (
      await sql`SELECT id FROM promotion_redemptions WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("failed provider projection is durably backed off and does not block later guilds", async () => {
  const a = await fixture(),
    b = await fixture(),
    c = await fixture(),
    ref = "scoped-private-fixture";
  await a.billing.storeVerified(event(a.s, { subscriptionRef: ref }));
  await a.billing.projectOne();
  await expect(
    b.billing.storeVerified(event(b.s, { subscriptionRef: ref })),
  ).rejects.toThrow("BILLING_SCOPE_CONFLICT");
  // A pre-existing poison inbox row still needs bounded backoff even though the
  // alpha.7 ingress guard now rejects this ownership conflict before insertion.
  const poisoned = event(b.s, { subscriptionRef: ref });
  const { eventId, subscriptionRef, ...normalized } = poisoned;
  await sql`INSERT INTO billing_provider_events(id,provider,event_digest,organization_id,guild_id,normalized,verified_at) VALUES(${randomUUID()}::uuid,'MANUAL',${vault.digest("billing-event:MANUAL", eventId)},${b.s.organizationId}::uuid,${b.s.guildId},${JSON.stringify({ ...normalized, eventDigest: vault.digest("billing-event:MANUAL", eventId), referenceDigest: vault.digest("billing-reference:MANUAL", subscriptionRef), referenceCiphertext: vault.seal(b.s, subscriptionRef) })}::jsonb,now())`.execute(
    db,
  );
  await c.billing.storeVerified(event(c.s));
  await b.billing.projectOne();
  await c.billing.projectOne();
  expect(await c.entitlements.plan(c.s)).toBe("GROWTH");
  expect(await b.entitlements.plan(b.s)).toBe("FREE");
  const failed = (
    await sql<{
      attempts: number;
      error_category: string;
      available_at: Date;
    }>`SELECT attempts,error_category,available_at FROM billing_provider_events WHERE ${tenant(b.s)}`.execute(
      db,
    )
  ).rows[0]!;
  expect(failed.attempts).toBe(1);
  expect(failed.error_category).toMatch(/^BILLING_PROJECTION_FAILED:NXS-/);
  expect(failed.available_at.getTime()).toBeGreaterThan(Date.now());
});
it("contradictory equal-order provider events surface a conflict with bounded confirmed access", async () => {
  const f = await fixture(),
    confirmed = event(f.s);
  await f.billing.storeVerified(confirmed);
  await f.billing.projectOne();
  await f.billing.storeVerified({
    ...confirmed,
    eventId: randomUUID(),
    status: "CANCELED",
  });
  await f.billing.projectOne();
  expect(await f.entitlements.effective(f.s)).toMatchObject({
    plan: "GROWTH",
    conflict: true,
    grace: true,
  });
});
it("billing requires a fresh Discord owner/admin or organization manager, separate from NEXUS managers", async () => {
  const f = await fixture(),
    settings = new SettingsService(db),
    discord = new FakeDiscord(),
    role = "666666666666666666";
  await settings.update(
    f.s,
    {
      key: "fixture",
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD",
      requestId: "fixture",
    },
    0,
    { managerRoleIds: [role] },
  );
  discord.members.set(user, {
    roles: [role],
    permissions: "0",
    bot: false,
    joinedAt: "",
  });
  const authority = new ServerAuthorization(discord, settings, vault),
    billing = new BillingAuthorization(authority, db, vault);
  await billing.authorize(f.s, user, "VIEW", "WEB_DASHBOARD", "view");
  await expect(
    billing.authorize(f.s, user, "REDEEM", "WEB_DASHBOARD", "redeem"),
  ).rejects.toThrow("BILLING_AUTHORIZATION_REQUIRED");
  discord.members.set(user, {
    roles: [],
    permissions: "32",
    ownerId: user,
    bot: false,
    joinedAt: "",
  });
  const snapshot = await billing.authorize(
    f.s,
    user,
    "REDEEM",
    "WEB_DASHBOARD",
    "redeem",
  );
  await expect(
    billing.require({ ...snapshot, checkedAt: Date.now() - 10001 }, "REDEEM"),
  ).rejects.toThrow("AUTHORIZATION_EXPIRED");
  await expect(
    billing.authorize(f.s, user, "ASSIGN_GUILD", "WEB_DASHBOARD", "assign"),
  ).rejects.toThrow("ORGANIZATION_BILLING_MANAGER_REQUIRED");
  discord.members.set(user, {
    roles: [],
    permissions: "0",
    bot: false,
    joinedAt: "",
  });
  await expect(
    billing.authorize(f.s, user, "VIEW", "WEB_DASHBOARD", "view"),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await sql`INSERT INTO billing_authorizations(organization_id,actor_hash,role) VALUES(${f.s.organizationId}::uuid,${vault.digest("billing-org-actor", f.s.organizationId + ":" + user)},'BILLING_MANAGER')`.execute(
    db,
  );
  await billing.authorize(f.s, user, "ASSIGN_GUILD", "WEB_DASHBOARD", "assign");
  const tokens = new Components("billing-test");
  expect(
    Components.kind(
      await tokens.issue(db, f.s, { action: "billing" }, vault.hash(f.s, user)),
    ),
  ).toBe("ephemeral");
  expect(
    Components.kind(
      await tokens.issue(
        db,
        f.s,
        { action: "billingPromotionOpen" },
        vault.hash(f.s, user),
      ),
    ),
  ).toBe("modal");
});
it("Free denies paid settings and workers preserve configured rules after downgrade", async () => {
  const f = await fixture(),
    settings = new SettingsService(db),
    actor = {
      key: "admin",
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD" as const,
      requestId: "settings",
    };
  await expect(
    settings.update(f.s, actor, 0, {
      helperEnabled: true,
      helperChannelId: "777777777777777777",
    }),
  ).rejects.toThrow("PLAN_REQUIRED");
  await f.billing.storeVerified(event(f.s));
  await f.billing.projectOne();
  await settings.update(f.s, actor, 0, {
    enabled: true,
    helperEnabled: true,
    helperChannelId: "777777777777777777",
  });
  await f.billing.storeVerified(event(f.s, { status: "CANCELED", version: 2 }));
  await f.billing.projectOne();
  expect((await settings.get(f.s)).helperEnabled).toBe(true);
  expect((await f.billing.status(f.s)).pausedRules).toContainEqual({
    rule_key: "helper",
    state: "PAUSED_PLAN_LIMIT",
  });
  const discord = new FakeDiscord();
  expect(await new HelperWorker(db, discord, settings).tick(f.s)).toBe(false);
  expect(discord.calls).toEqual([]);
  await f.billing.storeVerified(event(f.s, { version: 3 }));
  await f.billing.projectOne();
  expect((await f.billing.status(f.s)).pausedRules).toEqual([]);
  expect((await settings.get(f.s)).helperEnabled).toBe(true);
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM billing_rule_states WHERE ${tenant(f.s)} AND rule_key='helper'`.execute(
        db,
      )
    ).rows[0]?.state,
  ).toBe("ACTIVE");
  expect(
    (await f.billing.preview(f.s, "STARTER", "MANUAL")).historyVisibilityChange
      .toDays,
  ).toBe(90);
});
it("custom recipes enforce Growth, count distinct recipes and preserve immutable heads across unrelated settings", async () => {
  const f = await fixture(),
    settings = new SettingsService(db),
    actor = {
      key: "admin",
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD" as const,
      requestId: "recipe",
    };
  await settings.update(f.s, actor, 0, {
    communityModel: {
      modes: ["VOICE"],
      confirmed: true,
      channels: [],
      forumTags: [],
      voiceThresholdSeconds: 300,
    },
  });
  const data = {
    preset: "VOICE_FIRST",
    expectedHead: (await currentRecipe(db, f.s))!.id,
    strongSignals: ["voice.connected"],
    supportingSignals: ["voice.duration"],
    voiceThresholdSeconds: 600,
    returnFromDay: 7,
    returnThroughDay: 14,
  };
  await expect(
    db
      .transaction()
      .execute((tx) => saveCustomRecipe(tx, f.s, actor.key, data)),
  ).rejects.toThrow("PLAN_REQUIRED");
  await f.billing.storeVerified(event(f.s));
  await f.billing.projectOne();
  const saved = await db
    .transaction()
    .execute((tx) => saveCustomRecipe(tx, f.s, actor.key, data));
  await settings.update(f.s, actor, 1, { uiLanguage: "ja" });
  expect((await currentRecipe(db, f.s))!.id).toBe(saved.id);
  for (let i = 0; i < 4; i++)
    await db.transaction().execute(async (tx) =>
      saveCustomRecipe(tx, f.s, actor.key, {
        ...data,
        expectedHead: (await currentRecipe(tx, f.s))!.id,
      }),
    );
  await expect(
    db.transaction().execute(async (tx) =>
      saveCustomRecipe(tx, f.s, actor.key, {
        ...data,
        expectedHead: (await currentRecipe(tx, f.s))!.id,
      }),
    ),
  ).rejects.toThrow("BILLING_LIMIT_REACHED");
});
it("member and guild privacy deletion scrub commerce identities and block provider resurrection", async () => {
  const f = await fixture(),
    settings = new SettingsService(db),
    actor = {
      key: vault.hash(f.s, user),
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD" as const,
      requestId: "privacy",
    };
  await f.billing.storeVerified(event(f.s));
  await f.billing.projectOne();
  const c = await f.promotions.createCampaign(
      admin,
      campaign({ targetGuildId: f.s.guildId }),
    ),
    code = await f.promotions.generateCode(admin, c.id);
  await f.promotions.redeem(f.s, actor.key, code.code, "MANUAL");
  const privacy = new PrivacyService(db, vault, settings);
  await privacy.delete(f.s, user, actor);
  expect(
    (
      await sql<{
        actor_hash: string | null;
      }>`SELECT actor_hash FROM promotion_redemptions WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!.actor_hash,
  ).toBeNull();
  await f.billing.storeVerified(event(f.s, { version: 2 }));
  await Promise.all([
    f.billing.projectOne(),
    privacy.delete(f.s, user, actor, true),
  ]);
  for (const table of [
    "billing_provider_events",
    "billing_subscriptions",
    "billing_subscription_assignments",
    "entitlement_grants",
    "promotion_redemptions",
  ])
    expect(
      (
        await sql`SELECT * FROM ${sql.table(table)} WHERE organization_id=${f.s.organizationId}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
  await expect(
    f.billing.storeVerified(event(f.s, { version: 3 })),
  ).rejects.toThrow("PRIVACY_DELETED");
  await expect(
    new BillingWorker(db, vault, new FakeDiscord()).tick(f.s),
  ).rejects.toThrow("PRIVACY_DELETED");
  expect(
    (
      await sql`SELECT * FROM billing_reconcile_jobs WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql<{
        revoked_at: Date | null;
      }>`SELECT revoked_at FROM promotion_campaigns WHERE id=${c.id}::uuid`.execute(
        db,
      )
    ).rows[0]!.revoked_at,
  ).not.toBeNull();
});
it("privacy deletion does not recycle lifetime campaign or code redemption caps", async () => {
  for (const campaignLimit of [true, false]) {
    const a = await fixture(),
      b = await fixture(),
      c = await a.promotions.createCampaign(
        admin,
        campaign({ maxRedemptions: campaignLimit ? 1 : null }),
      ),
      code = await a.promotions.generateCode(admin, c.id, {
        maxRedemptions: campaignLimit ? 10 : 1,
      });
    await a.promotions.redeem(a.s, vault.hash(a.s, user), code.code);
    await new PrivacyService(db, vault, new SettingsService(db)).delete(
      a.s,
      user,
      {
        key: vault.hash(a.s, user),
        permissions: "32",
        roles: [],
        source: "WEB_DASHBOARD",
        requestId: "cap-privacy",
      },
      true,
    );
    expect(
      (
        await sql`SELECT id FROM promotion_redemptions WHERE ${tenant(a.s)}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    await expect(b.promotions.redeem(b.s, "actor", code.code)).rejects.toThrow(
      "PROMOTION_UNAVAILABLE",
    );
  }
});

it.each([
  {
    enabled: "false",
    country: "JP",
    discord: false,
    reviewed: false,
    price: 4900,
    currency: "USD",
    expected: null,
  },
  {
    enabled: "true",
    country: "JP",
    discord: false,
    reviewed: false,
    price: 4900,
    currency: "USD",
    expected: null,
  },
  {
    enabled: "false",
    country: "US",
    discord: true,
    reviewed: true,
    price: 3920,
    currency: "USD",
    expected: null,
  },
  {
    enabled: "false",
    country: "US",
    discord: true,
    reviewed: true,
    price: 4900,
    currency: "USD",
    expected: "DISCORD_PRICE_PARITY_REJECTED",
  },
  {
    enabled: "false",
    country: "US",
    discord: true,
    reviewed: false,
    price: 3920,
    currency: "USD",
    expected: "DISCORD_PRICE_PARITY_UNVERIFIED",
  },
  {
    enabled: "false",
    country: "US",
    discord: true,
    reviewed: true,
    price: 3920,
    currency: "JPY",
    expected: "DISCORD_PRICE_CURRENCY_UNVERIFIED",
  },
  {
    enabled: "false",
    country: "",
    discord: false,
    reviewed: false,
    price: 4900,
    currency: "USD",
    expected: "DISCOUNT_POLICY_REVIEW_REQUIRED",
  },
])(
  "activates discounts from offering policy, independent of button visibility: %j",
  async (input) => {
    vi.stubEnv("NEXUS_DISCORD_BILLING_ENABLED", input.enabled);
    vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", input.country || undefined);
    const externalId = randomUUID(),
      discordId = randomUUID();
    try {
      await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior,parity_reviewed_at) VALUES(${externalId}::uuid,'GROWTH',2,'STRIPE',true,'USD',4900,${"fixture-product-" + externalId},${"fixture-price-" + externalId},'EXCLUSIVE',now())`.execute(
        db,
      );
      if (input.discord)
        await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_offering_id,enabled,currency,final_price_minor,parity_reviewed_at,tax_behavior) VALUES(${discordId}::uuid,'GROWTH',2,'DISCORD',${"fixture-sku-" + discordId},true,${input.currency},${input.price},${input.reviewed ? new Date() : null},'EXCLUSIVE')`.execute(
          db,
        );
      const f = await fixture(),
        c = await f.promotions.createCampaign(
          admin,
          campaign({
            benefitType: "DISCOUNT",
            discountType: "PERCENT",
            discountValue: 20,
            allowedProviders: ["STRIPE"],
          }),
        );
      if (input.expected)
        await expect(
          f.promotions.activateCampaign(admin, c.id),
        ).rejects.toThrow(input.expected);
      else {
        await expect(
          f.promotions.activateCampaign(admin, c.id),
        ).resolves.toEqual({ id: c.id });
        const code = await f.promotions.generateCode(admin, c.id);
        await expect(
          f.promotions.redeem(f.s, vault.hash(f.s, user), code.code, "STRIPE"),
        ).rejects.toThrow("DISCOUNT_PROVIDER_NOT_CONFIGURED");
        expect(await f.entitlements.plan(f.s)).toBe("FREE");
      }
    } finally {
      await sql`UPDATE billing_offerings SET enabled=false WHERE id IN (${externalId}::uuid,${discordId}::uuid)`.execute(
        db,
      );
      vi.unstubAllEnvs();
    }
  },
);
it("Enterprise contract history above Scale remains scoped and privacy fences history reads", async () => {
  const f = await fixture(),
    unrelated = await fixture();
  await f.promotions.issueGrant(f.s, admin, {
    source: "CONTRACT",
    plan: "ENTERPRISE",
    untilRevoked: true,
    limits: { historyDays: 1460 },
  });
  expect(await f.entitlements.visibleHistoryDays(f.s, 1800)).toBe(1460);
  expect(
    await unrelated.entitlements.visibleHistoryDays(unrelated.s, 1800),
  ).toBe(30);
  await new PrivacyService(db, vault, new SettingsService(db)).delete(
    f.s,
    user,
    {
      key: vault.hash(f.s, user),
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD",
      requestId: "history-privacy",
    },
    true,
  );
  await expect(f.entitlements.visibleHistoryDays(f.s, 30)).rejects.toThrow(
    "PRIVACY_DELETED",
  );
});
