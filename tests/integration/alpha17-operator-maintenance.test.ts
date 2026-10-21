import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolatedPostgres } from "../fixtures/postgres";
import { connect, migrate, sql, type Database } from "../../packages/db/src/index";
import { Alpha16Operator } from "../../packages/security/src/alpha16-operator";
import type { OperatorAuth } from "../../packages/security/src/operator-auth";

// A new isolated synthetic cluster only. Never reads DATABASE_URL, credentials,
// production policy or existing data; no production migration is performed.
let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database;
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
it("alpha17 bounds TTL cleanup without cascading beyond the budget or processing privacy evidence", async () => {
  const session = "a".repeat(64), epoch = randomUUID(), expired = randomUUID(), fresh = randomUUID();
  const receiptId = randomUUID();
  await sql`INSERT INTO operator_sessions(digest,credential_epoch,csrf_digest,expires_at)
    VALUES(${session},${epoch}::uuid,${"b".repeat(64)},clock_timestamp()+interval '1 hour')`.execute(db);
  for (const [id, lifetime] of [[expired, -3600], [fresh, 3600]] as const)
    await sql`INSERT INTO alpha16_operator_previews(id,session_digest,command_kind,fingerprint,preview_hash,typed_payload,policy_revision,created_at,expires_at)
      VALUES(${id}::uuid,${session},'CONTROL',${"c".repeat(64)},${"d".repeat(64)},'{}'::jsonb,'fixture-only',clock_timestamp()-interval '2 hours',clock_timestamp()+make_interval(secs=>${lifetime}))`.execute(db);
  for (let index = 1; index <= 3; index++) {
    await sql`INSERT INTO alpha16_operator_stepups(token_hash,preview_id,session_digest,credential_epoch,preview_hash,created_at,expires_at)
      VALUES(${String(index).padStart(64, "0")},${expired}::uuid,${session},${epoch}::uuid,${"d".repeat(64)},clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`.execute(db);
    await sql`INSERT INTO operator_audit(id,request_id,action,result,reason,retention_class,expires_at)
      VALUES(${randomUUID()}::uuid,${randomUUID()}::uuid,'FIXTURE','SUCCEEDED','','ALPHA16',clock_timestamp()-interval '1 hour')`.execute(db);
  }
  await sql`INSERT INTO alpha16_operator_commands(idempotency_hash,session_digest,fingerprint,preview_id,operation_id,created_at,expires_at)
    VALUES(${"e".repeat(64)},${session},${"c".repeat(64)},${expired}::uuid,${randomUUID()}::uuid,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`.execute(db);
  await sql`INSERT INTO alpha16_operator_challenges(id,preview_id,session_digest,challenge_hash,created_at,expires_at)
    VALUES(${randomUUID()}::uuid,${expired}::uuid,${session},${"f".repeat(64)},clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`.execute(db);
  await sql`INSERT INTO alpha16_operator_controls(scope_key,scope_kind,state,revision,reason_code,expires_at)
    VALUES('GLOBAL','GLOBAL','STOPPED',1,'OPERATOR_REQUEST',clock_timestamp()-interval '1 hour')`.execute(db);
  await sql`INSERT INTO alpha16_deletion_receipts(id,secret_hash,scope_hash,issued_at,expires_at)
    VALUES(${receiptId}::uuid,${"1".repeat(64)},${"2".repeat(64)},clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`.execute(db);
  await sql`INSERT INTO operator_audit(id,request_id,action,result,reason)
    VALUES(${randomUUID()}::uuid,${randomUUID()}::uuid,'LEGACY_FIXTURE','SUCCEEDED','')`.execute(db);
  const operator = new Alpha16Operator(db, {} as OperatorAuth);
  expect(await operator.purgeOperatorEphemeral(1)).toEqual({ ready: false });
  // FK cascade cannot erase the two child rows left outside this pass's budget.
  expect((await sql`SELECT token_hash FROM alpha16_operator_stepups WHERE preview_id=${expired}::uuid`.execute(db)).rows).toHaveLength(2);
  expect((await sql`SELECT id FROM alpha16_operator_previews WHERE id=${expired}::uuid`.execute(db)).rows).toHaveLength(1);
  expect((await sql`SELECT id FROM operator_audit WHERE retention_class='ALPHA16'`.execute(db)).rows).toHaveLength(2);
  expect(await operator.purgeOperatorEphemeral(1)).toEqual({ ready: false });
  expect(await operator.purgeOperatorEphemeral(1)).toEqual({ ready: true });
  expect((await sql`SELECT id FROM alpha16_operator_previews`.execute(db)).rows).toEqual([{ id: fresh }]);
  expect((await sql`SELECT id FROM alpha16_deletion_receipts WHERE id=${receiptId}::uuid`.execute(db)).rows).toHaveLength(1);
  expect((await sql`SELECT id FROM operator_audit WHERE retention_class IS NULL`.execute(db)).rows).toHaveLength(1);
});
it("rejects an unapproved or excessive batch before any database work", async () => {
  const operator = new Alpha16Operator({} as Database, {} as OperatorAuth);
  for (const batch of [0, -1, 1001, 1.5, NaN])
    await expect(operator.purgeOperatorEphemeral(batch)).rejects.toThrow("MAINTENANCE_BATCH_POLICY_REQUIRED");
});

