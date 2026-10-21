import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {connect,migrate,sql,type Database} from "../../packages/db/src/index";
import {isolatedPostgres} from "../fixtures/postgres";
import {analysisFixture} from "../fixtures/analysis";
import {Alpha16PcRuntime,type Alpha16PcRuntimeOptions} from "../../apps/worker/src/alpha16-pc-runtime";
import {RuleEvaluationWorker} from "../../apps/worker/src/alpha16-rules";
import {Alpha16RetentionMaintenance} from "../../apps/worker/src/alpha16-retention-maintenance";

let infra:Awaited<ReturnType<typeof isolatedPostgres>>,db:Database;
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
it("rotates past a permanently unavailable prefix without changing or retrying external work",async()=>{
  const fixture=await analysisFixture(db,"SCALE"),expiresAt=new Date(Date.now()+3600000),jobs=[randomUUID(),randomUUID(),randomUUID()],created=Date.now()-10000;
  await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,approved_at,expires_at,operating_profile_revision,operating_profile_hash,operating_profile_expires_at)
    VALUES(${fixture.s.organizationId}::uuid,${fixture.s.guildId},1,'ACTIVE','synthetic','{}'::jsonb,${'a'.repeat(64)},now(),now(),${expiresAt},'synthetic',${'b'.repeat(64)},${expiresAt})`.execute(db);
  for(const [index,id] of jobs.entries())await sql`INSERT INTO rule_evaluation_jobs(organization_id,guild_id,id,config_version,evaluation_as_of,input_hash,request_hash,versions,inputs,actor_hash,state,created_at,expires_at)
    VALUES(${fixture.s.organizationId}::uuid,${fixture.s.guildId},${id}::uuid,1,${new Date(created+index)},${'c'.repeat(64)},${String(index+1).repeat(64)},'{}'::jsonb,'{}'::jsonb,${fixture.actor.key},'QUEUED',${new Date(created+index)},${expiresAt})`.execute(db);
  const configured:Alpha16PcRuntimeOptions={
    profile:async()=>({enabled:true,revision:"synthetic-fair-drain",expiresAt,maxEvaluationJobsPerScope:1,maxTrackedScopes:1}),
    operator:{startupPass:async()=>({ready:true}),tick:async()=>({ready:true})},retention:{tickGlobal:async()=>({ready:false}),tick:async()=>({ready:true})},
    rules:{} as Alpha16PcRuntimeOptions["rules"],
  };
  const process=vi.spyOn(RuleEvaluationWorker.prototype,"process").mockRejectedValue(new Error("SYNTHETIC_UNAVAILABLE"));
  try {
    const runtime=new Alpha16PcRuntime(db,configured);
    for(let i=0;i<4;i++)await runtime.tick(fixture.s);
    expect(process.mock.calls.map(call=>call[1])).toEqual([...jobs,jobs[0]]);
    const rows=(await sql<{state:string;attempt_count:number}>`SELECT state,attempt_count FROM rule_evaluation_jobs WHERE organization_id=${fixture.s.organizationId}::uuid AND guild_id=${fixture.s.guildId}`.execute(db)).rows;
    expect(rows).toHaveLength(3);expect(rows.every(row=>row.state==='QUEUED'&&row.attempt_count===0)).toBe(true);
  }finally{process.mockRestore();}
});
it("finishes an authorized cancellation after its configuration is retired",async()=>{
  const fixture=await analysisFixture(db,"SCALE"),id=randomUUID(),expiresAt=new Date(Date.now()+3600000);
  await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,expires_at)
    VALUES(${fixture.s.organizationId}::uuid,${fixture.s.guildId},1,'RETIRED','synthetic','{}'::jsonb,${'d'.repeat(64)},${expiresAt})`.execute(db);
  await sql`INSERT INTO rule_evaluation_jobs(organization_id,guild_id,id,config_version,evaluation_as_of,input_hash,request_hash,versions,inputs,actor_hash,state,lease_token,lease_until,expires_at)
    VALUES(${fixture.s.organizationId}::uuid,${fixture.s.guildId},${id}::uuid,1,now(),${'e'.repeat(64)},${'f'.repeat(64)},'{}'::jsonb,'{}'::jsonb,${fixture.actor.key},'CANCEL_REQUESTED',${randomUUID()}::uuid,now()+interval '1 minute',${expiresAt})`.execute(db);
  const maintenance=new Alpha16RetentionMaintenance(db,async()=>({enabled:true,writerCoverageVerified:true,startupDeletionReconciled:true,policyRevision:'synthetic-cancel-only'}));
  expect(await maintenance.tick(fixture.s)).toMatchObject({ready:true});
  const row=(await sql<{state:string;attempt_count:number;lease_token:string|null;lease_until:Date|null;expires_at:Date;finished_at:Date|null}>`SELECT state,attempt_count,lease_token,lease_until,expires_at,finished_at FROM rule_evaluation_jobs WHERE organization_id=${fixture.s.organizationId}::uuid AND guild_id=${fixture.s.guildId} AND id=${id}::uuid`.execute(db)).rows[0]!;
  expect(row).toMatchObject({state:'CANCELLED',attempt_count:0,lease_token:null,lease_until:null,expires_at:expiresAt});
  expect(row.finished_at).toBeInstanceOf(Date);
});
