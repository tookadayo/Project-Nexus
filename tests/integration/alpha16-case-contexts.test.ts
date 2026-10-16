/** Written acceptance material. No operational source/profile approval is implied. */
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {connect,migrate,sql,tenant,type Database,type Tx} from "../../packages/db/src/index";
import {isolatedPostgres} from "../fixtures/postgres";
import {analysisFixture} from "../fixtures/analysis";
import {CASE_FIXTURES_01_12} from "../fixtures/alpha16-cases-01-12";
import {caseSnapshotHash,decodeCaseValue,encodeCaseValue,loadCaseContexts,persistCaseContext,type CaseSnapshotInput} from "../../packages/rules/src/case-storage";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "../../packages/rules/src/locks";
import type {PlatformPolicy} from "../../packages/rules/src/domain";
import type {Scope} from "../../packages/shared/src/index";
import {fixtureInput,fixtureRuleConfig} from "../fixtures/alpha16-rules";
import {sealRuleInput} from "../../packages/rules/src/facts";
import {canonicalCaseHash} from "../../packages/rules/src/case-engine";
import {caseEnvelopeVersions,evaluatePlatform} from "../../packages/rules/src/pipeline";
import {CASES_01_12} from "../../packages/rules/src/cases-01-12";

let infrastructure:Awaited<ReturnType<typeof isolatedPostgres>>,db:Database;
beforeAll(async()=>{infrastructure=await isolatedPostgres();db=connect(infrastructure.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infrastructure?.stop();});
// Synthetic approval exists only in this isolated test database.
const fixturePolicy:PlatformPolicy={kind:"OPERATIONAL",revision:"test-only",approved:true,visibilityApproved:true,retention:{FACT:{seconds:48*3600,approvalReference:"SYNTHETIC_TEST_ONLY"}}};
function input(s:Scope):CaseSnapshotInput{
 const fixture=structuredClone(CASE_FIXTURES_01_12.find(f=>f.id==="CASE09-OVERDUE")!),now=new Date(),at=now.toISOString();
 fixture.context.guildId=s.guildId;fixture.context.contextId=randomUUID();fixture.context.evaluationAsOf=at;fixture.context.deadlineAt=new Date(now.getTime()+60000).toISOString();
 fixture.context.window={start:new Date(now.getTime()-86400000).toISOString(),end:at};
 for(const observation of Object.values(fixture.context.fields)){observation.authorityScope.guildId=s.guildId;observation.observedAt=new Date(now.getTime()-1000).toISOString();observation.expiresAt=new Date(now.getTime()+900000).toISOString();observation.window={...fixture.context.window};}
 for(const health of fixture.context.sourceHealth){health.observedAt=new Date(now.getTime()-1000).toISOString();health.expiresAt=new Date(now.getTime()+900000).toISOString();}
 fixture.context.fields["request.reviewDueAt"]!.value="2026-10-14T12:00:00.123456Z";
 fixture.profile.kind="OPERATIONAL";fixture.profile.approved=true;fixture.profile.retentionApproved=true;
 fixture.profile.values["CASE09.cooldownSeconds"]={unit:"seconds",value:3600};
 return {caseId:fixture.caseId,context:fixture.context,profile:fixture.profile,registry:fixture.registry};
}
async function transaction<T>(s:Scope,work:(tx:Tx)=>Promise<T>){return db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));return work(tx);});}