it("alpha17 legacy reads enforce current explicit grants and guild projections without mutation policy", async () => {
  const { BetaOperator } = await import("../../packages/security/src/beta-operator");
  const { createOperatorServer } = await import("../../apps/operator/src/server");
  const guildA = "985170000000000001", guildB = "985170000000000002";
  const beta = new BetaOperator(db, async (id) => ({ name: id, present: true, canObserve: true, checkedAt: Date.now() }));
  for (const guildId of [guildA, guildB])
    await beta.change({ guildId, action: "register", generation: null, requestId: randomUUID(), reason: "synthetic-alpha17-read-scope" });
  for (const [guildId, marker] of [[guildA, "A17_ALLOWED_A"], [guildB, "A17_PRIVATE_B"], [null, "A17_PRIVATE_GLOBAL"]] as const)
    await sql`INSERT INTO operator_audit(id,request_id,action,guild_id,result,reason)
      VALUES(${randomUUID()}::uuid,${randomUUID()}::uuid,'FIXTURE_READ',${guildId},'SUCCEEDED',${marker})`.execute(db);
  const grant: import("../../packages/security/src/alpha16-operator").OperatorGrant = {
    permissions: [], guildIds: [], global: false,
  };
  const auth = { read: async () => ({ csrf: "synthetic-read-csrf" }) } as unknown as OperatorAuth;
  const app = createOperatorServer(db, auth, beta, "http://127.0.0.1:3210", {
    alpha16: { grant: async () => grant },
    readLegalCandidate: async () => "# Synthetic candidate only",
    readConfirmedLegalContacts: async () => ({}) as never,
  });
  const headers = { host: "127.0.0.1:3210", cookie: "nexus_operator=" + "x".repeat(43) };
  try {
    const routes = [
      "/operator/guilds", "/operator/guilds/" + guildA, "/operator/overview", "/operator/audit",
      "/operator/sessions", "/operator/publications", "/operator/publications/" + randomUUID(),
      "/operator/publications/" + randomUUID() + "/preview?revision=1",
      "/operator/legal", "/operator/legal/terms/ja?revision=1",
    ];
    for (const url of routes) {
      const response = await app.inject({ url, headers });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "PERMISSION_DENIED" });
    }
    grant.permissions = ["OPERATOR_ADMISSION_READ", "OPERATOR_AUDIT_READ", "OPERATOR_STATUS_READ",
      "OPERATOR_CONFIG_READ", "OPERATOR_PUBLICATION_READ", "OPERATOR_LEGAL_READ"];
    grant.guildIds = [guildA];
    const list = await app.inject({ url: "/operator/guilds", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().guilds.map((row: { guild_id: string }) => row.guild_id)).toEqual([guildA]);
    expect((await app.inject({ url: "/operator/guilds/" + guildA, headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/operator/guilds/" + guildB, headers })).statusCode).toBe(422);
    const audit = await app.inject({ url: "/operator/audit", headers });
    expect(audit.statusCode).toBe(200);
    expect(audit.body).toContain("A17_ALLOWED_A");
    expect(audit.body).not.toContain("A17_PRIVATE_B");
    expect(audit.body).not.toContain("A17_PRIVATE_GLOBAL");
    for (const url of ["/operator/overview", "/operator/sessions", "/operator/publications", "/operator/legal"])
      expect((await app.inject({ url, headers })).statusCode).toBe(403);
    grant.global = true;
    for (const url of ["/operator/overview", "/operator/sessions", "/operator/publications", "/operator/legal"]) {
      const response = await app.inject({ url, headers });
      expect(response.statusCode).toBe(200);
    }
    // READ-only options have no retention/step-up mutation policy or grants.
    const write = await app.inject({ method: "POST", url: "/operator/guilds",
      headers: { ...headers, origin: "http://127.0.0.1:3210" }, payload: {} });
    expect(write.statusCode).toBe(428);
    // Revoking the current grant immediately also closes the old route.
    grant.permissions = [];
    expect((await app.inject({ url: "/operator/guilds", headers })).statusCode).toBe(403);
  } finally {
    await app.close();
  }
});

it("rechecks local enforcement after a scope-lock wait without consuming proof or mutating the guild", async () => {
  const { BetaOperator } = await import("../../packages/security/src/beta-operator");
  const { operatorDigest } = await import("../../packages/security/src/operator-auth");
  const { acquireRuleScopeLocks } = await import("../../packages/rules/src/locks");
  const guildId = "985170000000000003", epoch = randomUUID(), sessionValue = "z".repeat(43);
  const session = operatorDigest(sessionValue), key = randomUUID();
  await sql`INSERT INTO operator_sessions(digest,credential_epoch,csrf_digest,expires_at)
    VALUES(${session},${epoch}::uuid,${"b".repeat(64)},clock_timestamp()+interval '1 hour')`.execute(db);
  const beta = new BetaOperator(db, async (id) => ({ name: id, present: true, canObserve: true, checkedAt: Date.now() }));
  const registered = await beta.change({ guildId, action: "register", generation: null, requestId: randomUUID(), reason: "synthetic-lease-fixture" });
  const policy: import("../../packages/security/src/alpha16-operator").Alpha16OperatorPolicy = {
    revision: "fixture-lease-only",
    retention: ["OPERATOR_PREVIEW", "OPERATOR_STEP_UP", "AUDIT"].map((kind) => ({
      class: kind as "OPERATOR_PREVIEW" | "OPERATOR_STEP_UP" | "AUDIT",
      revision: "fixture-only-ttl", approved: true, enforcementVerified: true, durationMs: 60000,
    })),
    previewMs: 30000, stepUpMs: 10000, challengeMs: 10000,
  };
  let current = true;
  const operator = new Alpha16Operator(db, {
    reauthenticate: async () => ({ credentialEpoch: epoch }),
  } as unknown as OperatorAuth, {
    policy: async () => current ? policy : { ...policy, retention: [] },
    grant: async () => ({ permissions: ["OPERATOR_ADMISSION_MANAGE"], guildIds: [guildId], global: false }),
    beta,
  });
  const preview = await operator.previewAdmission(session, {
    guildId, action: "activate", generation: registered.generation, requestId: randomUUID(), reason: "OPERATOR_REQUEST",
  });
  const challenge = await operator.challenge(session, preview.previewId);
  const proof = await operator.reauthenticate(sessionValue, "synthetic-csrf", {
    challengeId: challenge.challengeId, challenge: challenge.challenge, password: "synthetic-factor-only",
  });
  let acquired!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => { acquired = resolve; });
  const unlock = new Promise<void>((resolve) => { release = resolve; });
  const holder = db.transaction().execute(async (tx) => {
    await acquireRuleScopeLocks(tx, [{ kind: "GLOBAL", mode: "exclusive" }]);
    acquired();
    await unlock;
  });
  await locked;
  const confirmation = operator.confirm(session, {
    previewId: preview.previewId, previewHash: preview.previewHash, stepUpToken: proof.stepUpToken, confirmation: true,
  }, key, "ADMISSION", guildId);
  // Attach the rejection observer before releasing the lock.
  const rejected = expect(confirmation).rejects.toThrow("OPERATOR_POLICY_REQUIRED");
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
      waiting = (await sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted LIMIT 1`.execute(db)).rows.length > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    current = false;
  } finally {
    release();
  }
  await holder;
  await rejected;
  const invitation = (await sql<{ status: string; generation: number }>`SELECT status,generation FROM beta_guild_invitations WHERE guild_id=${guildId}`.execute(db)).rows[0];
  expect(invitation).toMatchObject({ status: "REGISTERED", generation: registered.generation });
  expect((await sql<{ consumed_at: Date | null }>`SELECT consumed_at FROM alpha16_operator_previews WHERE id=${preview.previewId}::uuid`.execute(db)).rows[0]?.consumed_at).toBeNull();
  expect((await sql<{ consumed_at: Date | null }>`SELECT consumed_at FROM alpha16_operator_stepups WHERE preview_id=${preview.previewId}::uuid`.execute(db)).rows[0]?.consumed_at).toBeNull();
  expect((await sql`SELECT operation_id FROM alpha16_operator_commands WHERE preview_id=${preview.previewId}::uuid`.execute(db)).rows).toHaveLength(0);
});
