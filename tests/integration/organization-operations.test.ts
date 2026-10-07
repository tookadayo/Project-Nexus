import { afterAll, beforeAll, expect, it } from "vitest";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/index";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { EntitlementService } from "../../packages/settings/src/billing/entitlements";
import { planRegistry, plans } from "../../packages/settings/src/plan-registry";
import { FakeDiscord } from "../fixtures/discord";
import { DiscordFailure } from "../../packages/discord/src/rest";
import {
  OperationsOrganization,
  auditExport,
} from "../../packages/operations/src/organization";
import {
  operationsAccess,
  actorPermissions,
} from "../../packages/operations/src/policy";
import { enforceOperationsPlan } from "../../packages/operations/src/plan-policy";
import { Destinations } from "../../packages/operations/src/destinations";
import { Playbooks } from "../../packages/operations/src/playbooks";
import { ApiCredentials } from "../../packages/operations/src/credentials";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  guild = 936000000000000000n;
const vault = new IdentityVault("ac".repeat(32), "be".repeat(32)),
  owner = "222222222222222220",
  viewer = "222222222222222221",
  operator = "222222222222222222",
  analyst = "222222222222222223",
  admin = "222222222222222224",
  channel = "933333333333333330";
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture(plan = "SCALE") {
  const s = scopeForGuild(String(guild++));
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active') ON CONFLICT(organization_id,guild_id) DO UPDATE SET plan_key=EXCLUDED.plan_key,status='active'`.execute(
    db,
  );
  const settings = new SettingsService(db),
    discord = new FakeDiscord();
  for (const id of [owner, viewer, operator, analyst, admin])
    discord.members.set(id, {
      permissions: id === operator || id === analyst ? "0" : "8",
      roles: [],
      joinedAt: "2026-01-01T00:00:00Z",
      bot: false,
      pending: false,
    });
  const authority = new ServerAuthorization(discord, settings, vault),
    actor: Actor = {
      key: vault.hash(s, owner),
      permissions: "8",
      roles: [],
      source: "WEB_DASHBOARD",
      requestId: "organization-test",
    };
  return {
    s,
    actor,
    discord,
    authority,
    organization: new OperationsOrganization(db, vault, discord, authority),
    actorFor: (id: string): Actor => ({
      ...actor,
      key: vault.hash(s, id),
      permissions: discord.members.get(id)!.permissions,
    }),
  };
}
it("projects an explicit organization license into linked guilds without reusing provider subscription bindings", async () => {
  const f = await fixture(),
    target = await fixture("FREE");
  await f.organization.create(f.s, f.actor, owner, "NEXUS operations");
  await f.organization.link(f.s, f.actor, owner, target.s.guildId);
  const ent = await new EntitlementService(db).effective(target.s);
  expect(ent.plan).toBe("SCALE");
  expect(ent.grants.some((g) => g.id.startsWith("organization-license:"))).toBe(
    true,
  );
  expect(ent.subscriptions).not.toContainEqual(
    expect.objectContaining({ provider: "STRIPE" }),
  );
  expect(
    (
      await sql`SELECT subscription_id FROM billing_subscription_assignments WHERE ${tenant(target.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  const center = await f.organization.commandCenter(f.s, f.actor);
  expect(center.map((row) => row.guildId)).toContain(target.s.guildId);
  expect(JSON.stringify(center)).not.toContain(viewer);
  expect(JSON.stringify(center)).not.toContain("user_ciphertext");
  await sql`UPDATE guild_subscriptions SET plan_key='GROWTH' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  expect((await new EntitlementService(db).effective(target.s)).plan).toBe(
    "FREE",
  );
  await enforceOperationsPlan(db, f.s);
  const retained = await f.organization.detail(f.s, f.actor);
  expect(retained.guilds).toContainEqual(
    expect.objectContaining({
      guild_id: target.s.guildId,
      state: "REQUIRES_REVIEW",
    }),
  );
  await sql`UPDATE guild_subscriptions SET plan_key='SCALE' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  expect((await new EntitlementService(db).effective(target.s)).plan).toBe(
    "FREE",
  );
  await f.organization.link(f.s, f.actor, owner, target.s.guildId, true);
  expect((await new EntitlementService(db).effective(target.s)).plan).toBe(
    "SCALE",
  );
});
it("enforces five NEXUS roles independently from Discord administrator permissions and retains team configuration", async () => {
  const f = await fixture();
  await f.organization.create(f.s, f.actor, owner, "Team");
  const v = await f.organization.member(f.s, f.actor, {
      userId: viewer,
      name: "Read only",
      role: "VIEWER",
    }),
    op = await f.organization.member(f.s, f.actor, {
      userId: operator,
      name: "Operator",
      role: "OPERATOR",
    }),
    an = await f.organization.member(f.s, f.actor, {
      userId: analyst,
      name: "Analyst",
      role: "ANALYST",
    }),
    ad = await f.organization.member(f.s, f.actor, {
      userId: admin,
      name: "Administrator",
      role: "ADMIN",
    });
  for (const [id, allowed, denied] of [
    [viewer, "READ", "OPERATE"],
    [operator, "OPERATE", "CONFIGURE"],
    [analyst, "ANALYZE", "OPERATE"],
    [admin, "GOVERN", null],
  ] as const) {
    await db
      .transaction()
      .execute((tx) => operationsAccess(tx, f.s, f.actorFor(id), allowed));
    if (denied)
      await expect(
        db
          .transaction()
          .execute((tx) => operationsAccess(tx, f.s, f.actorFor(id), denied)),
      ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
  }
  const team = await f.organization.team(f.s, f.actor, {
    name: "Operations",
    memberIds: [op.id, an.id],
  });
  expect((await f.organization.detail(f.s, f.actor)).teams).toContainEqual(
    expect.objectContaining({ id: team.id }),
  );
  await expect(
    f.organization.team(f.s, f.actorFor(viewer), {
      name: "Forbidden",
      memberIds: [v.id],
    }),
  ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
  await expect(
    f.organization.member(f.s, f.actorFor(admin), {
      userId: admin,
      name: "Elevate",
      role: "OWNER",
      revision: ad.revision,
    }),
  ).rejects.toThrow("OWNER_REQUIRED");
  const ownerId = (
    (await f.organization.detail(f.s, f.actor)).members as {
      id: string;
      role: string;
    }[]
  ).find((row) => row.role === "OWNER")!.id;
  await expect(
    f.organization.revokeMember(f.s, f.actor, ownerId),
  ).rejects.toThrow("LAST_OWNER_REQUIRED");
  await f.organization.revokeMember(f.s, f.actor, v.id);
  await expect(
    db
      .transaction()
      .execute((tx) => operationsAccess(tx, f.s, f.actorFor(viewer), "READ")),
  ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
});
it("keeps revoked membership tombstones when a linked guild is reviewed and reactivated", async () => {
  const f = await fixture(),
    target = await fixture("FREE");
  await f.organization.create(f.s, f.actor, owner, "Revocation review");
  const revoked = await f.organization.member(f.s, f.actor, {
    userId: viewer,
    name: "Former staff",
    role: "VIEWER",
  });
  await f.organization.link(f.s, f.actor, owner, target.s.guildId);
  await f.organization.revokeMember(f.s, f.actor, revoked.id);
  await sql`UPDATE operations_org_guilds SET state='REQUIRES_REVIEW' WHERE ${tenant(target.s)}`.execute(
    db,
  );
  await f.organization.link(f.s, f.actor, owner, target.s.guildId, true);
  const former = target.actorFor(viewer);
  expect(former.permissions).toBe("8");
  await expect(
    db
      .transaction()
      .execute((tx) => operationsAccess(tx, target.s, former, "READ")),
  ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
  await expect(
    new ApiCredentials(db, vault).create(target.s, former, {
      name: "Forbidden fallback",
      scopes: ["guild:read"],
    }),
  ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
  expect(
    (
      await sql`SELECT actor_hash FROM operations_role_bindings WHERE ${tenant(target.s)} AND actor_hash=${former.key}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("requires independent approval of the current immutable playbook revision and scoped teams", async () => {
  const f = await fixture();
  await f.organization.create(f.s, f.actor, owner, "Approval");
  const approver = await f.organization.member(f.s, f.actor, {
      userId: admin,
      name: "Approver",
      role: "ADMIN",
    }),
    team = await f.organization.team(f.s, f.actor, {
      name: "Review",
      memberIds: [approver.id],
    }),
    route = await new Destinations(db, f.discord).create(f.s, f.actor, {
      name: "Notify",
      kind: "DISCORD",
      channelId: channel,
    }),
    books = new Playbooks(db),
    definition = {
      trigger: { kind: "ATTENTION", type: "FORUM_SUPPORT" },
      destinations: [route.id],
      measurement: { query: { metric: "forum" } },
    },
    book = await books.save(f.s, f.actor, {
      name: "Approved operations",
      approvalRequired: true,
      definition,
    });
  await expect(
    books.transition(f.s, f.actor, {
      id: book.id,
      version: book.version,
      state: "ACTIVE",
    }),
  ).rejects.toThrow("APPROVAL_REQUIRED");
  const submitted = await books.transition(f.s, f.actor, {
    id: book.id,
    version: book.version,
    state: "SUBMITTED",
    teamId: team.id,
  });
  await expect(
    books.transition(f.s, f.actor, {
      id: book.id,
      version: submitted.version,
      state: "APPROVED",
    }),
  ).rejects.toThrow("INDEPENDENT_APPROVER_REQUIRED");
  const approved = await books.transition(f.s, f.actorFor(admin), {
    id: book.id,
    version: submitted.version,
    state: "APPROVED",
  });
  await books.transition(f.s, f.actor, {
    id: book.id,
    version: approved.version,
    state: "ACTIVE",
  });
  const active = (await books.list(f.s, f.actor))[0]!;
  const revised = await books.save(f.s, f.actor, {
    id: book.id,
    version: active.version,
    name: active.name,
    approvalRequired: true,
    definition,
  });
  expect(revised.state).toBe("DRAFT");
  await expect(
    books.transition(f.s, f.actor, {
      id: book.id,
      version: revised.version,
      state: "ACTIVE",
    }),
  ).rejects.toThrow("APPROVAL_REQUIRED");
  expect(await auditExport(db, f.s, f.actor, "JSON")).not.toContain(
    "user_ciphertext",
  );
  expect(await auditExport(db, f.s, f.actor, "CSV")).not.toContain(owner);
});
it("bounds organization guild slots, rejects missing membership and fails closed on transient lookups", async () => {
  const f = await fixture();
  await f.organization.create(f.s, f.actor, owner, "Capacity");
  for (let i = 0; i < 4; i++) {
    const target = await fixture("FREE");
    await f.organization.link(f.s, f.actor, owner, target.s.guildId);
  }
  const extra = await fixture("FREE");
  await expect(
    f.organization.link(f.s, f.actor, owner, extra.s.guildId),
  ).rejects.toThrow("BILLING_LIMIT_REACHED");
  const isolated = await fixture();
  await isolated.organization.create(
    isolated.s,
    isolated.actor,
    owner,
    "Failure test",
  );
  const original = isolated.discord.member.bind(isolated.discord);
  isolated.discord.member = async (guildId, userId) => {
    if (userId === viewer) throw new DiscordFailure(503);
    return original(guildId, userId);
  };
  await expect(
    isolated.organization.member(isolated.s, isolated.actor, {
      userId: viewer,
      name: "Unavailable",
      role: "VIEWER",
    }),
  ).rejects.toMatchObject({ status: 503 });
  isolated.discord.member = async () => {
    throw new DiscordFailure(404);
  };
  await expect(
    isolated.organization.member(isolated.s, isolated.actor, {
      userId: viewer,
      name: "Missing",
      role: "VIEWER",
    }),
  ).rejects.toThrow("STAFF_NOT_A_GUILD_MEMBER");
});
it("revokes issued credentials and rechecks advanced access after a Scale downgrade", async () => {
  const f = await fixture();
  await f.organization.create(f.s, f.actor, owner, "API team");
  const administrator = await f.organization.member(f.s, f.actor, {
      userId: admin,
      name: "API issuer",
      role: "ADMIN",
    }),
    credentials = new ApiCredentials(db, vault),
    key = await credentials.create(f.s, f.actorFor(admin), {
      name: "Service",
      kind: "SERVICE_ACCOUNT",
      scopes: ["attention:write", "organization:read"],
    });
  await credentials.authenticate(key.token, "attention:write");
  await f.organization.member(f.s, f.actor, {
    userId: admin,
    name: "Reader",
    role: "VIEWER",
    revision: administrator.revision,
  });
  await expect(
    db
      .transaction()
      .execute((tx) => credentials.fence(tx, f.s, key.id, "attention:write")),
  ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
  await f.organization.revokeMember(f.s, f.actor, administrator.id);
  await expect(
    credentials.authenticate(key.token, "organization:read"),
  ).rejects.toThrow("API_UNAUTHORIZED");
  const ownerKey = await credentials.create(f.s, f.actor, {
    name: "Advanced",
    kind: "SERVICE_ACCOUNT",
    scopes: ["guild:read"],
  });
  await sql`UPDATE guild_subscriptions SET plan_key='GROWTH' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await expect(
    db.transaction().execute((tx) => credentials.fence(tx, f.s, ownerKey.id)),
  ).rejects.toThrow("PLAN_REQUIRED");
  await enforceOperationsPlan(db, f.s);
  expect(await credentials.list(f.s, f.actor)).toContainEqual(
    expect.objectContaining({ id: ownerKey.id, state: "PAUSED_PLAN_LIMIT" }),
  );
});
it("keeps historical plan versions immutable and stores the exact latest capability catalog", async () => {
  for (const plan of plans) {
    const row = (
      await sql<{
        features: unknown;
        limits: unknown;
      }>`SELECT features,limits FROM billing_plan_versions WHERE plan_key=${plan} AND revision=${planRegistry[plan].revision}`.execute(
        db,
      )
    ).rows[0]!;
    expect(row.features).toEqual(planRegistry[plan].features);
    expect(row.limits).toEqual(planRegistry[plan].limits);
  }
  await expect(
    sql`UPDATE billing_plan_versions SET limits='{}' WHERE plan_key='FREE' AND revision=2`.execute(
      db,
    ),
  ).rejects.toThrow();
});

it.each([false, true])(
  "denies revoked staff who never joined the linked guild (member after link: %s), including historical missing bindings",
  async (afterLink) => {
    const f = await fixture(),
      target = await fixture("FREE");
    const original = f.discord.member.bind(f.discord);
    let joined = false;
    f.discord.member = async (guildId, userId) => {
      if (guildId === target.s.guildId && userId === viewer && !joined)
        throw new DiscordFailure(404);
      return original(guildId, userId);
    };
    await f.organization.create(f.s, f.actor, owner, "Absent revoked member");
    if (afterLink)
      await f.organization.link(f.s, f.actor, owner, target.s.guildId);
    const member = await f.organization.member(f.s, f.actor, {
      userId: viewer,
      name: "Former staff",
      role: "ADMIN",
    });
    if (!afterLink)
      await f.organization.link(f.s, f.actor, owner, target.s.guildId);
    expect(
      (
        await sql`SELECT * FROM operations_role_bindings WHERE ${tenant(target.s)} AND member_id=${member.id}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    await f.organization.revokeMember(f.s, f.actor, member.id);
    joined = true;
    const snapshot = await f.authority.snapshot(
      target.s,
      viewer,
      "WEB_DASHBOARD",
      "late-join",
    );
    expect(snapshot.actor.permissions).toBe("8");
    for (const historical of [false, true]) {
      if (historical)
        await sql`DELETE FROM operations_role_bindings WHERE ${tenant(target.s)} AND member_id=${member.id}::uuid`.execute(
          db,
        );
      await expect(
        db
          .transaction()
          .execute((tx) =>
            operationsAccess(tx, target.s, snapshot.actor, "READ"),
          ),
      ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
      await expect(
        new ApiCredentials(db, vault).create(target.s, snapshot.actor, {
          name: "Denied",
          scopes: ["guild:read"],
        }),
      ).rejects.toThrow("NEXUS_ROLE_REQUIRED");
      expect(await actorPermissions(db, target.s, snapshot.actor)).toEqual([]);
    }
    const ordinary = await f.authority.snapshot(
      target.s,
      admin,
      "WEB_DASHBOARD",
      "legitimate-admin",
    );
    await db
      .transaction()
      .execute((tx) => operationsAccess(tx, target.s, ordinary.actor, "READ"));
  },
);
it("serializes reactivation seat accounting and permits edits to an active member at capacity", async () => {
  const f = await fixture();
  await f.organization.create(f.s, f.actor, owner, "Seats");
  const revoked = [];
  for (const userId of [viewer, admin]) {
    const row = await f.organization.member(f.s, f.actor, {
      userId,
      name: "Reactivation",
      role: "VIEWER",
    });
    await f.organization.revokeMember(f.s, f.actor, row.id);
    revoked.push({ userId, revision: row.revision + 1 });
  }
  for (let i = 0; i < 18; i++) {
    const userId = String(223000000000000000n + BigInt(i));
    f.discord.members.set(userId, {
      permissions: "0",
      roles: [],
      bot: false,
      joinedAt: "",
    });
    await f.organization.member(f.s, f.actor, {
      userId,
      name: "Active staff",
      role: "VIEWER",
    });
  }
  const outcomes = await Promise.allSettled(
    revoked.map((row) =>
      f.organization.member(f.s, f.actor, {
        ...row,
        name: "Restore",
        role: "VIEWER",
      }),
    ),
  );
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.message,
  ).toBe("BILLING_LIMIT_REACHED");
  expect(
    (
      await sql<{
        n: number;
      }>`SELECT count(*)::int AS n FROM operations_org_members WHERE organization_id=${f.s.organizationId}::uuid AND state='ACTIVE'`.execute(
        db,
      )
    ).rows[0]!.n,
  ).toBe(20);
  const winner = outcomes.findIndex((r) => r.status === "fulfilled");
  const row = (
    outcomes[winner] as PromiseFulfilledResult<{ id: string; revision: number }>
  ).value;
  await f.organization.member(f.s, f.actor, {
    userId: revoked[winner]!.userId,
    revision: row.revision,
    name: "Edited at capacity",
    role: "VIEWER",
  });
});