describe("alpha16 private immutable CASE context storage",()=>{
 it("keeps six fractional digits and restores typed values without a JSON business payload",async()=>{
  const f=await analysisFixture(db,"STARTER"),snapshot=input(f.s);
  const reference=await transaction(f.s,tx=>persistCaseContext(tx,f.s,snapshot,new Date(),fixturePolicy,true));
  const restored=await transaction(f.s,tx=>loadCaseContexts(tx,f.s,[reference],snapshot.context.evaluationAsOf));
  expect(restored).toHaveLength(1);expect(caseSnapshotHash(restored[0]!)).toBe(caseSnapshotHash(snapshot));
  expect(restored[0]!.context.fields["request.reviewDueAt"]!.value).toBe("2026-10-14T12:00:00.123456Z");
  expect(restored[0]!.profile.values["CASE09.cooldownSeconds"]).toEqual({unit:"seconds",value:3600});
  const metadata=(await sql<{fields:boolean;health:boolean;values:boolean}>`SELECT context_metadata?'fields' AS fields,context_metadata?'sourceHealth' AS health,profile_metadata?'values' AS values FROM rule_case_contexts WHERE ${tenant(f.s)} AND id=${reference.snapshotId}::uuid`.execute(db)).rows[0];
  expect(metadata).toEqual({fields:false,health:false,values:false});
  const value=(await sql<{value_kind:string;timestamp_value:string}>`SELECT value_kind,to_char(timestamp_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS timestamp_value FROM rule_case_observations WHERE ${tenant(f.s)} AND context_id=${reference.snapshotId}::uuid AND field_id='request.reviewDueAt'`.execute(db)).rows[0];
  expect(value).toEqual({value_kind:"TIMESTAMP",timestamp_value:"2026-10-14T12:00:00.123456Z"});
 });
 it("binds exact microsecond asOf, source/profile/registry hashes, revision and tenant",async()=>{
  const f=await analysisFixture(db,"STARTER"),other=await analysisFixture(db,"STARTER"),snapshot=input(f.s);
  snapshot.context.evaluationAsOf=snapshot.context.evaluationAsOf.replace(/\.\d{3}Z$/,".123456Z");
  const reference=await transaction(f.s,tx=>persistCaseContext(tx,f.s,snapshot,new Date(),fixturePolicy,true));
  await expect(transaction(f.s,tx=>loadCaseContexts(tx,f.s,[reference],snapshot.context.evaluationAsOf.replace("123456","123457")))).rejects.toThrow("CASE_CONTEXT_NOT_SEALED");
  for(const change of [{contentHash:"0".repeat(64)},{profileHash:"1".repeat(64)},{registryHash:"2".repeat(64)},{revision:"different"}])await expect(transaction(f.s,tx=>loadCaseContexts(tx,f.s,[{...reference,...change}],snapshot.context.evaluationAsOf))).rejects.toThrow("CASE_CONTEXT_NOT_AVAILABLE");
  await expect(transaction(other.s,tx=>loadCaseContexts(tx,other.s,[reference],snapshot.context.evaluationAsOf))).rejects.toThrow("CASE_CONTEXT_NOT_AVAILABLE");
 });
 it("rejects unconfirmed adapters, missing retention, fixture profiles and arbitrary value text",async()=>{
  const f=await analysisFixture(db,"STARTER"),snapshot=input(f.s);
  await expect(transaction(f.s,tx=>persistCaseContext(tx,f.s,snapshot,new Date(),fixturePolicy))).rejects.toThrow("SOURCE_ADAPTER_NOT_CONFIRMED");
  await expect(transaction(f.s,tx=>persistCaseContext(tx,f.s,snapshot,new Date(),undefined,true))).rejects.toThrow("RETENTION_NOT_APPROVED");
  const fixture=structuredClone(snapshot);fixture.profile.kind="SYNTHETIC_FIXTURE";
  await expect(transaction(f.s,tx=>persistCaseContext(tx,f.s,fixture,new Date(),fixturePolicy,true))).rejects.toThrow("CASE_PROFILE_NOT_OPERATIONAL");
  const text=structuredClone(snapshot);text.context.fields["request.status"]!.value="unregistered raw message text";
  await expect(transaction(f.s,tx=>persistCaseContext(tx,f.s,text,new Date(),fixturePolicy,true))).rejects.toThrow();
  expect((await sql`SELECT id FROM rule_case_contexts WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
 });
 it("never extends original expiry and forbids changing a sealed value or header",async()=>{
  const f=await analysisFixture(db,"STARTER"),snapshot=input(f.s),early=new Date(Date.now()+20000).toISOString();snapshot.context.sourceHealth[0]!.expiresAt=early;
  const reference=await transaction(f.s,tx=>persistCaseContext(tx,f.s,snapshot,new Date(),fixturePolicy,true));
  expect(Date.parse(reference.expiresAt)).toBe(Date.parse(early));
  await expect(sql`UPDATE rule_case_contexts SET content_hash=${"a".repeat(64)} WHERE ${tenant(f.s)} AND id=${reference.snapshotId}::uuid`.execute(db)).rejects.toThrow("RULE_IMMUTABLE_PAYLOAD");
  await expect(sql`UPDATE rule_case_observations SET enum_value='SUBMITTED' WHERE ${tenant(f.s)} AND context_id=${reference.snapshotId}::uuid AND field_id='request.status'`.execute(db)).rejects.toThrow("RULE_IMMUTABLE_PAYLOAD");
  const read=await transaction(f.s,tx=>loadCaseContexts(tx,f.s,[reference],snapshot.context.evaluationAsOf));expect(read[0]!.seal.expiresAt).toBe(reference.expiresAt);
  const expired=structuredClone(snapshot);expired.context.sourceHealth[0]!.expiresAt=new Date(Date.now()-1).toISOString();
  await expect(transaction(f.s,tx=>persistCaseContext(tx,f.s,expired,new Date(),fixturePolicy,true))).rejects.toThrow("CASE_EVIDENCE_EXPIRED");
 });
 it("round-trips bounded scalar/cohort components and rejects unsafe numbers",()=>{
  for(const [value,unit] of [[null,"identifier"],[true,"boolean"],[0,"count"],[0.123456789,"ratio"],["UNDER_REVIEW","state"],[{numerator:3,denominator:7,coverage:0.9},"ratio"]] as const)expect(decodeCaseValue(encodeCaseValue(value,unit))).toEqual(value);
  expect(()=>encodeCaseValue(Number.NaN,"ratio")).toThrow("CASE_VALUE_TYPE");expect(()=>encodeCaseValue({numerator:8,denominator:7,coverage:1},"ratio")).toThrow("CASE_VALUE_TYPE");
 });
 it("connects all twenty case outcomes while rejecting a changed value, source revision or one-microsecond asOf",()=>{
  const base=fixtureInput("ONB-001"),fixture=structuredClone(CASE_FIXTURES_01_12.find(f=>f.id==="CASE09-OVERDUE")!);
  fixture.context.guildId=base.guildId;
  for(const observation of Object.values(fixture.context.fields))observation.authorityScope.guildId=base.guildId;
  const ruleInput=sealRuleInput({...base,targets:[...base.targets,{...fixture.context.target,liveVersion:fixture.context.target.liveVersion!}]});
  fixture.context.versions=caseEnvelopeVersions(ruleInput,fixture.caseId,fixture.context.rootTrigger);
  const snapshot:CaseSnapshotInput={caseId:fixture.caseId,context:fixture.context,profile:fixture.profile,registry:fixture.registry};
  const seal={snapshotId:randomUUID(),caseId:fixture.caseId,revision:CASES_01_12.find(c=>c.id===fixture.caseId)!.revision,contentHash:caseSnapshotHash(snapshot),profileHash:canonicalCaseHash(snapshot.profile),registryHash:canonicalCaseHash(snapshot.registry),expiresAt:"2026-10-15T13:00:00.000000Z"};
  const request={input:ruleInput,config:fixtureRuleConfig(),cases:[{...snapshot,seal}],aggregateBudget:{maxSteps:100,maxOperations:1000,maxInputs:1000}},clock={nowMs:()=>Date.parse(ruleInput.evaluationAsOf)};
  const result=evaluatePlatform(request,clock);expect(result.caseResults).toHaveLength(20);expect(result.publishable).toBe(false);
  expect(result.caseResults.find(c=>c.caseId==="CASE09")?.outcome).toBe("ACTION");expect(result.caseResults.filter(c=>c.caseId!=="CASE09").every(c=>c.outcome==="DISABLED")).toBe(true);
  for(const change of [
   (r:typeof request)=>{r.cases[0]!.context.fields["request.status"]!.value="BLOCKED";},
   (r:typeof request)=>{r.cases[0]!.context.sourceHealth[0]!.revision="different";},
   (r:typeof request)=>{r.cases[0]!.context.evaluationAsOf="2026-10-15T12:00:00.000001Z";},
   (r:typeof request)=>{r.cases[0]!.context.versions.config="different";},
  ]){const changed=structuredClone(request);change(changed);expect(evaluatePlatform(changed,clock)).toMatchObject({complete:false,publishable:false,reasonCodes:["CASE_CONTEXT_NOT_SEALED"]});}
 });
});
