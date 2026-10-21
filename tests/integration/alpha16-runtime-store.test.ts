import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect, ensureGuild, json, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { operatorControlKey } from "../../packages/security/src/alpha16-operator";
import { RuleOperationStore, purgeRuleRuntimeGuild, purgeExpiredRuleRuntime, sweepRuleRuntimeRetention, type RuleRuntimeAuthority } from "../../packages/rules/src/runtime-store";
import { isolatedPostgres } from "../fixtures/postgres";
import {IndependentSafetyAuthority,type IndependentSafetyEvidence} from '../../packages/security/src/alpha16-safety-state';
import {fingerprint} from '../../packages/automation/src/store';
import {sweepAutomationRetention} from '../../packages/automation/src/retention';

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
type SyntheticTarget=Extract<IndependentSafetyEvidence,{kind:'TARGET_LIVE_SAFETY'}>['targets'][number];
const independentScopes=new Map<string,{generation:number;targets:Map<string,SyntheticTarget>}>();
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });

async function fixture(existingScope?: { organizationId: string; guildId: string }) {
  ++serial;
  const scope = existingScope ?? scopeForGuild(String(887600000000000000n + BigInt(serial)));
  await ensureGuild(db, scope);
  const clock = { now: new Date("2026-10-16T12:00:00.000Z") };
  const expiry = new Date(clock.now.getTime() + 3_600_000), suggestionId = randomUUID(), targetId = "flow-" + serial;
  const draftId = "draft-" + targetId, revisionId = "revision-" + targetId;
  const independentKey=scope.organizationId+':'+scope.guildId,independent=independentScopes.get(independentKey)??{generation:0,targets:new Map<string,SyntheticTarget>()};
  independentScopes.set(independentKey,independent);independent.generation++;
  independent.targets.set(targetId,{targetType:'AUTOMATION_FLOW',targetId,liveVersion:'1',safetyEpoch:'4',stateVersion:'1',applyGate:'OPEN',expiresAt:expiry.toISOString()});
  const generation=()=>`fixture-${independent.generation}`;
  const evidence=()=>({kind:'TARGET_LIVE_SAFETY' as const,scope,generation:generation(),observedAt:clock.now.toISOString(),expiresAt:new Date(Math.min(...[...independent.targets.values()].map(target=>Date.parse(target.expiresAt)))).toISOString(),policyRevision:'fixture-target',independent:true as const,complete:true as const,targets:[...independent.targets.values()].map(target=>({...target}))});
  const safetyAuthority=new IndependentSafetyAuthority(()=>[{class:'TARGET_LIVE_SAFETY',revision:'fixture-target',approved:true,durationMs:3_600_000,enforcementVerified:true}],async(kind,currentScope)=>{
    expect(kind).toBe('TARGET_LIVE_SAFETY');expect(currentScope).toEqual(scope);return evidence();
  },()=>clock.now,async input=>{
    expect(input.scope).toEqual(scope);expect(input.expectedGeneration).toBe(generation());
    const previous=independent.targets.get(input.target.targetId)!;expect(fingerprint(previous)).toBe(fingerprint(input.target));expect(previous.applyGate).toBe('OPEN');
    independent.targets.set(previous.targetId,{...previous,applyGate:'UNKNOWN_BLOCKED',safetyEpoch:String(BigInt(previous.safetyEpoch)+1n),stateVersion:String(BigInt(previous.stateVersion)+1n)});
    independent.generation++;return evidence();
  });
  const authority: RuleRuntimeAuthority = { authorized: true, tombstoned: false, approvalCurrent: true,
    inputEvidenceCurrent: true, latestTargetStateVerified: true, writerCompatibilityVerified: true };
  const store = new RuleOperationStore(db, {
    // Synthetic profile scoped to the isolated database fixture. This is not
    // read by the app, operator, production registry or environment loader.
    activation: { runtimeProfile: { purpose: "APPROVED_RUNTIME", approvalRevision: "fixture-runtime",
      heartbeatMs: 100, leaseMs: 500, requestDeadlineMs: 300, unknownResolutionMs: 2_000, operationTokenTtlMs: 5_000 },
    targetSafetyRetentionApproved: true, runLifecycleRetentionBounded: true, independentRetentionEnforcementReady: true,
    targetWritersCompatible: true, workerContractCompatible: true },
    targetPolicyRevision: "fixture-target",safetyAuthority, operationRetention: { approved: true, revision: "fixture-operation", milliseconds: 60_000 },
    recheck: async () => ({ ...authority }), now: () => clock.now,
  });
  for (const kind of ["GLOBAL", "GUILD", "FLOW"] as const) {
    const key = kind === "GLOBAL" ? "GLOBAL" : operatorControlKey({ scopeKind: kind, scope, targetId: kind === "FLOW" ? targetId : null });
    await sql`INSERT INTO alpha16_operator_controls(scope_key,scope_kind,organization_id,guild_id,target_id,state,revision,reason_code,updated_at,expires_at)
      VALUES(${key},${kind},${kind === "GLOBAL" ? null : scope.organizationId}::uuid,${kind === "GLOBAL" ? null : scope.guildId},${kind === "FLOW" ? targetId : null},'RUNNING',1,'CONFIG_REVIEW',${clock.now},${expiry})
      ON CONFLICT(scope_key) DO NOTHING`.execute(db);
  }
  await sql`INSERT INTO rule_target_safety(organization_id,guild_id,target_type,target_id,live_version,safety_epoch,apply_gate,expires_at,policy_revision,verified_generation,verified_at)
    VALUES(${scope.organizationId}::uuid,${scope.guildId},'AUTOMATION_FLOW',${targetId},'1',4,'OPEN',${expiry},'fixture-target',${generation()},${clock.now})`.execute(db);
  // Fixture-only initial reconciliation of this independent complete scope.
  await sql`UPDATE rule_target_safety SET verified_generation=${generation()},verified_at=${clock.now} WHERE ${tenant(scope)}`.execute(db);
  await sql`INSERT INTO rule_suggestions(organization_id,guild_id,id,target_type,target_id,live_version,evaluation_ref_hash,evaluation_as_of,rule_id,versions,window_start,window_end,issue_code,dedupe_key,lineage_key,action_id,action_mode,action_payload,explanation,state,audience,last_observed_at,actionable_until,history_expires_at)
    VALUES(${scope.organizationId}::uuid,${scope.guildId},${suggestionId}::uuid,'AUTOMATION_FLOW',${targetId},'1',${"a".repeat(64)},${clock.now},'FIXTURE-001',${json({})},${new Date(clock.now.getTime() - 3_600_000)},${clock.now},'FIXTURE',${randomUUID()},${"b".repeat(64)},'FIXTURE_ACTION','CREATE_DRAFT',${json({})},${json({})},'ACTIVE','GUILD',${clock.now},${expiry},${expiry})`.execute(db);
  await sql`INSERT INTO rule_suggestion_draft_links(organization_id,guild_id,suggestion_id,draft_id,immutable_revision_id,content_hash,base_live_version,suggestion_version,expires_at)
    VALUES(${scope.organizationId}::uuid,${scope.guildId},${suggestionId}::uuid,${draftId},${revisionId},${"c".repeat(64)},'1',1,${expiry})`.execute(db);
  const request = { binding: { ...scope, targetType: "AUTOMATION_FLOW", targetId, liveVersion: "1", action: "FIXTURE_ACTION",
    suggestionId, suggestionVersion: "1", draftId, immutableDraftRevisionId: revisionId, draftContentHash: "c".repeat(64), approvalId: "fixture-approval", safetyEpoch: "4" },
    actorHash: "d".repeat(64), idempotencyKey: "fixture-request-" + targetId, requestBody: { draft: "revision" }, effectDescriptorHash: "e".repeat(64) };
  return { scope, clock, store, request, authority, targetId, suggestionId };
}

