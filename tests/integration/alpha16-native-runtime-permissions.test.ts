import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {connect,ensureGuild,json,migrate,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {recordAutomationExecutionHeartbeat} from '../../packages/automation/src/execution-observation';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,legacyId:string;
const scope=scopeForGuild('887699999999999975'),flowId='native-observation-fixture';
async function insertRun(){
 const id=randomUUID(),at=new Date(),deadline=new Date(at.getTime()+86400000);
 await sql`INSERT INTO automation_runs(organization_id,guild_id,id,flow_id,revision,semantic_hash,dedupe_key,input_hash,actor_hash,actor_ciphertext,status,usage_month,started_at,deadline_at,resume)
 VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,${flowId},1,${'a'.repeat(64)},${id},'fixture-input','fixture-actor','fixture-no-real-identity','QUEUED',${at},${at},${deadline},${json({frames:[],variables:{},startedAt:at.toISOString(),steps:0,evaluations:0,externalActions:0})})`.execute(db);
 return id;
}
beforeAll(async()=>{
 infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db,{throughVersion:74});await ensureGuild(db,scope);
 await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,draft_revision,state) VALUES(${scope.organizationId}::uuid,${scope.guildId},${flowId},'fixture',1,'DRAFT')`.execute(db);
 await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${scope.organizationId}::uuid,${scope.guildId},${flowId},1,${json({schemaVersion:1,id:flowId,guildId:scope.guildId,name:'fixture',trigger:{kind:'manual',inputs:[]},variables:[],body:[]})},${'a'.repeat(64)},true)`.execute(db);
 legacyId=await insertRun();await migrate(db);
});
afterAll(async()=>{await db?.destroy();await infra?.stop();});

it('an expired observation cannot be recreated by later terminal edits after its independent purge',async()=>{
 const id=await insertRun();
 await sql`UPDATE automation_runs r SET started_at=t.at-interval '16 days',deadline_at=t.at-interval '9 days',status='COMPLETED',ended_at=t.at-interval '10 days' FROM (SELECT clock_timestamp() AS at) t WHERE r.organization_id=${scope.organizationId}::uuid AND r.guild_id=${scope.guildId} AND r.id=${id}::uuid`.execute(db);
 const marker=(await sql<{execution_observation_expires_at:Date}>`SELECT execution_observation_expires_at FROM automation_runs WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(db)).rows[0]!.execution_observation_expires_at;
 expect(marker.getTime()).toBeLessThan(Date.now());
 await sql`DELETE FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid AND retention_expires_at<=clock_timestamp()`.execute(db);
 for(let index=0;index<2;index++)await sql`UPDATE automation_runs SET ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(db);
 await recordAutomationExecutionHeartbeat(db,scope,id,new Date());
 expect((await sql`SELECT 1 FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid`.execute(db)).rows).toHaveLength(0);
 expect((await sql<{execution_observation_expires_at:Date}>`SELECT execution_observation_expires_at FROM automation_runs WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(db)).rows[0]!.execution_observation_expires_at.toISOString()).toBe(marker.toISOString());
});

it('075 never fabricates a heartbeat/census for an existing Run, and explicit observations stay parent-owned',async()=>{
 expect((await sql`SELECT 1 FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${legacyId}::uuid`.execute(db)).rows).toHaveLength(0);
 const id=await insertRun();
 const first=(await sql<{due_at:Date;deadline_at:Date;heartbeat_at:Date|null}>`SELECT due_at,deadline_at,heartbeat_at FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid`.execute(db)).rows[0]!;
 expect(first.due_at).toBeInstanceOf(Date);expect(first.heartbeat_at).toBeNull();
 // A generic metadata update is not worker liveness.
 await sql`UPDATE automation_runs SET updated_at=clock_timestamp() WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(db);
 expect((await sql<{heartbeat_at:Date|null}>`SELECT heartbeat_at FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid`.execute(db)).rows[0]!.heartbeat_at).toBeNull();
 const heartbeat=new Date();await recordAutomationExecutionHeartbeat(db,scope,id,heartbeat);
 expect((await sql<{heartbeat_at:Date}>`SELECT heartbeat_at FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid`.execute(db)).rows[0]!.heartbeat_at.toISOString()).toBe(heartbeat.toISOString());
 const terminal=new Date();await sql`UPDATE automation_runs SET status='COMPLETED',ended_at=${terminal} WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(db);
 const expiry=(await sql<{terminal_at:Date;retention_expires_at:Date}>`SELECT terminal_at,retention_expires_at FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid`.execute(db)).rows[0]!;
 expect(expiry.retention_expires_at.getTime()).toBeLessThanOrEqual(terminal.getTime()+7*86400000);
 await sql`UPDATE automation_runs SET ended_at=${new Date(terminal.getTime()+3600000)} WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(db);
 expect((await sql<{terminal_at:Date;retention_expires_at:Date}>`SELECT terminal_at,retention_expires_at FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid`.execute(db)).rows[0]).toEqual(expiry);
 await sql`DELETE FROM automation_runs WHERE ${tenant(scope)} AND id=${id}::uuid`.execute(db);
 await recordAutomationExecutionHeartbeat(db,scope,id,new Date());
 expect((await sql`SELECT 1 FROM automation_execution_observations WHERE ${tenant(scope)} AND run_id=${id}::uuid`.execute(db)).rows).toHaveLength(0);
});
it('075 invalidates old permission pairing on actual config change and not routine Run progress',async()=>{
 const before=(await sql<{revision:string;changed_at:Date}>`SELECT revision::text,changed_at FROM native_permission_requirement_epochs WHERE ${tenant(scope)}`.execute(db)).rows[0]!;
 await sql`UPDATE automation_runs SET updated_at=clock_timestamp() WHERE ${tenant(scope)} AND id=${legacyId}::uuid`.execute(db);
 const afterRun=(await sql<{revision:string}>`SELECT revision::text FROM native_permission_requirement_epochs WHERE ${tenant(scope)}`.execute(db)).rows[0]!;
 expect(afterRun.revision).toBe(before.revision);
 await sql`UPDATE automation_flows SET active_revision=1,state='ACTIVE',generation=generation+1 WHERE ${tenant(scope)} AND id=${flowId}`.execute(db);
 const afterActivation=(await sql<{revision:string;changed_at:Date}>`SELECT revision::text,changed_at FROM native_permission_requirement_epochs WHERE ${tenant(scope)}`.execute(db)).rows[0]!;
 expect(BigInt(afterActivation.revision)).toBeGreaterThan(BigInt(before.revision));expect(afterActivation.changed_at.getTime()).toBeGreaterThanOrEqual(before.changed_at.getTime());
 await sql`UPDATE automation_flows SET updated_at=clock_timestamp(),name='renamed fixture' WHERE ${tenant(scope)} AND id=${flowId}`.execute(db);
 expect((await sql<{revision:string}>`SELECT revision::text FROM native_permission_requirement_epochs WHERE ${tenant(scope)}`.execute(db)).rows[0]!.revision).toBe(afterActivation.revision);
});
