import { afterAll,beforeAll,expect,it } from 'vitest';
import { connect,ensureGuild,migrate,sql,tenant,type Database } from '../../packages/db/src/index';
import { scopeForGuild } from '../../packages/security/src/scoping';
import { acquireRuleScopeLocks,ruleScopeLockSet } from '../../packages/rules/src/locks';
import { expandRuleInputRefs,loadRuleFacts,persistRuleFacts } from '../../packages/rules/src/fact-storage';
import { canonicalRuleJson,hashRuleValue,sealRuleInput } from '../../packages/rules/src/facts';
import type { FactValue,RuleId } from '../../packages/rules/src/facts';
import { fixtureInput } from '../fixtures/alpha16-rules';
import { isolatedPostgres } from '../fixtures/postgres';

// Test code only: never connects DATABASE_URL or any existing deployment.
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(ruleId:RuleId='EVENT-001'){
  const scope=scopeForGuild(String(888700000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const input=fixtureInput(ruleId);input.guildId=scope.guildId;
  const capturedAt=new Date(),end=new Date(capturedAt.getTime()+7200000),policyExpiry={fact:new Date(capturedAt.getTime()+3600000),sourceHealth:new Date(capturedAt.getTime()+5400000)};
  for(const fact of input.facts){fact.observedAt=new Date(capturedAt.getTime()-1800000).toISOString().replace(/\.\d{3}Z$/,'.123456Z');fact.expiresAt=end.toISOString();}
  for(const health of input.sourceHealth){health.observedAt=new Date(capturedAt.getTime()-1800000).toISOString().replace(/\.\d{3}Z$/,'.234567Z');health.expiresAt=end.toISOString();health.lastSuccessfulIngestAt=new Date(capturedAt.getTime()-2700000).toISOString().replace(/\.\d{3}Z$/,'.345678Z');}
  const work=<T>(run:(tx:Parameters<typeof persistRuleFacts>[0])=>Promise<T>)=>db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(scope));return run(tx);});
  const refs={facts:input.facts.map(f=>({snapshotId:f.snapshotId,factId:f.factId,sourceRevision:f.sourceRevision})),sourceHealth:input.sourceHealth.map(h=>({observationId:h.observationId,revision:h.revision}))};
  const save=()=>work(tx=>persistRuleFacts(tx,scope,input.facts,input.sourceHealth,capturedAt,policyExpiry));
  return {scope,input,capturedAt,policyExpiry,work,refs,save};
}
it('round trips original immutable metadata/microseconds and typed scalar components without JSON payload copies',async()=>{
  const f=await fixture();await f.save();
  const loaded=await f.work(tx=>loadRuleFacts(tx,f.scope,f.refs));
  expect(loaded.facts.map(hashRuleValue).sort()).toEqual(sealRuleInput(f.input).facts.map(hashRuleValue).sort());
  expect(loaded.facts[0]!.observedAt).toMatch(/\.123456Z$/);expect(loaded.sourceHealth[0]!.observedAt).toMatch(/\.234567Z$/);expect(loaded.sourceHealth[0]!.lastSuccessfulIngestAt).toMatch(/\.345678Z$/);
  expect(sealRuleInput({...f.input,...loaded}).inputHash).toBe(sealRuleInput(f.input).inputHash);
  const rows=(await sql<{component_key:string;value_kind:string;integer_value:string;column_type:string}>`SELECT component_key,value_kind,integer_value,'SCALAR'::text AS column_type FROM rule_fact_values WHERE ${tenant(f.scope)} ORDER BY component_key`.execute(db)).rows;
  expect(rows.some(row=>row.component_key==='numerator'&&row.value_kind==='INTEGER')).toBe(true);
  const columns=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_name='rule_fact_values'`.execute(db)).rows.map(row=>row.column_name);
  expect(columns).not.toContain('payload');expect(columns).not.toContain('value_json');
});
it('bounds effective DB expiry by policy without changing the original source/hash expiry',async()=>{
  const f=await fixture();await f.save();
  const snapshots=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_fact_snapshots WHERE ${tenant(f.scope)}`.execute(db)).rows;
  expect(snapshots.every(row=>row.expires_at<=f.policyExpiry.fact)).toBe(true);
  const groups=(await sql<{expires_at:Date;source_expires_at:Date}>`SELECT expires_at,source_expires_at FROM rule_fact_groups WHERE ${tenant(f.scope)}`.execute(db)).rows;
  expect(groups.every(row=>row.expires_at<row.source_expires_at)).toBe(true);
  const expanded=await f.work(tx=>expandRuleInputRefs(tx,f.scope,[{kind:'FACT',id:f.input.facts[0]!.snapshotId,revision:'1'}]));
  expect(expanded.expiresAt<=f.policyExpiry.fact).toBe(true);expect(expanded.sourceHealth).toEqual(f.refs.sourceHealth);
});
it('cannot extend old observation retention by reinserting after a later capture',async()=>{
  const f=await fixture();await f.save();
  const original=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_fact_snapshots WHERE ${tenant(f.scope)} ORDER BY id`.execute(db)).rows.map(row=>row.expires_at.toISOString());
  await f.work(async tx=>{
    await sql`DELETE FROM rule_fact_health_refs WHERE ${tenant(f.scope)}`.execute(tx);
    await sql`DELETE FROM rule_fact_values WHERE ${tenant(f.scope)}`.execute(tx);
    await sql`DELETE FROM rule_fact_groups WHERE ${tenant(f.scope)}`.execute(tx);
    await sql`DELETE FROM rule_fact_snapshots WHERE ${tenant(f.scope)}`.execute(tx);
    await sql`DELETE FROM rule_source_health WHERE ${tenant(f.scope)}`.execute(tx);
    const later=new Date(f.capturedAt.getTime()+300000),expiry={fact:new Date(f.policyExpiry.fact.getTime()+300000),sourceHealth:new Date(f.policyExpiry.sourceHealth.getTime()+300000)};
    await persistRuleFacts(tx,f.scope,f.input.facts,f.input.sourceHealth,later,expiry);
  });
  const restored=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_fact_snapshots WHERE ${tenant(f.scope)} ORDER BY id`.execute(db)).rows.map(row=>row.expires_at.toISOString());
  expect(restored).toEqual(original);
});
it('reuses exact source identities but rejects changed sealed values/revisions and SQL updates',async()=>{
  const f=await fixture();await f.save();await f.save();
  const fact=f.input.facts[0]!,value=fact.value as Extract<FactValue,{kind:'ratio'}>;fact.value={...value,numerator:'79'};
  await expect(f.save()).rejects.toThrow('RULE_STORAGE_IMMUTABLE_CONFLICT');
  await expect(sql`UPDATE rule_fact_groups SET source_revision='changed' WHERE ${tenant(f.scope)}`.execute(db)).rejects.toThrow('RULE_IMMUTABLE_PAYLOAD');
  await expect(sql`UPDATE rule_source_health SET revision='changed' WHERE ${tenant(f.scope)}`.execute(db)).rejects.toThrow('RULE_IMMUTABLE_PAYLOAD');
});
it('rejects cross-guild, changed revision, invalidated and missing component references',async()=>{
  const f=await fixture(),other=await fixture();await f.save();
  await expect(f.work(tx=>loadRuleFacts(tx,other.scope,f.refs))).rejects.toThrow('RULE_FACT_REF_UNAVAILABLE');
  await expect(f.work(tx=>loadRuleFacts(tx,f.scope,{...f.refs,facts:[{...f.refs.facts[0]!,sourceRevision:'wrong'}]}))).rejects.toThrow('RULE_FACT_REF_UNAVAILABLE');
  await sql`DELETE FROM rule_fact_values WHERE ${tenant(f.scope)} AND snapshot_id=${f.refs.facts[0]!.snapshotId}::uuid AND component_key='numerator'`.execute(db);
  await expect(f.work(tx=>loadRuleFacts(tx,f.scope,f.refs))).rejects.toThrow('RULE_SCALAR_COMPONENT_INVALID');
  await sql`UPDATE rule_fact_snapshots SET state='INVALIDATED',invalidated_at=now() WHERE ${tenant(f.scope)}`.execute(db);
  await expect(f.work(tx=>expandRuleInputRefs(tx,f.scope,[{kind:'FACT',id:f.refs.facts[0]!.snapshotId,revision:'1'}]))).rejects.toThrow('RULE_FACT_REF_UNAVAILABLE');
});
it('rejects unregistered metadata and excessive scalar bounds before any Fact insertion',async()=>{
  const f=await fixture();f.input.facts[0]!.metricId='unregistered';await expect(f.save()).rejects.toThrow('RULE_METRIC_CONTRACT_MISMATCH');
  expect((await sql`SELECT * FROM rule_fact_snapshots WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  const g=await fixture();g.input.facts[0]!.value={kind:'ratio',numerator:'9223372036854775808',denominator:'9223372036854775808'};await expect(g.save()).rejects.toThrow('RULE_COUNT_INVALID');
  expect((await sql`SELECT * FROM rule_fact_values WHERE ${tenant(g.scope)}`.execute(db)).rows).toHaveLength(0);
});
it('stores and restores nullable timestamps, enum/period states, and deduplicated anomaly scalar projections',async()=>{
  for(const ruleId of ['REPORT-001','EXP-001','PLAY-001','AUTO-002','PERM-001'] as const){
    const f=await fixture(ruleId);
    const generation=f.input.facts.find(fact=>fact.value?.kind==='generation');if(generation)generation.value={kind:'generation',dueAt:null,lastSuccessAt:null};
    await f.save();const loaded=await f.work(tx=>loadRuleFacts(tx,f.scope,f.refs));
    expect(canonicalRuleJson(sealRuleInput({...f.input,...loaded}))).toBe(canonicalRuleJson(sealRuleInput(f.input)));
  }
});
