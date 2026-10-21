import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { connect, migrate, sql, tenant, json, type Database } from "../../packages/db/src/index";
import { RulePlatform, type TargetDraftAdapter } from "../../packages/rules/src/service";
import { digest, type PlatformPolicy } from "../../packages/rules/src/domain";
import { disabledRuleConfig } from "../../packages/rules/src/rule-config";
import { analysisFixture } from "../fixtures/analysis";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>;
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
const secret = "synthetic-alpha16-communication-key";
// Synthetic fixture approvals only. These values are never runtime defaults.
const policy: PlatformPolicy = { kind: "OPERATIONAL", revision: "fixture-policy", approved: true, visibilityApproved: true,
  retention: Object.fromEntries(["CONFIG", "EVALUATION", "SUGGESTION", "USER_STATE", "SUPPRESSION", "HISTORY", "DRAFT_LINK", "REQUEST_KEY", "TARGET_LIVE_SAFETY"]
    .map(kind => [kind, { seconds: 120, approvalReference: "fixture-approval" }])) };
async function fixture() {
  const f = await analysisFixture(db, "STARTER"), suggestionId = randomUUID(), targetId = "fixture-flow";
  let drafts = 0;
  const adapter: TargetDraftAdapter = {
    targetType: "AUTOMATION_FLOW", writerCompatible: true,
    validateFields: input => z.object({ enabled: z.literal(false) }).strict().parse(input),
    lockCurrent: async () => ({ version: "1", contentHash: digest({ enabled: true }) }),
    createDraft: async () => { ++drafts; return { draftId: randomUUID(), immutableRevisionId: randomUUID(), contentHash: digest({ enabled: false }) }; },
  };
  const service = new RulePlatform(db, policy, secret, [adapter], { scope: f.s, actorHash: f.actor.key, expiresAt: new Date(Date.now() + 60_000) });
  const expires = new Date(Date.now() + 60_000), observed = new Date(), start = new Date(observed.getTime() - 3_600_000);
  await sql`INSERT INTO rule_suggestions(organization_id,guild_id,id,target_type,target_id,live_version,evaluation_ref_hash,evaluation_as_of,rule_id,versions,window_start,window_end,issue_code,dedupe_key,lineage_key,action_id,action_mode,action_payload,explanation,state,audience,last_observed_at,actionable_until,history_expires_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${suggestionId}::uuid,'AUTOMATION_FLOW',${targetId},'1',${"a".repeat(64)},${observed},'FIXTURE-001',${json({})},${start},${observed},'FIXTURE',${randomUUID()},${"b".repeat(64)},'FIXTURE_DRAFT','CREATE_DRAFT',${json({ enabled: false })},${json({})},'ACTIVE','GUILD',${observed},${expires},${expires})`.execute(db);
  await sql`INSERT INTO rule_target_safety(organization_id,guild_id,target_type,target_id,live_version,safety_epoch,apply_gate,expires_at,policy_revision)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'AUTOMATION_FLOW',${targetId},'1',1,'OPEN',${expires},'fixture-policy')`.execute(db);
  return { ...f, service, suggestionId, expires, drafts: () => drafts };
}

