import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { RulePlatform } from "../../packages/rules/src/service";
import { RuleOperatingAdmission } from "../../packages/rules/src/operating-config";
import { digest, PLATFORM_VERSIONS, type PlatformPolicy } from "../../packages/rules/src/domain";
import type { RuleEngineConfig } from "../../packages/rules/src/rule-config";
import { analysisFixture } from "../fixtures/analysis";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>;
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
const policy: PlatformPolicy = { kind: "OPERATIONAL", revision: "isolated-config-policy", approved: true, visibilityApproved: true,
  retention: Object.fromEntries(["CONFIG", "FACT", "SOURCE_HEALTH", "EVALUATION", "SUGGESTION", "HISTORY", "REQUEST_KEY"].map(kind => [kind, { seconds: 3600, approvalReference: "isolated-fixture-only" }])) };
async function fixture() {
  const f = await analysisFixture(db, "STARTER", false), measured = new Date(Date.now() - 1000), deadline = new Date(Date.now() + 900000), state = { authorized: true };
  const admission = new RuleOperatingAdmission({ observe: async request => ({ kind: "MEASURED_OPERATIONAL", scope: request.scope, actorHash: request.actorHash,
    revision: "isolated-measured", configHash: request.configHash, measuredAt: measured.toISOString(), measurementExpiresAt: deadline.toISOString(), measurementReference: "fixture-not-production",
    observedAt: new Date().toISOString(), expiresAt: deadline.toISOString(), retentionRevision: policy.revision, retentionEnforced: true, sourceRegistryRevision: "isolated-registry", workerReady: true,
    budget: request.config.budget, sourceAuthorizations: request.config.approvedSourceTypes.map(sourceType => ({ sourceType, expiresAt: deadline.toISOString() })) }),
    recheck: async () => { if (!state.authorized) throw new Error("source-authorization-revoked"); } });
  const authority = { scope: f.s, actorHash: f.actor.key, expiresAt: new Date(Date.now() + 60000) };
  const service = new RulePlatform(db, policy, "isolated-config-request-key-000000000000", [], authority, undefined, admission);
  const definition: RuleEngineConfig = { configVersion: "1", profile: "OPERATIONAL", approval: "DISABLED", retentionApproved: false,
    budget: { maxRules: 1, maxFacts: 50, maxTargets: 10, maxDurationMs: 1000, maxSteps: 1000 }, approvedSourceTypes: ["source_health_observation_v1"], rules: {} };
  await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,expires_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},1,'DRAFT',${PLATFORM_VERSIONS.engine},${JSON.stringify(definition)}::jsonb,${digest(definition)},clock_timestamp()+interval '1 hour')`.execute(db);
  return { ...f, service, authority, state, definition, deadline };
}
it("creates immutable ACTIVE and RETIRED successors with measured current authorization, CAS and bounded original expiry", async () => {
  const f = await fixture(), input = { baseConfigVersion: 1, draftConfigVersion: 1, draftContentHash: digest(f.definition) };
  const prepared = await f.service.prepareMutationRequest(f.s, f.actor, { operation: "CONFIG_ACTIVATE", expectedVersion: 1, payload: input });
  const active = await f.service.activateConfig(f.s, f.actor, input, prepared.key);
  expect(active).toMatchObject({ configVersion: 2, status: "ACTIVE", sourceConfigVersion: 1, operatingProfileRevision: "isolated-measured" });
  expect(Date.parse(active.expiresAt)).toBeLessThanOrEqual(f.deadline.getTime());
  expect((await sql<{ definition: unknown }>`SELECT definition FROM rule_config_versions WHERE ${tenant(f.s)} AND version=1`.execute(db)).rows[0]!.definition).toEqual(f.definition);
  expect((await f.service.readiness(f.s, f.actor)).evaluation.enabled).toBe(true);
  f.state.authorized = false;
  const unavailable = await f.service.readiness(f.s, f.actor);
  expect(unavailable.evaluation.enabled).toBe(false); expect(unavailable.proposalVisibility.availableWithCurrentRead).toBe(true);
  // Stopping a config does not require an available measurement provider.
  const stopping = new RulePlatform(db, policy, "isolated-config-request-key-000000000000", [], f.authority);
  const jobId = randomUUID();
  await sql`INSERT INTO rule_evaluation_jobs(organization_id,guild_id,id,config_version,evaluation_as_of,input_hash,request_hash,versions,inputs,actor_hash,state,expires_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${jobId}::uuid,2,clock_timestamp(),${"a".repeat(64)},${"b".repeat(64)},'{}'::jsonb,'{}'::jsonb,${f.actor.key},'QUEUED',clock_timestamp()+interval '1 minute')`.execute(db);
  const retireInput = { baseConfigVersion: 2, activeConfigVersion: 2, activeContentHash: active.contentHash };
  const retireKey = await stopping.prepareMutationRequest(f.s, f.actor, { operation: "CONFIG_RETIRE", expectedVersion: 2, payload: retireInput });
  const retired = await stopping.retireConfig(f.s, f.actor, retireInput, retireKey.key);
  expect(retired).toMatchObject({ configVersion: 3, status: "RETIRED", sourceConfigVersion: 2, operatingProfileRevision: null });
  expect(Date.parse(retired.expiresAt)).toBeLessThanOrEqual(Date.parse(active.expiresAt));
  expect((await sql`SELECT state FROM rule_evaluation_jobs WHERE ${tenant(f.s)} AND id=${jobId}::uuid`.execute(db)).rows[0]).toEqual({ state: "CANCEL_REQUESTED" });
  expect((await stopping.config(f.s, f.actor, true)).currentVersion).toBe(3);
  expect((await stopping.config(f.s, f.actor)).status).toBe("DISABLED");
  expect((await stopping.retireConfig(f.s, f.actor, retireInput, retireKey.key)).configVersion).toBe(3);
  expect((await sql`SELECT version FROM rule_config_versions WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(3);
  expect((await sql`SELECT action FROM operations_audit_events WHERE ${tenant(f.s)} AND retention_class='ALPHA16_MINIMAL_OPERATION'`.execute(db)).rows).toHaveLength(2);
});
it("keeps stale version, absent measured provider, expired actor and source revocation from activating anything", async () => {
  const f = await fixture(), input = { baseConfigVersion: 1, draftConfigVersion: 1, draftContentHash: digest(f.definition) };
  const defaultService = new RulePlatform(db, policy, "isolated-config-request-key-000000000000", [], f.authority);
  await expect(defaultService.activateConfig(f.s, f.actor, input)).rejects.toThrow("MEASURED_OPERATING_PROVIDER_UNCONFIGURED");
  const prepared = await f.service.prepareMutationRequest(f.s, f.actor, { operation: "CONFIG_ACTIVATE", expectedVersion: 1, payload: input });
  f.state.authorized = false;
  await expect(f.service.activateConfig(f.s, f.actor, input, prepared.key)).rejects.toThrow("source-authorization-revoked");
  f.state.authorized = true;
  const successor={...f.definition,configVersion:"2"};
  await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,expires_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},2,'DRAFT',${PLATFORM_VERSIONS.engine},${JSON.stringify(successor)}::jsonb,${digest(successor)},clock_timestamp()+interval '1 hour')`.execute(db);
  await expect(f.service.activateConfig(f.s, f.actor, input, prepared.key)).rejects.toThrow("VERSION_MISMATCH");
  f.authority.expiresAt = new Date(0);
  await expect(f.service.activateConfig(f.s, f.actor, input, prepared.key)).rejects.toThrow("AUTHZ_UNAVAILABLE");
  expect((await sql`SELECT version FROM rule_config_versions WHERE ${tenant(f.s)} AND state='ACTIVE'`.execute(db)).rows).toEqual([]);
});
it("returns the true latest CAS version even when that row is expired and omitted from displayed history",async()=>{
  const f=await fixture(),definition={...f.definition,configVersion:"9"};
  await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,expires_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},9,'DRAFT',${PLATFORM_VERSIONS.engine},${JSON.stringify(definition)}::jsonb,${digest(definition)},clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')`.execute(db);
  const result=await f.service.config(f.s,f.actor,true);
  expect(result.currentVersion).toBe(9);expect(result.items.map(item=>item.configVersion)).toEqual([1]);
});
