import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { operatorControlKey } from "../../packages/security/src/alpha16-operator";
import { IdentityVault } from "../../packages/identity/src/index";
import type { Actor } from "../../packages/settings/src/index";
import { Destinations } from "../../packages/operations/src/destinations";
import { ApiCredentials } from "../../packages/operations/src/credentials";
import { Webhooks, WebhookWorker, redactWebhookEventSources, type WebhookDispatchOptions } from "../../packages/operations/src/webhooks";
import { operationsEvent } from "../../packages/operations/src/policy";
import { FakeDiscord } from "../fixtures/discord";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, sequence = 0;
const vault = new IdentityVault("ab".repeat(32), "bc".repeat(32));
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
async function fixture() {
  const s = scopeForGuild(String(988200000000000000n + BigInt(++sequence)));
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH','active')`.execute(db);
  const actor: Actor = { key: vault.hash(s, "222222222222222222"), permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: randomUUID() };
  const proof = { scope: s, actorHash: actor.key, expiresAt: new Date(Date.now() + 60_000) }, discord = new FakeDiscord();
  return { s, actor, proof, discord, destinations: new Destinations(db, discord, proof), credentials: new ApiCredentials(db, vault, proof), webhooks: new Webhooks(db, vault, proof) };
}
async function dispatchFixture() {
  const f = await fixture(), endpoint = await f.webhooks.create(f.s, f.actor, { name: "Fixture endpoint", url: "https://example.com/private-hook?token=synthetic", events: ["coverage.changed"] });
  const expiry = new Date(Date.now() + 120_000);
  await sql`UPDATE webhook_endpoints SET delivery_gate='OPEN',safety_expires_at=${expiry},safety_policy_revision='fixture-target' WHERE ${tenant(f.s)} AND id=${endpoint.id}::uuid`.execute(db);
  for (const kind of ["GLOBAL", "GUILD"] as const) {
    const key = kind === "GLOBAL" ? "GLOBAL" : operatorControlKey({ scopeKind: kind, scope: f.s, targetId: null });
    await sql`INSERT INTO alpha16_operator_controls(scope_key,scope_kind,organization_id,guild_id,target_id,state,revision,reason_code,updated_at,expires_at)
      VALUES(${key},${kind},${kind === "GLOBAL" ? null : f.s.organizationId}::uuid,${kind === "GLOBAL" ? null : f.s.guildId},NULL,'RUNNING',1,'CONFIG_REVIEW',now(),${expiry})
      ON CONFLICT(scope_key) DO UPDATE SET state='RUNNING',expires_at=EXCLUDED.expires_at`.execute(db);
  }
  // Explicit isolated fixture approval; never loaded by an application factory.
  const options: WebhookDispatchOptions = { runtime: { purpose: "APPROVED_RUNTIME", approvalRevision: "fixture-runtime", heartbeatMs: 100, leaseMs: 2_000, requestDeadlineMs: 1_000, unknownResolutionMs: 3_000, operationTokenTtlMs: 3_000 },
    dispatchPolicy: { approved: true, policyRevision: "fixture-target", activationStartedAt: new Date(0), targetLiveSafetyMs: 180_000, independentRetentionEnforcementReady: true, targetWritersCompatible: true },
    verifyCurrentSafety: async () => true };
  const eventId = await db.transaction().execute(tx => operationsEvent(tx, f.s, "coverage.changed", randomUUID(), { coverage: "UNKNOWN" }));
  return { ...f, endpoint, eventId, options };
}