it("RT02/08 reserves intent, guard and outbox atomically, with same-key replay and cross-key dedupe", async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.store.reserve(f.scope, f.request), f.store.reserve(f.scope, f.request)]);
  expect(first.intentId).toBe(second.intentId);
  expect([first.replay, second.replay].sort()).toEqual([false, true]);
  for (const table of ["rule_runtime_intents", "rule_apply_reservations", "rule_runtime_outbox"])
    expect((await sql`SELECT 1 FROM ${sql.table(table)} WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
  await expect(f.store.reserve(f.scope, { ...f.request, idempotencyKey: "different-key" })).rejects.toThrow("APPLY_ALREADY_RESERVED");
  await expect(f.store.reserve(f.scope, { ...f.request, requestBody: { draft: "changed" } })).rejects.toThrow("IDEMPOTENCY_BODY_MISMATCH");
});

it("RT03 rejects an expired old fence after a pre-admission reclaim", async () => {
  const f = await fixture(), reserved = await f.store.reserve(f.scope, f.request);
  const old = await f.store.claim(f.scope, reserved.intentId, "worker-old");
  f.clock.now = new Date(f.clock.now.getTime() + 501);
  expect((await f.store.recover(f.scope, reserved.intentId)).queue).toBe("ENQUEUE_REFERENCE");
  const current = await f.store.claim(f.scope, reserved.intentId, "worker-new");
  expect(BigInt(current.fenceToken)).toBeGreaterThan(BigInt(old.fenceToken));
  await expect(f.store.admit(f.scope, old)).rejects.toThrow("RULE_STALE_WORKER");
  await expect(f.store.admit(f.scope, current)).resolves.toMatchObject({ intentId: reserved.intentId });
});

it("RT04/05 admission crash stays UNKNOWN and never reconstructs a send job", async () => {
  const f = await fixture(), reserved = await f.store.reserve(f.scope, f.request);
  const claim = await f.store.claim(f.scope, reserved.intentId, "worker");
  await f.store.admit(f.scope, claim);
  expect((await f.store.recover(f.scope, reserved.intentId)).queue).toBe("READ_ONLY_RECONCILE");
  expect((await sql<{ apply_gate: string }>`SELECT apply_gate FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.apply_gate).toBe("UNKNOWN_BLOCKED");
  await expect(f.store.claim(f.scope, reserved.intentId, "worker-retry")).rejects.toThrow("RULE_INTENT_NOT_CLAIMABLE");
  expect((await f.store.cancel(f.scope, reserved.intentId)).externalCancellationConfirmed).toBe(false);
  f.clock.now = new Date(f.clock.now.getTime() + 2_001);
  await f.store.recover(f.scope, reserved.intentId);
  const terminal = (await sql<{ state: string; terminal_at: Date }>`SELECT state,terminal_at FROM rule_runtime_intents WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!;
  expect(terminal.state).toBe("RESULT_UNKNOWN");
  expect(terminal.terminal_at).toEqual(f.clock.now);
  f.clock.now = new Date(f.clock.now.getTime() + 100);
  await f.store.recover(f.scope, reserved.intentId);
  expect((await sql<{ terminal_at: Date }>`SELECT terminal_at FROM rule_runtime_intents WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.terminal_at).toEqual(terminal.terminal_at);
});

