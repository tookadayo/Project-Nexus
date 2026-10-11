import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  connect,
  migrate,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import {
  BetaOperator,
  type BetaChange,
} from "../../packages/security/src/beta-operator";
import { betaInvitation } from "../../packages/security/src/hosted-beta";
import { IdentityVault } from "../../packages/identity/src/index";
import {
  ApiCredentials,
  type ApiScope,
} from "../../packages/operations/src/credentials";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { AnalyticsService } from "../../packages/analytics/src/index";
import { ExploreService } from "../../packages/analytics/src/explore";
import { createApi } from "../../apps/api/src/server";
import { isolatedPostgres } from "../fixtures/postgres";
import { OperationsOrganization } from "../../packages/operations/src/organization";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { FakeDiscord } from "../fixtures/discord";

let infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  db: Database,
  operator: BetaOperator,
  credentials: ApiCredentials,
  app: ReturnType<typeof createApi>,
  serial = 0;
const vault = new IdentityVault("ac".repeat(32), "bd".repeat(32));
const user = "884111111111111111",
  channel = "884222222222222222";
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "on");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
  operator = new BetaOperator(db, async () => ({
    name: "Synthetic API Beta server",
    present: true,
    canObserve: true,
    checkedAt: Date.now(),
  }));
  credentials = new ApiCredentials(db, vault);
  app = createApi(
    new AnalyticsService(db, new SettingsService(db)),
    "synthetic-api-key",
    db,
    undefined,
    undefined,
    vault,
  );
});
afterAll(async () => {
  await app?.close();
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});
afterEach(async () => {
  for (const row of await operator.list()) {
    const s = scopeForGuild(row.guild_id);
    if (
      row.status === "ACTIVE" &&
      !(
        await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(s)}`.execute(
          db,
        )
      ).rows.length
    )
      await change(row.guild_id, "revoke");
  }
});
async function change(guildId: string, action: BetaChange["action"]) {
  const row = await betaInvitation(db, scopeForGuild(guildId));
  return operator.change({
    guildId,
    action,
    generation: row?.generation ?? null,
    requestId: randomUUID(),
    reason: "Synthetic API admission regression",
  });
}
async function fixture(
  scopes: ApiScope[] = ["guild:read", "attention:read", "attention:write"],
) {
  const s = scopeForGuild(String(884000000000000000n + BigInt(++serial)));
  await change(s.guildId, "register");
  await change(s.guildId, "activate");
  // An independent license must never substitute for Beta admission.
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},'SCALE','active') ON CONFLICT(organization_id,guild_id) DO UPDATE SET plan_key='SCALE',status='active'`.execute(
    db,
  );
  const actor: Actor = {
    key: vault.hash(s, user),
    permissions: "8",
    roles: [],
    source: "WEB_DASHBOARD",
    requestId: "synthetic-beta-api",
  };
  const token = await credentials.create(s, actor, {
    name: "Synthetic API credential",
    scopes,
  });
  const key = "synthetic-attention-" + serial;
  const row = (
    await sql<{
      version: number;
    }>`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,opened_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channel},${key},now(),'OPEN',now()) RETURNING version`.execute(
      db,
    )
  ).rows[0]!;
  return { s, actor, token, key, version: row.version };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function update(f: Fixture) {
  return app.inject({
    method: "POST",
    url: "/v1/attention/state",
    headers: { authorization: "Bearer " + f.token.token },
    payload: {
      key: f.key,
      channelId: channel,
      state: "ACKNOWLEDGED",
      version: f.version,
    },
  });
}
async function effects(f: Fixture) {
  return {
    attention: (
      await sql`SELECT status,version,resolved_at FROM attention_items WHERE ${tenant(f.s)} AND message_id=${f.key}`.execute(
        db,
      )
    ).rows,
    audit: (
      await sql`SELECT id FROM operations_audit_events WHERE ${tenant(f.s)} AND action='ATTENTION_API_UPDATED'`.execute(
        db,
      )
    ).rows,
    used: (
      await sql`SELECT last_used_at FROM api_credentials WHERE ${tenant(f.s)} AND id=${f.token.id}::uuid`.execute(
        db,
      )
    ).rows,
    usage: (
      await sql`SELECT month_start,requests FROM api_guild_usage_months WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  };
}
async function waitForExclusive() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (
        await sql`SELECT pid FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted`.execute(
          db,
        )
      ).rows.length
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("EXPECTED_PENDING_BETA_STOP");
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("allows active writes but rejects paused and expired writes before any mutation or usage change", async () => {
  const active = await fixture();
  const accepted = await update(active);
  expect(accepted.statusCode).toBe(200);
  expect(accepted.json()).toEqual({
    state: "ACKNOWLEDGED",
    version: active.version + 1,
  });
  for (const state of ["paused", "expired"] as const) {
    const f = await fixture();
    if (state === "paused") await change(f.s.guildId, "pause");
    else
      await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE ${tenant(f.s)}`.execute(
        db,
      );
    const before = await effects(f);
    const denied = await update(f);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: "BETA_UNAVAILABLE" });
    expect(await effects(f)).toEqual(before);
  }
});
it("retains permitted reads for read-only, mixed-scope and service-account credentials while work is stopped", async () => {
  const f = await fixture();
  const readers = [f.token];
  for (const kind of ["PERSONAL", "SERVICE_ACCOUNT"] as const)
    readers.push(
      await credentials.create(f.s, f.actor, {
        name: "Synthetic reader",
        kind,
        scopes: ["guild:read"],
      }),
    );
  await change(f.s.guildId, "pause");
  for (const expired of [false, true]) {
    if (expired)
      await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '1 day' WHERE ${tenant(f.s)}`.execute(
        db,
      );
    for (const reader of readers) {
      const response = await app.inject({
        url: "/v1/guild",
        headers: { authorization: "Bearer " + reader.token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ guildId: f.s.guildId });
    }
  }
});
it("rejects reads outside retention and missing or inactive invitations even when a valid API license survives", async () => {
  for (const state of [
    "missing",
    "REGISTERED",
    "REVOKED",
    "DELETING",
    "DELETED",
    "deletion-marker",
    "expired",
  ] as const) {
    const f = await fixture();
    if (state === "missing")
      await sql`DELETE FROM beta_guild_invitations WHERE ${tenant(f.s)}`.execute(
        db,
      );
    else if (state === "deletion-marker")
      await sql`INSERT INTO beta_deletion_jobs(id,organization_id,guild_id,reason) VALUES(${randomUUID()}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},'DELETE_REQUEST')`.execute(
        db,
      );
    else if (state === "expired")
      await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '31 days' WHERE ${tenant(f.s)}`.execute(
        db,
      );
    else
      await sql`UPDATE beta_guild_invitations SET status=${state} WHERE ${tenant(f.s)}`.execute(
        db,
      );
    const before = await effects(f);
    await expect(
      credentials.authenticate(f.token.token, "guild:read"),
    ).rejects.toMatchObject({ code: "BETA_UNAVAILABLE", status: 403 });
    expect(await effects(f)).toEqual(before);
  }
});
it("preserves wrong-secret, scope and revoked-credential errors and leaves Beta-off access unchanged", async () => {
  const f = await fixture(["guild:read"]);
  await change(f.s.guildId, "pause");
  const wrong =
    f.token.token.slice(0, -1) + (f.token.token.endsWith("0") ? "1" : "0");
  await expect(
    credentials.authenticate(wrong, "guild:read"),
  ).rejects.toMatchObject({ code: "API_UNAUTHORIZED", status: 401 });
  await expect(
    credentials.authenticate(f.token.token, "attention:write"),
  ).rejects.toMatchObject({ code: "API_SCOPE_REQUIRED", status: 403 });
  await change(f.s.guildId, "revoke");
  await expect(
    credentials.authenticate(f.token.token, "guild:read"),
  ).rejects.toMatchObject({ code: "API_UNAUTHORIZED", status: 401 });
  const standalone = await fixture();
  await change(standalone.s.guildId, "pause");
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  try {
    expect((await update(standalone)).statusCode).toBe(200);
  } finally {
    vi.stubEnv("NEXUS_HOSTED_BETA", "on");
  }
});
it("rechecks admission after authentication and holds an admitted mutation ahead of a concurrent stop", async () => {
  const f = await fixture();
  const authenticated = await credentials.authenticate(
    f.token.token,
    "attention:write",
  );
  await change(f.s.guildId, "pause");
  await expect(
    db
      .transaction()
      .execute((tx) =>
        credentials.fence(
          tx,
          authenticated.scope,
          authenticated.credentialId,
          "attention:write",
        ),
      ),
  ).rejects.toMatchObject({ code: "BETA_UNAVAILABLE", status: 403 });
  await db
    .transaction()
    .execute((tx) =>
      credentials.fence(tx, authenticated.scope, authenticated.credentialId),
    );
  await change(f.s.guildId, "resume");
  const entered = deferred(),
    release = deferred();
  const writing = db.transaction().execute(async (tx) => {
    await credentials.fence(tx, f.s, f.token.id, "attention:write");
    entered.resolve();
    await release.promise;
    await sql`UPDATE attention_items SET status='ACKNOWLEDGED',version=version+1 WHERE ${tenant(f.s)} AND message_id=${f.key}`.execute(
      tx,
    );
  });
  await entered.promise;
  let stopped = false;
  const stopping = change(f.s.guildId, "pause").then(() => {
    stopped = true;
  });
  try {
    await waitForExclusive();
    expect(stopped).toBe(false);
  } finally {
    release.resolve();
    await Promise.all([writing, stopping]);
  }
  expect((await effects(f)).attention).toEqual([
    { status: "ACKNOWLEDGED", version: f.version + 1, resolved_at: null },
  ]);
  await expect(
    db
      .transaction()
      .execute((tx) =>
        credentials.fence(tx, f.s, f.token.id, "attention:write"),
      ),
  ).rejects.toThrow("BETA_UNAVAILABLE");
});
it("serializes authentication with revocation without reversing the Beta and credential lock order", async () => {
  const f = await fixture();
  const locked = deferred(),
    release = deferred();
  const holding = db.transaction().execute(async (tx) => {
    await sql`SELECT id FROM api_credentials WHERE id=${f.token.id}::uuid FOR UPDATE`.execute(
      tx,
    );
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const authenticating = credentials.authenticate(f.token.token, "guild:read");
  let revoking: Promise<unknown> | undefined;
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = (
        await sql`SELECT pid FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT id,token_hash,%'`.execute(
          db,
        )
      ).rows;
      if (rows.length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    revoking = change(f.s.guildId, "revoke");
    await waitForExclusive();
  } finally {
    release.resolve();
    await Promise.all([holding, authenticating, revoking]);
  }
  await expect(
    credentials.authenticate(f.token.token, "guild:read"),
  ).rejects.toMatchObject({ code: "API_UNAUTHORIZED", status: 401 });
});
it.each(["revoked", "retention-ended"] as const)(
  "does not return a %s linked guild through an active organization's token",
  async (state) => {
    const f = await fixture(["organization:read"]),
      target = await fixture();
    const discord = new FakeDiscord();
    discord.members.set(user, {
      permissions: "8",
      roles: [],
      joinedAt: "2026-01-01T00:00:00Z",
      bot: false,
      pending: false,
    });
    const authority = new ServerAuthorization(
      discord,
      new SettingsService(db),
      vault,
    );
    const organization = new OperationsOrganization(
      db,
      vault,
      discord,
      authority,
    );
    await organization.create(
      f.s,
      f.actor,
      user,
      "Synthetic Beta organization",
    );
    await organization.link(f.s, f.actor, user, target.s.guildId);
    const request = () =>
      app.inject({
        url: "/v1/organization",
        headers: { authorization: "Bearer " + f.token.token },
      });
    const active = await request();
    expect(active.statusCode).toBe(200);
    expect(active.json().guilds).toContainEqual(
      expect.objectContaining({
        guildId: target.s.guildId,
        state: "ACTIVE",
        openAttention: 1,
      }),
    );
    if (state === "revoked") await change(target.s.guildId, "revoke");
    else
      await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '31 days' WHERE ${tenant(target.s)}`.execute(
        db,
      );
    const denied = await request();
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: "BETA_UNAVAILABLE" });
    expect(denied.json()).not.toHaveProperty("guilds");
  },
);
it("finishes concurrent linked-guild aggregates and Beta stops without retaining cross-connection fences", async () => {
  const home = await fixture(["organization:read"]),
    target = await fixture(["organization:read"]),
    discord = new FakeDiscord();
  discord.members.set(user, {
    permissions: "8",
    roles: [],
    joinedAt: "2026-01-01T00:00:00Z",
    bot: false,
    pending: false,
  });
  const organization = new OperationsOrganization(
    db,
    vault,
    discord,
    new ServerAuthorization(discord, new SettingsService(db), vault),
  );
  await organization.create(home.s, home.actor, user, "Concurrent Beta reads");
  await organization.link(home.s, home.actor, user, target.s.guildId);
  // A database deadline makes an application-level cross-connection deadlock
  // fail this test instead of leaving a pooled connection blocked indefinitely.
  const url = new URL(infra.databaseUrl);
  url.searchParams.set("options", "-c statement_timeout=5000");
  const raceDb = connect(url.href),
    raceApp = createApi(
      new AnalyticsService(raceDb, new SettingsService(raceDb)),
      "synthetic-race-key",
      raceDb,
      undefined,
      undefined,
      vault,
    ),
    raceOperator = new BetaOperator(raceDb, async () => ({
      name: "Synthetic concurrent Beta server",
      present: true,
      canObserve: true,
      checkedAt: Date.now(),
    })),
    entered = deferred(),
    release = deferred(),
    originalChart = ExploreService.prototype.chart;
  let readers = 0,
    stopsFinished = 0;
  const chart = vi
    .spyOn(ExploreService.prototype, "chart")
    .mockImplementation(async function (this: ExploreService, ...args) {
      const result = await originalChart.apply(this, args);
      if (args[0].guildId === home.s.guildId) {
        if (++readers === 2) entered.resolve();
        await release.promise;
      }
      return result;
    });
  const reading = Promise.all(
    [home, target].map((f) =>
      raceApp.inject({
        url: "/v1/organization",
        headers: { authorization: "Bearer " + f.token.token },
      }),
    ),
  );
  let stopping: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await entered.promise;
    stopping = Promise.allSettled(
      [home, target].map(async (f) => {
        try {
          const row = await betaInvitation(raceDb, f.s);
          return await raceOperator.change({
            guildId: f.s.guildId,
            action: "pause",
            generation: row!.generation,
            requestId: randomUUID(),
            reason: "Concurrent aggregate regression",
          });
        } finally {
          stopsFinished++;
        }
      }),
    );
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = (
        await sql`SELECT pid FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted`.execute(
          db,
        )
      ).rows.length;
      if (stopsFinished === 2 || pending >= 2) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(ready).toBe(true);
    release.resolve();
    expect((await reading).map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect((await stopping).map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    for (const f of [home, target])
      expect((await betaInvitation(db, f.s))?.status).toBe("PAUSED");
  } finally {
    release.resolve();
    await Promise.allSettled([reading, stopping]);
    chart.mockRestore();
    await raceApp.close();
    await raceDb.destroy();
  }
}, 20000);
