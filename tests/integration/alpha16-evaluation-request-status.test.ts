/** Source acceptance fixture only. Uses its own disposable PG when authorized;
 * never reads an operational DATABASE_URL or runs an evaluation. */
import {randomUUID} from "node:crypto";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {connect, migrate, sql, tenant, type Database, type Tx} from "../../packages/db/src/index";
import {isolatedPostgres} from "../fixtures/postgres";
import {analysisFixture} from "../fixtures/analysis";
import {acquireRuleScopeLocks, ruleScopeLockSet} from "../../packages/rules/src/locks";
import {prepareRuleMutation, readRuleEvaluationRequestStatus} from "../../packages/rules/src/communication";
import {canonicalJson, digest, type PlatformPolicy} from "../../packages/rules/src/domain";
import {disabledRuleConfig} from "../../packages/rules/src/rule-config";
import {RulePlatform} from "../../packages/rules/src/service";
let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>;
const secret = "synthetic-request-status-fixture-only".repeat(2);
const policy: PlatformPolicy = {kind: "OPERATIONAL", revision: "SYNTHETIC_ONLY", approved: true, visibilityApproved: true, retention: {REQUEST_KEY: {seconds: 30, approvalReference: "SYNTHETIC_ONLY"}}};
beforeAll(async () => {infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db);});
afterAll(async () => {await db?.destroy(); await infra?.stop();});
async function fixture() {
  const f = await analysisFixture(db, "STARTER", false), now = new Date(), end = new Date(now.getTime() + 30000);
  const work = <T,>(run: (tx: Tx) => Promise<T>, scope = f.s) => db.transaction().execute(async tx => {await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope)); return run(tx);});
  const issued = await work(tx => prepareRuleMutation(tx, f.s, f.actor.key, secret, policy, {operation: "EVALUATE", payload: {configVersion: 1, inputs: [], requestedCaseIds: ["CASE01"], reason: "MANUAL"}}, now, end));
  const platform = (actor = f.actor, proofEnd = new Date(Date.now() + 10000)) => new RulePlatform(db, undefined, secret, [], {scope: f.s, actorHash: actor.key, expiresAt: proofEnd});
  const read = (at = now, actorHash = f.actor.key, scope = f.s) => work(tx => readRuleEvaluationRequestStatus(tx, scope, actorHash, secret, issued.key, at), scope);
  return {...f, now, end, issued, work, read, platform};
}
describe("alpha16 original evaluation acceptance lookup", () => {
  it("reads PREPARED without claiming non-execution, consuming a key or extending its expiry", async () => {
    const f = await fixture(), before = (await sql`SELECT resource_id,expires_at FROM rule_request_keys WHERE ${tenant(f.s)}`.execute(db)).rows;
    expect(await f.platform().evaluationRequestStatus(f.s, f.actor, {key: f.issued.key})).toEqual({status: "PREPARED", acceptance: "UNKNOWN", job: null, expiresAt: f.end.toISOString()});
    expect((await sql`SELECT resource_id,expires_at FROM rule_request_keys WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual(before);
    expect((await sql`SELECT id FROM rule_evaluation_jobs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  });
  it("binds receipt lookup to actor, tenant, exact EVALUATE purpose and stored HMAC fingerprint", async () => {
    const f = await fixture(), other = await analysisFixture(db, "STARTER", false);
    expect(await f.read(f.now, "other-actor")).toEqual({status: "MISSING"}); expect(await f.read(f.now, f.actor.key, other.s)).toEqual({status: "MISSING"});
    await sql`INSERT INTO rule_request_keys(organization_id,guild_id,actor_hash,operation_class,key_hash,fingerprint,resource_id,expires_at)
      SELECT organization_id,guild_id,'other-actor',operation_class,key_hash,fingerprint,resource_id,expires_at FROM rule_request_keys WHERE ${tenant(f.s)}`.execute(db);
    await expect(f.read(f.now, "other-actor")).rejects.toThrow("INVALID_IDEMPOTENCY_KEY");
    await sql`UPDATE rule_request_keys SET fingerprint=${"a".repeat(64)} WHERE ${tenant(f.s)} AND actor_hash=${f.actor.key}`.execute(db);
    await expect(f.read()).rejects.toThrow("INVALID_IDEMPOTENCY_KEY");
  });
  it("keeps expired, removed and wrong-purpose references closed", async () => {
    const f = await fixture(); expect(await f.read(f.end)).toEqual({status: "EXPIRED"});
    await sql`UPDATE rule_request_keys SET resource_id=${canonicalJson({state: "DONE", reference: {kind: "CONFIG", version: 1}})} WHERE ${tenant(f.s)}`.execute(db);
    expect(await f.read()).toEqual({status: "UNAVAILABLE"});
    await sql`UPDATE rule_request_keys SET operation_class='CONFIG_REVISE' WHERE ${tenant(f.s)}`.execute(db); expect(await f.read()).toEqual({status: "MISSING"});
    await sql`DELETE FROM rule_request_keys WHERE ${tenant(f.s)}`.execute(db); expect(await f.read()).toEqual({status: "MISSING"});
  });
  it("returns only the original actor job metadata in the same transaction even when generation is disabled", async () => {
    const f = await fixture(), id = randomUUID(), jobEnd = new Date(f.end.getTime() + 60000), definition = disabledRuleConfig("1");
    await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,expires_at)
      VALUES(${f.s.organizationId}::uuid,${f.s.guildId},1,'RETIRED','fixture',${JSON.stringify(definition)}::jsonb,${digest(definition)},${f.now},${jobEnd})`.execute(db);
    await sql`INSERT INTO rule_evaluation_jobs(organization_id,guild_id,id,config_version,evaluation_as_of,input_hash,request_hash,versions,inputs,actor_hash,state,lease_token,created_at,finished_at,expires_at)
      VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${id}::uuid,1,${f.now},${"b".repeat(64)},${"c".repeat(64)},'{}'::jsonb,'{"privateFixture":"do not expose"}'::jsonb,${f.actor.key},'SUCCEEDED',${randomUUID()}::uuid,${f.now},${f.now},${jobEnd})`.execute(db);
    await sql`UPDATE rule_request_keys SET resource_id=${canonicalJson({state: "DONE", reference: {kind: "EVALUATION", jobId: id}})} WHERE ${tenant(f.s)}`.execute(db);
    const before = (await sql`SELECT resource_id,expires_at FROM rule_request_keys WHERE ${tenant(f.s)}`.execute(db)).rows;
    const result = await f.platform().evaluationRequestStatus(f.s, f.actor, {key: f.issued.key});
    expect(result).toMatchObject({status: "DONE", acceptance: "CONFIRMED", job: {evaluationJobId: id, status: "SUCCEEDED"}});
    for (const field of ["actor_hash", "lease_token", "inputs", "request_hash"]) expect(result.job).not.toHaveProperty(field);
    expect((await sql`SELECT resource_id,expires_at FROM rule_request_keys WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual(before);
    await expect(f.platform({...f.actor, permissions: "0", roles: []}).evaluationRequestStatus(f.s, {...f.actor, permissions: "0", roles: []}, {key: f.issued.key})).rejects.toThrow("ADMIN_REQUIRED");
    await expect(f.platform(f.actor, new Date(Date.now() - 1)).evaluationRequestStatus(f.s, f.actor, {key: f.issued.key})).rejects.toThrow("AUTHZ_UNAVAILABLE");
    await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${f.actor.key})`.execute(db);
    await expect(f.platform().evaluationRequestStatus(f.s, f.actor, {key: f.issued.key})).rejects.toThrow(/RESOURCE_DELETED|PRIVACY_DELETED/);
  });
});