it("communication preparation has no domain effect and same-key configuration replay creates one revision", async () => {
  const f = await fixture(), definition = disabledRuleConfig("1"), payload = { baseConfigVersion: 0, definition };
  const prepared = await f.service.prepareMutationRequest(f.s, f.actor, { operation: "CONFIG_REVISE", expectedVersion: 0, payload });
  expect((await sql`SELECT version FROM rule_config_versions WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  const [a, b] = await Promise.all([f.service.reviseConfig(f.s, f.actor, 0, definition, prepared.key), f.service.reviseConfig(f.s, f.actor, 0, definition, prepared.key)]);
  expect(a.configVersion).toBe(1); expect(b.configVersion).toBe(1);
  expect((await sql`SELECT version FROM rule_config_versions WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(1);
  await expect(f.service.reviseConfig(f.s, f.actor, 0, disabledRuleConfig("2"), prepared.key)).rejects.toThrow("IDEMPOTENCY_BODY_MISMATCH");
  await sql`DELETE FROM rule_request_keys WHERE ${tenant(f.s)} AND key_hash=${digest(prepared.key)}`.execute(db);
  await expect(f.service.reviseConfig(f.s, f.actor, 0, definition, prepared.key)).rejects.toThrow("IDEMPOTENCY_INTENT_GONE");
  expect((await sql`SELECT version FROM rule_config_versions WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(1);
});

it("save and reject retries reconstruct scoped state without repeating writes or history", async () => {
  const f = await fixture();
  const save = await f.service.prepareMutationRequest(f.s, f.actor, { operation: "SUGGESTION_SAVE", targetId: f.suggestionId, payload: {} });
  expect(Date.parse(save.expiresAt)).toBeLessThanOrEqual(f.expires.getTime());
  await f.service.userState(f.s, f.actor, f.suggestionId, "save", save.key);
  await f.service.userState(f.s, f.actor, f.suggestionId, "save", save.key);
  expect((await sql<{ row_version: string }>`SELECT row_version FROM rule_suggestion_user_states WHERE ${tenant(f.s)} AND suggestion_id=${f.suggestionId}::uuid`.execute(db)).rows[0]!.row_version).toBe("1");
  const reject = await f.service.prepareMutationRequest(f.s, f.actor, { operation: "SUGGESTION_REJECT", targetId: f.suggestionId, expectedVersion: 1, payload: { reasonCode: "NOT_APPLICABLE" } });
  const [a, b] = await Promise.all([f.service.reject(f.s, f.actor, f.suggestionId, 1, "NOT_APPLICABLE", reject.key), f.service.reject(f.s, f.actor, f.suggestionId, 1, "NOT_APPLICABLE", reject.key)]);
  expect(a.suggestionVersion).toBe(2); expect(b.suggestionVersion).toBe(2);
  expect((await sql`SELECT id FROM rule_suggestion_history WHERE ${tenant(f.s)} AND event_type='REJECTED'`.execute(db)).rows).toHaveLength(1);
});

it("same-key draft retries create one immutable draft and unknown roots remove the capability", async () => {
  const f = await fixture(), payload = { liveVersion: "1", changes: { enabled: false } };
  const prepared = await f.service.prepareMutationRequest(f.s, f.actor, { operation: "SUGGESTION_DRAFT", targetId: f.suggestionId, expectedVersion: 1, payload });
  const [a, b] = await Promise.all([f.service.createDraft(f.s, f.actor, f.suggestionId, 1, payload, prepared.key), f.service.createDraft(f.s, f.actor, f.suggestionId, 1, payload, prepared.key)]);
  expect(a).toEqual(b); expect(f.drafts()).toBe(1);
  expect((await sql`SELECT draft_id FROM rule_suggestion_draft_links WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(1);
  await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED',safety_epoch=safety_epoch+1 WHERE ${tenant(f.s)}`.execute(db);
  expect((await f.service.detail(f.s, f.actor, f.suggestionId)).canCreateDraft).toBe(false);
  await expect(f.service.createDraft(f.s, f.actor, f.suggestionId, 1, payload, prepared.key)).rejects.toThrow("TARGET_SAFETY_UNAVAILABLE");
  expect(f.drafts()).toBe(1);
});

it("a purged prepared key is never first execution, and replay still rechecks deletion", async () => {
  const f = await fixture(), envelope = { operation: "SUGGESTION_VIEW", targetId: f.suggestionId, payload: {} };
  const prepared = await f.service.prepareMutationRequest(f.s, f.actor, envelope);
  await sql`DELETE FROM rule_request_keys WHERE ${tenant(f.s)} AND key_hash=${digest(prepared.key)}`.execute(db);
  await expect(f.service.userState(f.s, f.actor, f.suggestionId, "view", prepared.key)).rejects.toThrow("IDEMPOTENCY_INTENT_GONE");
  expect((await sql`SELECT suggestion_id FROM rule_suggestion_user_states WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  const live = await f.service.prepareMutationRequest(f.s, f.actor, envelope);
  await f.service.userState(f.s, f.actor, f.suggestionId, "view", live.key);
  await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${f.actor.key},now())`.execute(db);
  await expect(f.service.userState(f.s, f.actor, f.suggestionId, "view", live.key)).rejects.toThrow(/RESOURCE_DELETED|PRIVACY_DELETED/);
});

it("cancel replay reports current job status and increments its version only once", async () => {
  const f = await fixture(), id = randomUUID(), definition = disabledRuleConfig("1"), expires = new Date(Date.now() + 60_000);
  await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,approved_at,expires_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},1,'DRAFT','fixture',${json(definition)},${digest(definition)},now(),NULL,${expires})`.execute(db);
  await sql`INSERT INTO rule_evaluation_jobs(organization_id,guild_id,id,config_version,evaluation_as_of,input_hash,request_hash,versions,inputs,actor_hash,state,expires_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${id}::uuid,1,now(),${"c".repeat(64)},${"d".repeat(64)},${json({})},${json({})},${f.actor.key},'QUEUED',${expires})`.execute(db);
  const prepared = await f.service.prepareMutationRequest(f.s, f.actor, { operation: "EVALUATION_CANCEL", targetId: id, payload: {} });
  const a = await f.service.job(f.s, f.actor, id, true, prepared.key), b = await f.service.job(f.s, f.actor, id, true, prepared.key);
  expect(a.status).toBe("CANCEL_REQUESTED"); expect(b.status).toBe("CANCEL_REQUESTED");
  expect((await sql<{ row_version: string }>`SELECT row_version FROM rule_evaluation_jobs WHERE ${tenant(f.s)} AND id=${id}::uuid`.execute(db)).rows[0]!.row_version).toBe("2");
});
