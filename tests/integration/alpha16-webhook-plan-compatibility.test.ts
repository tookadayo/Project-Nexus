import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { enforceOperationsPlan } from "../../packages/operations/src/plan-policy";
import { operationsEvent } from "../../packages/operations/src/policy";
import { WebhookWorker } from "../../packages/operations/src/webhooks";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>;

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

it("commits downgrade pauses while preserving admitted webhook uncertainty and original clocks", async () => {
  const s = scopeForGuild("989610000000000001");
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status)
    VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH','active')`.execute(db);

  const endpointId = randomUUID(), credentialId = randomUUID();
  const admittedId = randomUUID(), pendingId = randomUUID();
  const actorHash = "ac".repeat(32);
  // Inert records exercise storage compatibility. No credentials are issued,
  // no dispatch/runtime profile is adopted, and no provider is constructed.
  await sql`INSERT INTO api_credentials(organization_id,guild_id,id,prefix,token_hash,name,scopes,kind,state,actor_hash)
    VALUES(${s.organizationId}::uuid,${s.guildId},${credentialId}::uuid,
      ${"synthetic-plan-" + credentialId},${"cd".repeat(32)},'Synthetic reader',ARRAY['guild:read'],'PERSONAL','ENABLED',${actorHash})`.execute(db);
  await sql`INSERT INTO webhook_endpoints(organization_id,guild_id,id,name,url,event_types,state,actor_hash)
    VALUES(${s.organizationId}::uuid,${s.guildId},${endpointId}::uuid,'Synthetic endpoint',
      'https://example.com/synthetic-plan-fixture',ARRAY['coverage.changed'],'ENABLED',${actorHash})`.execute(db);
  await sql`INSERT INTO webhook_secrets(organization_id,guild_id,endpoint_id,version,secret_ciphertext)
    VALUES(${s.organizationId}::uuid,${s.guildId},${endpointId}::uuid,1,'synthetic-unused-ciphertext')`.execute(db);

  const eventIds = await db.transaction().execute(async tx => [
    await operationsEvent(tx, s, "coverage.changed", "plan-admitted", { coverage: "UNKNOWN" }),
    await operationsEvent(tx, s, "coverage.changed", "plan-pending", { coverage: "UNKNOWN" }),
  ]);
  const now = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db)).rows[0]!.now;
  const admittedAt = new Date(now.getTime() - 1_000);
  const availableAt = new Date(now.getTime() - 2_000);
  const deadline = new Date(now.getTime() + 30_000);
  await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,id,endpoint_id,event_id,secret_version,
      state,attempts,available_at,endpoint_revision,endpoint_safety_epoch,send_admitted_at,request_deadline_at,lease_until,lease_token)
    VALUES(${s.organizationId}::uuid,${s.guildId},${admittedId}::uuid,${endpointId}::uuid,${eventIds[0]}::uuid,1,
      'RUNNING',1,${availableAt},1,1,${admittedAt},${deadline},${new Date(now.getTime() + 60_000)},${randomUUID()}::uuid),
      (${s.organizationId}::uuid,${s.guildId},${pendingId}::uuid,${endpointId}::uuid,${eventIds[1]}::uuid,1,
      'PENDING',0,${availableAt},1,1,NULL,NULL,NULL,NULL)`.execute(db);

  expect((await enforceOperationsPlan(db, s)).plan).toBe("GROWTH");
  const snapshots = async () => (await sql<DeliverySnapshot>`SELECT id,state,attempts,
      available_at::text,send_admitted_at::text,request_deadline_at::text,completed_at::text,
      lease_until::text,lease_token::text,last_error
    FROM webhook_deliveries WHERE ${tenant(s)} ORDER BY id`.execute(db)).rows;
  const before = await snapshots();
  expect(before.find(row => row.id === admittedId)).toMatchObject({ state: "RUNNING", attempts: 1 });
  expect(before.find(row => row.id === pendingId)).toMatchObject({ state: "PENDING", attempts: 0 });
  expect((await sql<{ state: string }>`SELECT state FROM api_credentials WHERE ${tenant(s)} AND id=${credentialId}::uuid`.execute(db)).rows[0]!.state).toBe("ENABLED");
  const initialHead = (await sql<{ fingerprint: string }>`SELECT fingerprint FROM operations_plan_heads WHERE ${tenant(s)}`.execute(db)).rows[0]!.fingerprint;

  await sql`UPDATE guild_subscriptions SET plan_key='STARTER' WHERE ${tenant(s)}`.execute(db);
  await expect(enforceOperationsPlan(db, s)).resolves.toMatchObject({ plan: "STARTER" });

  const after = await snapshots();
  expect(after).toHaveLength(2);
  const admitted = after.find(row => row.id === admittedId)!;
  const pending = after.find(row => row.id === pendingId)!;
  const originalAdmission = before.find(row => row.id === admittedId)!;
  expect(admitted).toMatchObject({
    state: "UNKNOWN",
    attempts: 1,
    available_at: originalAdmission.available_at,
    send_admitted_at: originalAdmission.send_admitted_at,
    request_deadline_at: originalAdmission.request_deadline_at,
    lease_until: null,
    lease_token: null,
    last_error: "PLAN_UNAVAILABLE_RESULT_UNKNOWN",
  });
  expect(admitted.completed_at).not.toBeNull();
  expect(pending).toMatchObject({
    state: "PAUSED_PLAN_LIMIT",
    attempts: 0,
    available_at: before.find(row => row.id === pendingId)!.available_at,
    send_admitted_at: null,
    request_deadline_at: null,
    completed_at: null,
    lease_until: null,
    lease_token: null,
  });
  expect((await sql<{ state: string; delivery_gate: string; safety_epoch: string }>`SELECT state,delivery_gate,safety_epoch::text
    FROM webhook_endpoints WHERE ${tenant(s)} AND id=${endpointId}::uuid`.execute(db)).rows[0]).toEqual({
    state: "PAUSED_PLAN_LIMIT", delivery_gate: "UNKNOWN_BLOCKED", safety_epoch: "2",
  });
  // This earlier, unrelated feature pause used to roll back when the webhook
  // monotonicity trigger rejected RUNNING -> PAUSED_PLAN_LIMIT.
  expect((await sql<{ state: string }>`SELECT state FROM api_credentials WHERE ${tenant(s)} AND id=${credentialId}::uuid`.execute(db)).rows[0]!.state).toBe("PAUSED_PLAN_LIMIT");
  expect((await sql<{ fingerprint: string }>`SELECT fingerprint FROM operations_plan_heads WHERE ${tenant(s)}`.execute(db)).rows[0]!.fingerprint).not.toBe(initialHead);

  for (const state of ["PENDING", "PAUSED_PLAN_LIMIT"]) {
    await expect(sql`UPDATE webhook_deliveries SET state=${state} WHERE ${tenant(s)} AND id=${admittedId}::uuid`.execute(db))
      .rejects.toThrow(/WEBHOOK_(RESULT_UNKNOWN|ADMITTED_RESET_FORBIDDEN)/);
  }
  await enforceOperationsPlan(db, s);
  expect(await snapshots()).toEqual(after);

  const transport = vi.fn(async () => 200);
  const vault = new IdentityVault("ab".repeat(32), "bc".repeat(32));
  expect(await new WebhookWorker(db, vault, transport).tick(s)).toBe(false);
  expect(transport).not.toHaveBeenCalled();
  expect(await snapshots()).toEqual(after);
});
