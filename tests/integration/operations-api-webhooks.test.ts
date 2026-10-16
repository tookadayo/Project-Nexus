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
  type WebhookDispatchOptions,
} from "../../packages/operations/src/webhooks";
import { operatorControlKey } from "../../packages/security/src/alpha16-operator";
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
async function fixtureDispatch(s: { organizationId: string; guildId: string }, endpointId: string): Promise<WebhookDispatchOptions> {
  const expiresAt = new Date(Date.now() + 120_000);
  await sql`UPDATE webhook_endpoints SET delivery_gate='OPEN',safety_expires_at=${expiresAt},safety_policy_revision='fixture-only-target' WHERE ${tenant(s)} AND id=${endpointId}::uuid`.execute(db);
  for (const kind of ["GLOBAL", "GUILD"] as const) {
    const key = kind === "GLOBAL" ? "GLOBAL" : operatorControlKey({ scopeKind: kind, scope: s, targetId: null });
    await sql`INSERT INTO alpha16_operator_controls(scope_key,scope_kind,organization_id,guild_id,target_id,state,revision,reason_code,updated_at,expires_at)
      VALUES(${key},${kind},${kind === "GLOBAL" ? null : s.organizationId}::uuid,${kind === "GLOBAL" ? null : s.guildId},NULL,'RUNNING',1,'CONFIG_REVIEW',now(),${expiresAt})
      ON CONFLICT(scope_key) DO UPDATE SET state='RUNNING',expires_at=EXCLUDED.expires_at`.execute(db);
  }
  return { runtime: { purpose: "APPROVED_RUNTIME", approvalRevision: "fixture-only-runtime", heartbeatMs: 100, leaseMs: 5000, requestDeadlineMs: 3000, unknownResolutionMs: 10_000, operationTokenTtlMs: 10_000 },
    dispatchPolicy: { approved: true, policyRevision: "fixture-only-target", activationStartedAt: new Date(0), targetLiveSafetyMs: 180_000, independentRetentionEnforcementReady: true, targetWritersCompatible: true },
    verifyCurrentSafety: async () => true };
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
  // Keep setup bursts within the database pool; race the last two permits.
  const results: PromiseSettledResult<unknown>[] = [];
  for (let offset = 0; offset < 58; offset += 10) {
    results.push(
      ...(await Promise.allSettled(
        Array.from({ length: Math.min(10, 58 - offset) }, () =>
          credentials.authenticate(created.token, "guild:read", now),
        ),
      )),
    );
  }
  expect(results.filter((result) => result.status === "rejected")).toEqual([]);
  const boundary = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      credentials.authenticate(created.token, "guild:read", now),
    ),
  );
  expect(boundary.filter((result) => result.status === "fulfilled")).toHaveLength(
    2,
  );
  const denied = boundary.filter((result) => result.status === "rejected");
  expect(denied).toHaveLength(2);
  for (const result of denied)
    expect(result.reason).toMatchObject({ code: "API_RATE_LIMIT", status: 429 });
  results.push(...boundary);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(60);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    2,
  );
  expect(
    (
      await sql`SELECT requests FROM api_usage_windows WHERE ${tenant(s)} AND credential_id=${created.id}::uuid AND window_kind='MINUTE' AND window_start=${now}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ requests: 60 }]);
  expect(
    (
      await sql`SELECT requests FROM api_guild_usage_months WHERE ${tenant(s)} AND month_start='2026-10-01'::date`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ requests: 60 }]);
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
it("signs committed deliveries, rotates keys for new events and never repeats successful events", async () => {
  const s = await fixture(),
    webhooks = new Webhooks(db, vault),
    endpoint = await webhooks.create(s, actor, {
      name: "Operations",
      url: "https://example.com/nexus",
      events: ["coverage.changed"],
    });
  const dispatch = await fixtureDispatch(s, endpoint.id);
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
      return 204;
    }, dispatch);
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
  expect(delivery).toMatchObject({ state: "SUCCEEDED", last_error: null });
  expect(sent[0]!.headers["Nexus-Delivery-Id"]).toBe(delivery.id);
  expect(sent[0]!.headers["Nexus-Signature"]).toBe(webhookSignature(endpoint.secret, sent[0]!.headers["Nexus-Timestamp"]!, delivery.id, sent[0]!.body));
  expect(sent[0]!.headers["Nexus-Key-Version"]).toBe("1");
  expect(await worker.tick(s)).toBe(false);
  const rotated = await webhooks.rotate(s, actor, endpoint.id);
  expect(rotated.version).toBe(2);
  await operationsEvent(db, s, "coverage.changed", "coverage-after-rotation", { coverage: "COMPLETE" });
  await worker.tick(s);
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
  expect(sent[1]!.body).not.toBe(sent[0]!.body);
  expect(sent[1]!.headers["Nexus-Signature"]).toBe(
    webhookSignature(
      rotated.secret,
      sent[1]!.headers["Nexus-Timestamp"]!,
      sent[1]!.headers["Nexus-Delivery-Id"]!,
      sent[1]!.body,
    ),
  );
  expect(sent[1]!.headers["Nexus-Key-Version"]).toBe("2");
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
it("expired rotated secrets stay unsent and post-admission failures become UNKNOWN without retry", async () => {
  const s = await fixture(),
    webhooks = new Webhooks(db, vault),
    endpoint = await webhooks.create(s, actor, {
      name: "Expires",
      url: "https://example.com",
      events: ["coverage.changed"],
    });
  const dispatch = await fixtureDispatch(s, endpoint.id);
  const oldEvent = await operationsEvent(db, s, "coverage.changed", "old-key", {});
  await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,endpoint_id,event_id,secret_version,endpoint_revision,endpoint_safety_epoch) VALUES(${s.organizationId}::uuid,${s.guildId},${endpoint.id}::uuid,${oldEvent}::uuid,1,1,1)`.execute(db);
  let calls = 0;
  const failed = new WebhookWorker(db, vault, async () => {
    calls++;
    return 503;
  }, dispatch);
  await webhooks.rotate(s, actor, endpoint.id);
  await sql`UPDATE webhook_secrets SET valid_until=now()-interval '1 second' WHERE ${tenant(s)} AND version=1`.execute(
    db,
  );
  await sql`UPDATE webhook_deliveries SET available_at=now()-interval '1 second' WHERE ${tenant(s)}`.execute(
    db,
  );
  await failed.tick(s);
  expect(calls).toBe(0);
  expect((await webhooks.list(s, actor)).deliveries).toContainEqual(
    expect.objectContaining({
      state: "PENDING",
      attempts: 0,
    }),
  );
  const bad = await fixture(),
    e = await webhooks.create(bad, actor, {
      name: "Failing",
      url: "https://example.com",
      events: ["coverage.changed"],
    });
  const badDispatch = await fixtureDispatch(bad, e.id);
  const badWorker = new WebhookWorker(db, vault, async () => { ++calls; return 503; }, badDispatch);
  await operationsEvent(db, bad, "coverage.changed", "fails", {});
  expect(await badWorker.tick(bad)).toBe(true);
  for (let i = 0; i < 3; i++) expect(await badWorker.tick(bad)).toBe(false);
  expect(calls).toBe(1);
  expect((await webhooks.list(bad, actor)).endpoints).toContainEqual(
    expect.objectContaining({ id: e.id, state: "ENABLED", delivery_gate: "UNKNOWN_BLOCKED" }),
  );
  expect((await webhooks.list(bad, actor)).deliveries).toContainEqual(
    expect.objectContaining({ state: "UNKNOWN", attempts: 1, last_error: "HTTP_503" }),
  );
});
