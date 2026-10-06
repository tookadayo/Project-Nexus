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
import { IdentityVault } from "../../packages/identity/src/index";
import { ApiCredentials } from "../../packages/operations/src/credentials";
import {
  WebhookWorker,
  Webhooks,
  webhookSignature,
} from "../../packages/operations/src/webhooks";
import { operationsEvent } from "../../packages/operations/src/policy";
import { createApi } from "../../apps/api/src/server";
import { AnalyticsService } from "../../packages/analytics/src/index";
import type { Actor } from "../../packages/settings/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import { PrivacyService } from "../../packages/security/src/privacy";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  guild = 932000000000000000n;
const vault = new IdentityVault("ab".repeat(32), "bc".repeat(32)),
  actor: Actor = {
    key: "operations-admin",
    permissions: "8",
    roles: [],
    source: "WEB_DASHBOARD",
    requestId: "operations-integration",
  };
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture(plan = "GROWTH") {
  const s = scopeForGuild(String(guild++));
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active') ON CONFLICT(organization_id,guild_id) DO UPDATE SET plan_key=EXCLUDED.plan_key,status='active'`.execute(
    db,
  );
  return s;
}
it("issues only hashed scoped credentials, serves real aggregate endpoints and revokes", async () => {
  const s = await fixture(),
    other = await fixture(),
    credentials = new ApiCredentials(db, vault),
    created = await credentials.create(s, actor, {
      name: "Metrics reader",
      scopes: ["metrics:read", "guild:read"],
    }),
    stored = (
      await sql`SELECT * FROM api_credentials WHERE ${tenant(s)}`.execute(db)
    ).rows;
  expect(JSON.stringify(stored)).not.toContain(created.token);
  expect(JSON.stringify(stored)).not.toContain(created.token.split(".")[1]);
  const app = createApi(
      new AnalyticsService(db, new SettingsService(db)),
      "internal-test-key",
      db,
      undefined,
      undefined,
      vault,
    ),
    metrics = await app.inject({
      url: "/v1/metrics",
      headers: { authorization: "Bearer " + created.token },
    });
  expect(metrics.statusCode).toBe(200);
  expect(metrics.json()).toMatchObject({
    version: 1,
    metric: "reply",
    evidence: { value: null, coverageState: "UNKNOWN" },
  });
  const scoped = await app.inject({
    url:
      "/v1/metrics?q=" +
      encodeURIComponent(JSON.stringify({ guildId: other.guildId })),
    headers: { authorization: "Bearer " + created.token },
  });
  expect(scoped.statusCode).toBe(400);
  expect(
    (
      await app.inject({
        url: "/v1/attention",
        headers: { authorization: "Bearer " + created.token },
      })
    ).statusCode,
  ).toBe(403);
  await expect(credentials.revoke(other, actor, created.id)).rejects.toThrow(
    "CREDENTIAL_NOT_FOUND",
  );
  await credentials.revoke(s, actor, created.id);
  expect(
    (
      await app.inject({
        url: "/v1/guild",
        headers: { authorization: "Bearer " + created.token },
      })
    ).statusCode,
  ).toBe(401);
  await app.close();
});
it("enforces an atomic rate limit and disables paid tokens on downgrade without deleting configuration", async () => {
  const s = await fixture(),
    credentials = new ApiCredentials(db, vault),
    created = await credentials.create(s, actor, {
      name: "Reader",
      scopes: ["guild:read"],
    }),
    now = new Date("2026-10-06T13:01:00Z");
  const results = await Promise.allSettled(
    Array.from({ length: 62 }, () =>
      credentials.authenticate(created.token, "guild:read", now),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(60);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    2,
  );
  await sql`UPDATE guild_subscriptions SET plan_key='STARTER' WHERE ${tenant(s)}`.execute(
    db,
  );
  await expect(
    credentials.authenticate(created.token, "guild:read"),
  ).rejects.toThrow("PLAN_REQUIRED");
  expect((await credentials.list(s, actor)).length).toBe(1);
  await expect(
    credentials.create(s, actor, {
      name: "Unsafe",
      kind: "SERVICE_ACCOUNT",
      scopes: ["attention:write"],
    }),
  ).rejects.toThrow("PLAN_REQUIRED");
});
it("signs stable deliveries, retries timeouts, rotates keys and never repeats a successful event", async () => {
  const s = await fixture(),
    webhooks = new Webhooks(db, vault),
    endpoint = await webhooks.create(s, actor, {
      name: "Operations",
      url: "https://example.com/nexus",
      events: ["coverage.changed"],
    });
  const event = await operationsEvent(
      db,
      s,
      "coverage.changed",
      "coverage-test",
      { coverage: { coverageState: "PARTIAL" } },
    ),
    sent: { body: string; headers: Record<string, string> }[] = [],
    worker = new WebhookWorker(db, vault, async (_url, body, headers) => {
      sent.push({ body, headers });
      if (sent.length === 1) throw new Error("WEBHOOK_TIMEOUT");
      return 204;
    });
  expect(await worker.tick(s)).toBe(true);
  let delivery = (
    await sql<{
      id: string;
      state: string;
      last_error: string;
      available_at: Date;
    }>`SELECT id,state,last_error,available_at FROM webhook_deliveries WHERE ${tenant(s)} AND event_id=${event}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(delivery).toMatchObject({ state: "PENDING", last_error: "TIMEOUT" });
  const rotated = await webhooks.rotate(s, actor, endpoint.id);
  expect(rotated.version).toBe(2);
  await worker.tick(s, new Date(delivery.available_at.getTime() + 1));
  delivery = (
    await sql<{
      id: string;
      state: string;
      last_error: string;
      available_at: Date;
    }>`SELECT id,state,last_error,available_at FROM webhook_deliveries WHERE ${tenant(s)} AND event_id=${event}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(delivery.state).toBe("SUCCEEDED");
  expect(sent[0]!.body).toBe(sent[1]!.body);
  expect(sent[1]!.headers["Nexus-Delivery-Id"]).toBe(delivery.id);
  expect(sent[1]!.headers["Nexus-Signature"]).toBe(
    webhookSignature(
      endpoint.secret,
      sent[1]!.headers["Nexus-Timestamp"]!,
      delivery.id,
      sent[1]!.body,
    ),
  );
  expect(sent[1]!.headers["Nexus-Key-Version"]).toBe("1");
  expect(await worker.tick(s)).toBe(false);
  expect(sent).toHaveLength(2);
  expect(
    JSON.stringify((await webhooks.list(s, actor)).deliveries),
  ).not.toContain(endpoint.secret);
  await webhooks.setEnabled(s, actor, endpoint.id, false);
  await operationsEvent(db, s, "coverage.changed", "disabled", {
    coverage: "UNKNOWN",
  });
  await worker.tick(s);
  expect(sent).toHaveLength(2);
});
it("isolates endpoints and deletion fences queued work", async () => {
  const s = await fixture(),
    other = await fixture(),
    webhooks = new Webhooks(db, vault),
    endpoint = await webhooks.create(s, actor, {
      name: "Safe",
      url: "https://example.com",
      events: ["attention.created"],
    });
  await expect(webhooks.rotate(other, actor, endpoint.id)).rejects.toThrow(
    "WEBHOOK_NOT_FOUND",
  );
  await operationsEvent(db, s, "attention.created", "privacy-delete", {
    state: "OPEN",
  });
  const user = "222222222222222222";
  await new PrivacyService(db, vault, new SettingsService(db)).delete(
    s,
    user,
    { ...actor, key: vault.hash(s, user) },
    true,
  );
  let called = false;
  await new WebhookWorker(db, vault, async () => {
    called = true;
    return 200;
  }).tick(s);
  expect(called).toBe(false);
  expect(
    (await sql`SELECT id FROM webhook_endpoints WHERE ${tenant(s)}`.execute(db))
      .rows,
  ).toEqual([]);
});
it("expired rotated secrets never send and eight failed deliveries disable the endpoint", async () => {
  const s = await fixture(),
    webhooks = new Webhooks(db, vault),
    endpoint = await webhooks.create(s, actor, {
      name: "Expires",
      url: "https://example.com",
      events: ["coverage.changed"],
    });
  await operationsEvent(db, s, "coverage.changed", "old-key", {});
  let calls = 0;
  const failed = new WebhookWorker(db, vault, async () => {
    calls++;
    return 503;
  });
  await failed.tick(s);
  await webhooks.rotate(s, actor, endpoint.id);
  await sql`UPDATE webhook_secrets SET valid_until=now()-interval '1 second' WHERE ${tenant(s)} AND version=1`.execute(
    db,
  );
  await sql`UPDATE webhook_deliveries SET available_at=now()-interval '1 second' WHERE ${tenant(s)}`.execute(
    db,
  );
  await failed.tick(s);
  expect(calls).toBe(1);
  expect((await webhooks.list(s, actor)).deliveries).toContainEqual(
    expect.objectContaining({
      state: "FAILED",
      last_error: "WEBHOOK_SECRET_EXPIRED",
    }),
  );
  const bad = await fixture(),
    e = await webhooks.create(bad, actor, {
      name: "Failing",
      url: "https://example.com",
      events: ["coverage.changed"],
    });
  await operationsEvent(db, bad, "coverage.changed", "fails", {});
  for (let i = 0; i < 8; i++) {
    await sql`UPDATE webhook_deliveries SET available_at=now()-interval '1 second' WHERE ${tenant(bad)}`.execute(
      db,
    );
    await failed.tick(bad);
  }
  expect((await webhooks.list(bad, actor)).endpoints).toContainEqual(
    expect.objectContaining({ id: e.id, state: "DISABLED", failures: 8 }),
  );
  expect((await webhooks.list(bad, actor)).deliveries).toContainEqual(
    expect.objectContaining({ state: "FAILED", attempts: 8 }),
  );
});
