import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { WebhookWorker, type WebhookDispatchOptions } from "../../packages/operations/src/webhooks";
import { operatorControlKey } from "../../packages/security/src/alpha16-operator";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>;
const vault = new IdentityVault("ab".repeat(32), "bc".repeat(32));

beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});

afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});

type DeliverySnapshot = {
  id: string;
  endpoint_id: string;
  state: string;
  attempts: number;
  available_at: string;
  send_admitted_at: string | null;
  request_deadline_at: string | null;
  completed_at: string | null;
  lease_until: string | null;
  lease_token: string | null;
  last_error: string | null;
};

it("skips ineligible older candidates without changing them and sends the later eligible delivery once", async () => {
  const s = scopeForGuild("989610000000000002");
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status)
    VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH','active')`.execute(db);
  const now = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db)).rows[0]!.now;
  const expiry = new Date(now.getTime() + 120_000);
  const rows = ["expired-safety", "expired-secret", "unverified-current", "eligible"].map((name, index) => ({
    name, endpointId: randomUUID(), eventId: randomUUID(), deliveryId: randomUUID(),
    availableAt: new Date(now.getTime() - 40_000 + index * 1_000),
    createdAt: new Date(now.getTime() - 120_000 + index * 1_000),
  }));

  for (const [index, row] of rows.entries()) {
    await sql`INSERT INTO webhook_endpoints(organization_id,guild_id,id,name,url,event_types,state,actor_hash,
        created_at,revision,delivery_gate,safety_epoch,safety_expires_at,safety_policy_revision)
      VALUES(${s.organizationId}::uuid,${s.guildId},${row.endpointId}::uuid,${row.name},
        ${"https://example.com/synthetic-candidates/" + row.name},ARRAY['coverage.changed'],'ENABLED',${"ac".repeat(32)},
        ${row.createdAt},1,'OPEN',1,${index === 0 ? new Date(now.getTime() - 1_000) : expiry},'fixture-candidate-target')`.execute(db);
    await sql`INSERT INTO webhook_secrets(organization_id,guild_id,endpoint_id,version,secret_ciphertext,valid_until)
      VALUES(${s.organizationId}::uuid,${s.guildId},${row.endpointId}::uuid,1,
        ${vault.seal(s, "synthetic-candidate-signing-key")},${index === 1 ? new Date(now.getTime() - 1_000) : null})`.execute(db);
    // Each event is already expanded. The test concerns candidate admission,
    // and must not accidentally fan one event out to all four endpoints.
    await sql`INSERT INTO operations_domain_events(organization_id,guild_id,id,event_type,dedupe_key,data,created_at,expanded_at)
      VALUES(${s.organizationId}::uuid,${s.guildId},${row.eventId}::uuid,'coverage.changed',${"candidate:" + row.name},
        '{"coverage":"UNKNOWN"}'::jsonb,${now},${now})`.execute(db);
    await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,id,endpoint_id,event_id,secret_version,
        state,attempts,available_at,endpoint_revision,endpoint_safety_epoch)
      VALUES(${s.organizationId}::uuid,${s.guildId},${row.deliveryId}::uuid,${row.endpointId}::uuid,${row.eventId}::uuid,
        1,'PENDING',0,${row.availableAt},1,1)`.execute(db);
  }

  for (const kind of ["GLOBAL", "GUILD"] as const) {
    const key = kind === "GLOBAL" ? "GLOBAL" : operatorControlKey({ scopeKind: kind, scope: s, targetId: null });
    await sql`INSERT INTO alpha16_operator_controls(scope_key,scope_kind,organization_id,guild_id,target_id,state,revision,reason_code,updated_at,expires_at)
      VALUES(${key},${kind},${kind === "GLOBAL" ? null : s.organizationId}::uuid,
        ${kind === "GLOBAL" ? null : s.guildId},NULL,'RUNNING',1,'CONFIG_REVIEW',${now},${expiry})`.execute(db);
  }
  const unverified = rows[2]!, eligible = rows[3]!;
  const verifyCurrentSafety = vi.fn<WebhookDispatchOptions["verifyCurrentSafety"]>(async (_tx, currentScope, endpointId, safetyEpoch) => {
    expect(currentScope).toEqual(s);
    expect(safetyEpoch).toBe("1");
    return endpointId !== unverified.endpointId;
  });
  // Isolated fixture authority only. It is never supplied by an application
  // factory and never enables a real transport or changes operator policy.
  const options: WebhookDispatchOptions = {
    runtime: { purpose: "APPROVED_RUNTIME", approvalRevision: "fixture-candidate-runtime",
      heartbeatMs: 100, leaseMs: 5_000, requestDeadlineMs: 3_000, unknownResolutionMs: 10_000, operationTokenTtlMs: 10_000 },
    dispatchPolicy: { approved: true, policyRevision: "fixture-candidate-target", activationStartedAt: new Date(0),
      targetLiveSafetyMs: 180_000, independentRetentionEnforcementReady: true, targetWritersCompatible: true },
    verifyCurrentSafety,
  };
  const snapshots = async () => (await sql<DeliverySnapshot>`SELECT id,endpoint_id,state,attempts,
      available_at::text,send_admitted_at::text,request_deadline_at::text,completed_at::text,
      lease_until::text,lease_token::text,last_error
    FROM webhook_deliveries WHERE ${tenant(s)} ORDER BY available_at,id`.execute(db)).rows;
  const endpoints = async () => (await sql`SELECT id,state,delivery_gate,safety_epoch::text,
      safety_expires_at::text,safety_policy_revision,revision
    FROM webhook_endpoints WHERE ${tenant(s)} ORDER BY created_at,id`.execute(db)).rows;
  const before = await snapshots(), originalEndpoints = await endpoints();
  expect(before.map(row => row.id)).toEqual(rows.map(row => row.deliveryId));
  const transport = vi.fn(async (url: string, body: string, headers: Record<string, string>) => {
    expect(url).toBe("https://example.com/synthetic-candidates/eligible");
    expect(JSON.parse(body)).toMatchObject({ id: eligible.eventId, type: "coverage.changed" });
    expect(headers["Nexus-Delivery-Id"]).toBe(eligible.deliveryId);
    const durable = (await sql<{ state: string; send_admitted_at: Date | null }>`SELECT state,send_admitted_at
      FROM webhook_deliveries WHERE ${tenant(s)} AND id=${eligible.deliveryId}::uuid`.execute(db)).rows[0]!;
    expect(durable.state).toBe("RUNNING");
    expect(durable.send_admitted_at).not.toBeNull();
    return 204;
  });
  const worker = new WebhookWorker(db, vault, transport, options);

  expect(await worker.tick(s)).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(verifyCurrentSafety.mock.calls.some(call => call[2] === unverified.endpointId)).toBe(true);
  expect(verifyCurrentSafety.mock.calls.some(call => call[2] === eligible.endpointId)).toBe(true);
  const after = await snapshots();
  expect(after).toHaveLength(4);
  expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
  for (const skipped of after.slice(0, 3)) {
    expect(skipped).toMatchObject({ state: "PENDING", attempts: 0, send_admitted_at: null, request_deadline_at: null, completed_at: null });
  }
  expect(after[3]).toMatchObject({ id: eligible.deliveryId, state: "SUCCEEDED", attempts: 1, lease_until: null, lease_token: null, last_error: null });
  expect(after[3]!.send_admitted_at).not.toBeNull();
  expect(after[3]!.request_deadline_at).not.toBeNull();
  expect(after[3]!.completed_at).not.toBeNull();
  expect(await endpoints()).toEqual(originalEndpoints);

  expect(await worker.tick(s)).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await snapshots()).toEqual(after);
  expect(await endpoints()).toEqual(originalEndpoints);
});

it("continues a bounded microsecond candidate scan after the worker is recreated", async () => {
  const s = scopeForGuild("989610000000000003");
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status)
    VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH','active')`.execute(db);
  const clock = (await sql<{ now: Date; available_base: string }>`SELECT clock_timestamp() AS now,
    (date_trunc('millisecond',clock_timestamp())-interval '1 minute')::text AS available_base`.execute(db)).rows[0]!;
  const expiry = new Date(clock.now.getTime() + 120_000);
  const invalidEndpoint = randomUUID(), validEndpoint = randomUUID();
  for (const [index, endpointId] of [invalidEndpoint, validEndpoint].entries()) {
    await sql`INSERT INTO webhook_endpoints(organization_id,guild_id,id,name,url,event_types,state,actor_hash,
        created_at,revision,delivery_gate,safety_epoch,safety_expires_at,safety_policy_revision)
      VALUES(${s.organizationId}::uuid,${s.guildId},${endpointId}::uuid,${index === 0 ? "Unverified prefix" : "Eligible tail"},
        ${"https://example.com/synthetic-scan/" + index},ARRAY['coverage.changed'],'ENABLED',${"ac".repeat(32)},
        ${new Date(clock.now.getTime() - 120_000 + index * 1_000)},1,'OPEN',1,${expiry},'fixture-scan-target')`.execute(db);
    await sql`INSERT INTO webhook_secrets(organization_id,guild_id,endpoint_id,version,secret_ciphertext,valid_until)
      VALUES(${s.organizationId}::uuid,${s.guildId},${endpointId}::uuid,1,
        ${vault.seal(s, "synthetic-scan-signing-key")},NULL)`.execute(db);
  }
  // All 106 queue times fall in the same millisecond. Converting the cursor
  // through a JavaScript Date would restart the rejected 100-row prefix.
  await sql`WITH seed AS MATERIALIZED (
      SELECT n,gen_random_uuid() AS event_id,gen_random_uuid() AS delivery_id FROM generate_series(1,106) AS series(n)
    ), inserted_events AS (
      INSERT INTO operations_domain_events(organization_id,guild_id,id,event_type,dedupe_key,data,created_at,expanded_at)
      SELECT ${s.organizationId}::uuid,${s.guildId},event_id,'coverage.changed','scan:'||n::text,
        '{"coverage":"UNKNOWN"}'::jsonb,${clock.now},${clock.now} FROM seed RETURNING id
    )
    INSERT INTO webhook_deliveries(organization_id,guild_id,id,endpoint_id,event_id,secret_version,
      state,attempts,available_at,endpoint_revision,endpoint_safety_epoch)
    SELECT ${s.organizationId}::uuid,${s.guildId},seed.delivery_id,
      CASE WHEN seed.n<=105 THEN ${invalidEndpoint}::uuid ELSE ${validEndpoint}::uuid END,
      seed.event_id,1,'PENDING',0,${clock.available_base}::timestamptz+seed.n*interval '1 microsecond',1,1
    FROM seed JOIN inserted_events ON inserted_events.id=seed.event_id`.execute(db);
  for (const kind of ["GLOBAL", "GUILD"] as const) {
    const key = kind === "GLOBAL" ? "GLOBAL" : operatorControlKey({ scopeKind: kind, scope: s, targetId: null });
    await sql`INSERT INTO alpha16_operator_controls(scope_key,scope_kind,organization_id,guild_id,target_id,state,revision,reason_code,updated_at,expires_at)
      VALUES(${key},${kind},${kind === "GLOBAL" ? null : s.organizationId}::uuid,
        ${kind === "GLOBAL" ? null : s.guildId},NULL,'RUNNING',1,'CONFIG_REVIEW',${clock.now},${expiry})
      ON CONFLICT(scope_key) DO UPDATE SET state='RUNNING',expires_at=EXCLUDED.expires_at`.execute(db);
  }
  const verifyCurrentSafety = vi.fn<WebhookDispatchOptions["verifyCurrentSafety"]>(async (_tx, currentScope, endpointId, safetyEpoch) => {
    expect(currentScope).toEqual(s);
    expect(safetyEpoch).toBe("1");
    return endpointId === validEndpoint;
  });
  // Same isolated authority/profile for both fresh workers; the scan cursor
  // provides queue progress only and cannot authorize the tail candidate.
  const options: WebhookDispatchOptions = {
    runtime: { purpose: "APPROVED_RUNTIME", approvalRevision: "fixture-scan-runtime",
      heartbeatMs: 100, leaseMs: 5_000, requestDeadlineMs: 3_000, unknownResolutionMs: 10_000, operationTokenTtlMs: 10_000 },
    dispatchPolicy: { approved: true, policyRevision: "fixture-scan-target", activationStartedAt: new Date(0),
      targetLiveSafetyMs: 180_000, independentRetentionEnforcementReady: true, targetWritersCompatible: true },
    verifyCurrentSafety,
  };
  const snapshots = async () => (await sql<DeliverySnapshot>`SELECT id,endpoint_id,state,attempts,
      available_at::text,send_admitted_at::text,request_deadline_at::text,completed_at::text,
      lease_until::text,lease_token::text,last_error
    FROM webhook_deliveries WHERE ${tenant(s)} ORDER BY available_at,id`.execute(db)).rows;
  const endpoints = async () => (await sql`SELECT id,state,delivery_gate,safety_epoch::text,
      safety_expires_at::text,safety_policy_revision,revision
    FROM webhook_endpoints WHERE ${tenant(s)} ORDER BY created_at,id`.execute(db)).rows;
  const before = await snapshots(), originalEndpoints = await endpoints();
  expect(before).toHaveLength(106);
  expect(before.slice(0, 105).every(row => row.endpoint_id === invalidEndpoint)).toBe(true);
  expect(before[105]!.endpoint_id).toBe(validEndpoint);
  expect((await sql<{ span_micros: number }>`SELECT (extract(epoch FROM max(available_at)-min(available_at))*1000000)::int AS span_micros
    FROM webhook_deliveries WHERE ${tenant(s)}`.execute(db)).rows[0]!.span_micros).toBe(105);
  const validDeliveryId = before[105]!.id;
  const transport = vi.fn(async (url: string, _body: string, headers: Record<string, string>) => {
    expect(url).toBe("https://example.com/synthetic-scan/1");
    expect(headers["Nexus-Delivery-Id"]).toBe(validDeliveryId);
    return 204;
  });

  expect(await new WebhookWorker(db, vault, transport, options).tick(s)).toBe(false);
  expect(verifyCurrentSafety).toHaveBeenCalledTimes(100);
  expect(verifyCurrentSafety.mock.calls.every(call => call[2] === invalidEndpoint)).toBe(true);
  expect(transport).not.toHaveBeenCalled();
  expect(await snapshots()).toEqual(before);
  expect(await endpoints()).toEqual(originalEndpoints);

  // Recreating the worker must keep the exact PostgreSQL cursor position.
  expect(await new WebhookWorker(db, vault, transport, options).tick(s)).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(verifyCurrentSafety).toHaveBeenCalledTimes(106);
  expect(verifyCurrentSafety.mock.calls[105]![2]).toBe(validEndpoint);
  const after = await snapshots();
  expect(after.slice(0, 105)).toEqual(before.slice(0, 105));
  expect(after[105]).toMatchObject({ id: validDeliveryId, state: "SUCCEEDED", attempts: 1, lease_until: null, lease_token: null, last_error: null });
  expect(after[105]!.send_admitted_at).not.toBeNull();
  expect(after[105]!.completed_at).not.toBeNull();
  expect(await endpoints()).toEqual(originalEndpoints);

  expect(await new WebhookWorker(db, vault, transport, options).tick(s)).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await snapshots()).toEqual(after);
  expect(await endpoints()).toEqual(originalEndpoints);
}, 30_000);