it("maintenance requires live scoped authorization and exact configuration CAS", async () => {
  const f = await fixture(), created = await f.destinations.create(f.s, f.actor, { name: "Original", kind: "DISCORD", channelId: "933333333333333330" });
  await expect(new Destinations(db, f.discord).update(f.s, f.actor, created.id, 1, { name: "Denied", kind: "DISCORD", channelId: "933333333333333330" })).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
  const results = await Promise.allSettled(["First", "Second"].map(name => f.destinations.update(f.s, f.actor, created.id, 1, { name, kind: "DISCORD", channelId: "933333333333333330" })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((await f.destinations.list(f.s, f.actor))[0]!.revision).toBe(2);
  const other = await fixture();
  await expect(new Destinations(db, f.discord, other.proof).delete(f.s, f.actor, created.id, 2)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
  await expect(new Destinations(db, f.discord, { ...f.proof, expiresAt: new Date(0) }).delete(f.s, f.actor, created.id, 2)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
});

it("destination references block routing changes and delete without cascading intake state", async () => {
  const f = await fixture(), created = await f.destinations.create(f.s, f.actor, { name: "Intake", kind: "DISCORD", channelId: "933333333333333330" });
  const panelId = randomUUID();
  await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,destination_id,actor_hash) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${panelId}::uuid,'Synthetic intake','support',${created.id}::uuid,${f.actor.key})`.execute(db);
  await expect(f.destinations.delete(f.s, f.actor, created.id, 1)).rejects.toThrow("DESTINATION_REFERENCED");
  await expect(f.destinations.update(f.s, f.actor, created.id, 1, { name: "Retarget", kind: "DISCORD", channelId: "933333333333333331" })).rejects.toThrow("DESTINATION_REFERENCED");
  await expect(sql`DELETE FROM integration_destinations WHERE ${tenant(f.s)} AND id=${created.id}::uuid`.execute(db)).rejects.toThrow();
  expect((await sql<{ destination_id: string }>`SELECT destination_id FROM operations_intake_panels WHERE ${tenant(f.s)} AND id=${panelId}::uuid`.execute(db)).rows[0]!.destination_id).toBe(created.id);
});

it("credential rotation invalidates previously authenticated IDs and never exposes stored tokens", async () => {
  const f = await fixture(), original = await f.credentials.create(f.s, f.actor, { name: "Reader", scopes: ["metrics:read", "guild:read"] });
  const authenticated = await f.credentials.authenticate(original.token, "guild:read");
  const replacement = await f.credentials.rotate(f.s, f.actor, original.id, 1);
  expect(replacement.replacedId).toBe(original.id); expect(replacement.id).not.toBe(original.id);
  await expect(f.credentials.authenticate(original.token, "guild:read")).rejects.toThrow("API_UNAUTHORIZED");
  await expect(db.transaction().execute(tx => f.credentials.fence(tx, f.s, authenticated.credentialId, "guild:read"))).rejects.toThrow("API_UNAUTHORIZED");
  await expect(f.credentials.rotate(f.s, f.actor, original.id, 1)).rejects.toThrow("REVISION_CONFLICT");
  await f.credentials.update(f.s, f.actor, replacement.id, 1, { name: "Guild reader", scopes: ["guild:read"] });
  await expect(f.credentials.authenticate(replacement.token, "metrics:read")).rejects.toThrow("API_SCOPE_REQUIRED");
  const exposed = JSON.stringify(await f.credentials.list(f.s, f.actor));
  expect(exposed).not.toContain(replacement.token); expect(exposed).not.toContain("token_hash");
  expect(JSON.stringify((await sql`SELECT * FROM api_credentials WHERE ${tenant(f.s)}`.execute(db)).rows)).not.toContain(replacement.token);
});

it("webhook lists redact URL secrets, validate public HTTPS, and preserve referenced endpoint history", async () => {
  const f = await fixture(), url = "https://example.com/secret-path?token=do-not-expose";
  const endpoint = await f.webhooks.create(f.s, f.actor, { name: "Webhook", url, events: ["coverage.changed"] });
  const list = await f.webhooks.list(f.s, f.actor);
  expect(list.endpoints[0]!.urlDisplay).toBe("https://example.com"); expect(JSON.stringify(list)).not.toContain("do-not-expose");
  await expect(f.webhooks.update(f.s, f.actor, endpoint.id, 1, { name: "SSRF", url: "https://127.0.0.1/hook", events: ["coverage.changed"] })).rejects.toThrow();
  await f.destinations.create(f.s, f.actor, { name: "Routed endpoint", kind: "WEBHOOK", endpointId: endpoint.id });
  await expect(f.webhooks.delete(f.s, f.actor, endpoint.id, 1)).rejects.toThrow("WEBHOOK_REFERENCED");
  await expect(f.webhooks.update(f.s, f.actor, endpoint.id, 1, { name: "Reroute", url: "https://example.net/hook", events: ["coverage.changed"] })).rejects.toThrow("WEBHOOK_REFERENCED");
  expect((await f.webhooks.update(f.s, f.actor, endpoint.id, 1, { name: "Renamed", url, events: ["coverage.changed"] })).revision).toBe(2);
});

it("unconfigured dispatch leaves pending data intact and never invokes transport", async () => {
  const f = await dispatchFixture(); let calls = 0;
  const id = randomUUID();
  await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,id,endpoint_id,event_id,secret_version) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${id}::uuid,${f.endpoint.id}::uuid,${f.eventId}::uuid,1)`.execute(db);
  expect(await new WebhookWorker(db, vault, async () => { ++calls; return 200; }).tick(f.s)).toBe(false);
  expect(calls).toBe(0);
  expect((await sql<{ state: string }>`SELECT state FROM webhook_deliveries WHERE ${tenant(f.s)} AND id=${id}::uuid`.execute(db)).rows[0]!.state).toBe("PENDING");
});

it("webhook admission commits before transport, and unknown results block repeat sends and ordinary enable", async () => {
  const f = await dispatchFixture(); let calls = 0;
  const worker = new WebhookWorker(db, vault, async (_url, _body, headers) => {
    ++calls;
    const durable = (await sql<{ state: string; send_admitted_at: Date | null }>`SELECT state,send_admitted_at FROM webhook_deliveries WHERE ${tenant(f.s)} AND id=${headers["Nexus-Delivery-Id"]}::uuid`.execute(db)).rows[0]!;
    expect(durable.state).toBe("RUNNING"); expect(durable.send_admitted_at).not.toBeNull();
    throw new Error("synthetic response lost after send");
  }, f.options);
  expect(await worker.tick(f.s)).toBe(true); expect(calls).toBe(1);
  expect((await sql<{ state: string }>`SELECT state FROM webhook_deliveries WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.state).toBe("UNKNOWN");
  expect((await sql<{ delivery_gate: string }>`SELECT delivery_gate FROM webhook_endpoints WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.delivery_gate).toBe("UNKNOWN_BLOCKED");
  expect(await worker.tick(f.s)).toBe(false); expect(calls).toBe(1);
  await expect(f.webhooks.setEnabled(f.s, f.actor, f.endpoint.id, true, 1)).rejects.toThrow("WEBHOOK_RESULT_UNKNOWN");
  await expect(f.webhooks.delete(f.s, f.actor, f.endpoint.id, 1)).rejects.toThrow("WEBHOOK_RESULT_UNKNOWN");
});

it("expired admitted webhook leases become UNKNOWN and cannot be reset to pending", async () => {
  const f = await dispatchFixture(), deliveryId = randomUUID(); let calls = 0;
  await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,id,endpoint_id,event_id,secret_version,state,attempts,lease_token,lease_until,endpoint_revision,endpoint_safety_epoch,send_admitted_at,request_deadline_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${deliveryId}::uuid,${f.endpoint.id}::uuid,${f.eventId}::uuid,1,'RUNNING',1,${randomUUID()}::uuid,now()-interval '1 second',1,1,now()-interval '2 seconds',now()-interval '1 second')`.execute(db);
  await expect(sql`UPDATE webhook_deliveries SET state='PENDING' WHERE ${tenant(f.s)} AND id=${deliveryId}::uuid`.execute(db)).rejects.toThrow("WEBHOOK_ADMITTED_RESET_FORBIDDEN");
  expect(await new WebhookWorker(db, vault, async () => { ++calls; return 200; }, f.options).tick(f.s)).toBe(false);
  expect(calls).toBe(0);
  expect((await sql<{ state: string }>`SELECT state FROM webhook_deliveries WHERE ${tenant(f.s)} AND id=${deliveryId}::uuid`.execute(db)).rows[0]!.state).toBe("UNKNOWN");
});

it("source erasure removes payload but preserves uncertain delivery metadata and its original time anchor", async () => {
  const f = await dispatchFixture(), id = randomUUID();
  const anchor = (await sql<{ created_at: Date }>`SELECT created_at FROM operations_domain_events WHERE ${tenant(f.s)} AND id=${f.eventId}::uuid`.execute(db)).rows[0]!.created_at;
  await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,id,endpoint_id,event_id,secret_version,state,attempts,lease_token,lease_until,endpoint_revision,endpoint_safety_epoch,send_admitted_at,request_deadline_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${id}::uuid,${f.endpoint.id}::uuid,${f.eventId}::uuid,1,'RUNNING',1,${randomUUID()}::uuid,now()+interval '1 minute',1,1,now(),now()+interval '30 seconds')`.execute(db);
  const unused = await db.transaction().execute(tx => operationsEvent(tx, f.s, "coverage.changed", randomUUID(), { private: "synthetic source" }));
  expect(await db.transaction().execute(tx => redactWebhookEventSources(tx, f.s, [f.eventId, unused]))).toMatchObject({ redactedEvents: 1, deletedEvents: 1, unknownDeliveries: 1, blockedEndpoints: 1 });
  const source = (await sql<{ data: unknown; dedupe_key: string; created_at: Date; expanded_at: Date | null }>`SELECT data,dedupe_key,created_at,expanded_at FROM operations_domain_events WHERE ${tenant(f.s)} AND id=${f.eventId}::uuid`.execute(db)).rows[0]!;
  expect(source.data).toEqual({}); expect(source.created_at).toEqual(anchor); expect(source.expanded_at).not.toBeNull();
  expect(source.dedupe_key).toBe("erased:" + f.eventId);
  expect((await sql<{ state: string }>`SELECT state FROM webhook_deliveries WHERE ${tenant(f.s)} AND id=${id}::uuid`.execute(db)).rows[0]!.state).toBe("UNKNOWN");
  expect((await sql<{ delivery_gate: string }>`SELECT delivery_gate FROM webhook_endpoints WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.delivery_gate).toBe("UNKNOWN_BLOCKED");
});