it("RET05/VI-F06 lifecycle purge cannot reopen target root or retain child payload", async () => {
  const f = await fixture(), reserved = await f.store.reserve(f.scope, f.request);
  const claim = await f.store.claim(f.scope, reserved.intentId, "worker");
  await f.store.admit(f.scope, claim);
  await f.store.finish(f.scope, claim, "UNKNOWN");
  await db.transaction().execute(tx => purgeRuleRuntimeGuild(tx, f.scope));
  for (const table of ["rule_runtime_intents", "rule_runtime_attempts", "rule_runtime_leases", "rule_runtime_request_keys", "rule_runtime_outbox", "rule_apply_reservations"])
    expect((await sql`SELECT 1 FROM ${sql.table(table)} WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  const target = (await sql<{ apply_gate: string }>`SELECT apply_gate FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!;
  expect(target.apply_gate).toBe("UNKNOWN_BLOCKED");
  expect((await sql<{ state: string }>`SELECT state FROM rule_suggestions WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.state).toBe("INVALIDATED");
});

it("RT02 read-only authoritative reconcile resolves evidence without reopening root", async () => {
  const f = await fixture(), reserved = await f.store.reserve(f.scope, f.request);
  const claim = await f.store.claim(f.scope, reserved.intentId, "worker");
  await f.store.admit(f.scope, claim); await f.store.finish(f.scope, claim, "UNKNOWN");
  expect((await f.store.reconcile(f.scope, reserved.intentId, { mode: "READ_ONLY", operationDescriptorHash: "e".repeat(64), authoritative: false, result: "CONFIRMED_SUCCESS" })).result).toBe("UNKNOWN");
  expect((await f.store.reconcile(f.scope, reserved.intentId, { mode: "READ_ONLY", operationDescriptorHash: "e".repeat(64), authoritative: true, result: "CONFIRMED_SUCCESS" })).result).toBe("CONFIRMED_SUCCESS");
  expect((await sql<{ state: string }>`SELECT state FROM rule_suggestions WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.state).toBe("CONSUMED");
  expect((await sql<{ apply_gate: string }>`SELECT apply_gate FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.apply_gate).toBe("UNKNOWN_BLOCKED");
});

it("RET02 expiry physically cascades the operation, token hashes and queue references", async () => {
  const f = await fixture(), reserved = await f.store.reserve(f.scope, f.request);
  await f.store.claim(f.scope, reserved.intentId, "worker");
  f.clock.now = new Date(f.clock.now.getTime() + 60_000);
  expect((await sweepRuleRuntimeRetention(db, f.clock.now)).deletedIntents).toBeGreaterThanOrEqual(1);
  expect((await sql`SELECT id FROM rule_runtime_intents WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT intent_id FROM rule_runtime_request_keys WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
});

it("RET01/05 same-transaction expiry purges only expired IDs before source/link removal", async () => {
  const first = await fixture(), firstRun = await first.store.reserve(first.scope, first.request);
  const sibling = await fixture(first.scope);
  sibling.clock.now = new Date(sibling.clock.now.getTime() + 30_000);
  const siblingRun = await sibling.store.reserve(sibling.scope, sibling.request);
  const due = new Date(first.clock.now.getTime() + 60_000);
  expect(await db.transaction().execute(tx => purgeExpiredRuleRuntime(tx, first.scope, due))).toEqual({ deletedIntents: 1 });
  const remaining = (await sql<{ id: string }>`SELECT id FROM rule_runtime_intents WHERE ${tenant(first.scope)}`.execute(db)).rows;
  expect(remaining.map(row => row.id)).toEqual([siblingRun.intentId]);
  expect(remaining.some(row => row.id === firstRun.intentId)).toBe(false);
  expect((await sql`SELECT operation_id FROM rule_apply_reservations WHERE ${tenant(first.scope)} AND operation_id=${siblingRun.intentId}::uuid`.execute(db)).rows).toHaveLength(1);
});

it("RET05 rejects legacy parent Run cascade until canonical runtime purge fences the target", async () => {
  const f = await fixture(), runId = randomUUID();
  await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,draft_revision) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${f.targetId},'Synthetic runtime parent',1)`.execute(db);
  await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${f.targetId},1,${json({})},${"f".repeat(64)},true)`.execute(db);
  await sql`INSERT INTO automation_runs(organization_id,guild_id,id,flow_id,revision,semantic_hash,dedupe_key,input_hash,actor_hash,actor_ciphertext,status,usage_month,started_at,deadline_at,resume)
    VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${runId}::uuid,${f.targetId},1,${"f".repeat(64)},${randomUUID()},${"a".repeat(64)},${f.request.actorHash},'synthetic-ciphertext','RUNNING','2026-10-01',${f.clock.now},${new Date(f.clock.now.getTime() + 3_600_000)},${json({})})`.execute(db);
  const reserved = await f.store.reserve(f.scope, { ...f.request, runId });
  const claim = await f.store.claim(f.scope, reserved.intentId, "fixture-worker");
  await f.store.admit(f.scope, claim);
  await expect(sql`DELETE FROM automation_runs WHERE ${tenant(f.scope)} AND id=${runId}::uuid`.execute(db)).rejects.toThrow("RULE_RUNTIME_PURGE_REQUIRED");
  expect((await sql`SELECT id FROM rule_runtime_intents WHERE ${tenant(f.scope)} AND id=${reserved.intentId}::uuid`.execute(db)).rows).toHaveLength(1);
  await db.transaction().execute(async tx => {
    await purgeRuleRuntimeGuild(tx, f.scope);
    await sql`DELETE FROM automation_runs WHERE ${tenant(f.scope)} AND id=${runId}::uuid`.execute(tx);
  });
  expect((await sql<{ apply_gate: string }>`SELECT apply_gate FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.apply_gate).toBe("UNKNOWN_BLOCKED");
});

it('RET06 native retention purges admitted runtime children before deleting their terminal parent',async()=>{
  const f=await fixture(),runId=randomUUID();
  await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,draft_revision) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${f.targetId},'Retention fixture',1)`.execute(db);
  await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${f.targetId},1,${json({})},${'f'.repeat(64)},true)`.execute(db);
  await sql`INSERT INTO automation_runs(organization_id,guild_id,id,flow_id,revision,semantic_hash,dedupe_key,input_hash,actor_hash,actor_ciphertext,status,usage_month,started_at,deadline_at,resume)
    VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${runId}::uuid,${f.targetId},1,${'f'.repeat(64)},${randomUUID()},'fixture-input',${f.request.actorHash},'fixture-ciphertext','RUNNING','2026-10-01',${f.clock.now},${new Date(f.clock.now.getTime()+3600000)},${json({})})`.execute(db);
  const reserved=await f.store.reserve(f.scope,{...f.request,runId}),claim=await f.store.claim(f.scope,reserved.intentId,'fixture-retention');await f.store.admit(f.scope,claim);
  await sql`UPDATE automation_runs SET status='UNKNOWN',ended_at=${f.clock.now},wake_at=NULL WHERE ${tenant(f.scope)} AND id=${runId}::uuid`.execute(db);
  const oldExpiry=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.expires_at;
  await sweepAutomationRetention(db,new Date(f.clock.now.getTime()+8*86400000));
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)} AND id=${runId}::uuid`.execute(db)).rows).toHaveLength(0);
  for(const table of ['rule_runtime_intents','rule_runtime_attempts','rule_runtime_leases','rule_runtime_outbox','rule_runtime_request_keys'])expect((await sql`SELECT 1 FROM ${sql.table(table)} WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  const root=(await sql<{apply_gate:string;expires_at:Date}>`SELECT apply_gate,expires_at FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!;
  expect(root.apply_gate).toBe('UNKNOWN_BLOCKED');expect(root.expires_at).toEqual(oldExpiry);
});

it('RET06 independently erases an observation at its own earlier expiry while its parent is retained',async()=>{
  const f=await fixture(),runId=randomUUID(),deadline=new Date(f.clock.now.getTime()+3600000),terminal=new Date(deadline.getTime()+3600000);
  await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,draft_revision) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${f.targetId},'Observation expiry fixture',1)`.execute(db);
  await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${f.targetId},1,${json({})},${'f'.repeat(64)},true)`.execute(db);
  await sql`INSERT INTO automation_runs(organization_id,guild_id,id,flow_id,revision,semantic_hash,dedupe_key,input_hash,actor_hash,actor_ciphertext,status,usage_month,started_at,deadline_at,resume)
    VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${runId}::uuid,${f.targetId},1,${'f'.repeat(64)},${randomUUID()},'fixture-input',${f.request.actorHash},'fixture-ciphertext','RUNNING','2026-10-01',${f.clock.now},${deadline},${json({})})`.execute(db);
  await sql`UPDATE automation_runs SET status='EXPIRED',ended_at=${terminal},wake_at=NULL WHERE ${tenant(f.scope)} AND id=${runId}::uuid`.execute(db);
  const observation=(await sql<{retention_expires_at:Date}>`SELECT retention_expires_at FROM automation_execution_observations WHERE ${tenant(f.scope)} AND run_id=${runId}::uuid`.execute(db)).rows[0]!;
  expect(observation.retention_expires_at.getTime()).toBeLessThan(terminal.getTime()+7*86400000);
  await sweepAutomationRetention(db,new Date(observation.retention_expires_at.getTime()+1));
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)} AND id=${runId}::uuid`.execute(db)).rows).toHaveLength(1);
  expect((await sql`SELECT run_id FROM automation_execution_observations WHERE ${tenant(f.scope)} AND run_id=${runId}::uuid`.execute(db)).rows).toHaveLength(0);
});
