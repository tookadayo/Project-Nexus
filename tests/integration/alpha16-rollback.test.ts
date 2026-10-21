import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,ensureGuild,migrate,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {AutomationService} from '../../packages/automation/src/service';
import {fingerprint} from '../../packages/automation/src/store';
import type {FlowDefinition} from '../../packages/automation/src/types';
import type {Actor} from '../../packages/settings/src/index';
import {isolatedPostgres} from '../fixtures/postgres';
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
// SUBJECT locks use the same opaque 64-hex actor identity as the live authority.
const actor:Actor={key:'d9'.repeat(32),encryptedUserId:'synthetic-encrypted',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic'};
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(){
 const scope=scopeForGuild(String(888800000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
 const state={canConfigure:true,safe:true},admission={activeFlows:20,monthlyRuns:100,guildConcurrent:2,globalConcurrent:20,guildPending:20,globalPending:200,measurementId:'isolated-rollback'};
 const options={admission,adoptedActions:new Set<string>(),rollbackAudit:{approved:true,purgeReady:true},authorize:async(_tx:unknown,_scope:unknown,_actor:unknown,permission:string)=>{if(permission==='CONFIGURE'&&!state.canConfigure)throw new Error('CURRENT_PERMISSION_DENIED');},rollbackSafety:async()=>{if(!state.safe)throw new Error('TARGET_UNKNOWN_BLOCKED');}};
 const service=new AutomationService(db,options),definition:FlowDefinition={schemaVersion:1,id:`rollback-${serial}`,guildId:scope.guildId,name:'Earlier contents',trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[],roleIds:['888111111111111111'],parentCategoryIds:[]},body:[{kind:'end',id:'end'}]};
 async function checks(revision:number){for(const kind of ['VALIDATE','TEST','IMPACT'] as const)expect((await service.check(scope,actor,definition.id,revision,kind)).valid).toBe(true);}
 const first=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});await checks(1);await service.enable(scope,actor,definition.id,{revision:1,semanticHash:first.validation.semanticHash!,requestId:randomUUID()});
 const run=await service.start(scope,actor,definition.id,{requestId:randomUUID()});
 const second=await service.save(scope,actor,{definition:{...definition,name:'Current contents'},expectedRevision:1,requestId:randomUUID()});await checks(2);await service.enable(scope,actor,definition.id,{revision:2,semanticHash:second.validation.semanticHash!,requestId:randomUUID()});
 const current=await service.get(scope,actor,definition.id),request={sourceRevision:1,expectedRevision:2,expectedActiveRevision:current.activeRevision,expectedGeneration:current.generation,requestId:randomUUID()};
 return {scope,service,definition,options,state,run,current,request,checks};
}
it('copies past contents into a new immutable revision and requires fresh checks before the live CAS',async()=>{
 const f=await fixture(),before=(await sql`SELECT revision,definition,semantic_hash FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id} ORDER BY revision`.execute(db)).rows;
 const prepared=await f.service.prepareRollback(f.scope,actor,f.definition.id,f.request);expect(prepared.draftRevision).toBe(3);expect(prepared.definition.name).toBe('Earlier contents');
 expect((await f.service.get(f.scope,actor,f.definition.id)).activeRevision).toBe(2);
 const commit={rollbackId:prepared.rollbackId,revision:3,semanticHash:prepared.validation.semanticHash!,expectedActiveRevision:f.current.activeRevision,expectedGeneration:f.current.generation,requestId:randomUUID()};
 await expect(f.service.commitRollback(f.scope,actor,f.definition.id,commit)).rejects.toThrow('AUTOMATION_REVIEW_REQUIRED');
 await expect(f.service.enable(f.scope,actor,f.definition.id,{revision:3,semanticHash:commit.semanticHash,requestId:randomUUID()})).rejects.toThrow('AUTOMATION_ROLLBACK_COMMIT_REQUIRED');
 await f.checks(3);expect(await f.service.commitRollback(f.scope,actor,f.definition.id,commit)).toMatchObject({state:'ACTIVE',activeRevision:3});
 expect((await f.service.store.run(f.scope,f.run.id))!.revision).toBe(1);
 expect((await sql`SELECT revision,definition,semantic_hash FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id} AND revision<=2 ORDER BY revision`.execute(db)).rows).toEqual(before);
 expect((await f.service.rollbackHistory(f.scope,actor,f.definition.id)).items[0]).toMatchObject({sourceRevision:1,preparedRevision:3,state:'APPLIED'});
 expect(await f.service.commitRollback(f.scope,actor,f.definition.id,commit)).toMatchObject({activeRevision:3});
});
it('fences concurrent restore drafts and rejects a changed live generation before activation',async()=>{
 const f=await fixture(),attempts=await Promise.allSettled([f.service.prepareRollback(f.scope,actor,f.definition.id,f.request),f.service.prepareRollback(f.scope,actor,f.definition.id,{...f.request,requestId:randomUUID()})]);
 expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 const prepared=(attempts.find(result=>result.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof f.service.prepareRollback>>>).value;
 await f.checks(3);await f.service.disable(f.scope,actor,f.definition.id,randomUUID());
 await expect(f.service.commitRollback(f.scope,actor,f.definition.id,{rollbackId:prepared.rollbackId,revision:3,semanticHash:prepared.validation.semanticHash!,expectedActiveRevision:f.current.activeRevision,expectedGeneration:f.current.generation,requestId:randomUUID()})).rejects.toThrow('AUTOMATION_ROLLBACK_CONFLICT');
});
it('checks current authorization and target UNKNOWN safety instead of trusting the original restoration review',async()=>{
 const f=await fixture(),prepared=await f.service.prepareRollback(f.scope,actor,f.definition.id,f.request);await f.checks(3);
 const commit={rollbackId:prepared.rollbackId,revision:3,semanticHash:prepared.validation.semanticHash!,expectedActiveRevision:f.current.activeRevision,expectedGeneration:f.current.generation,requestId:randomUUID()};
 f.state.canConfigure=false;await expect(f.service.commitRollback(f.scope,actor,f.definition.id,commit)).rejects.toThrow('CURRENT_PERMISSION_DENIED');
 f.state.canConfigure=true;f.state.safe=false;await expect(f.service.commitRollback(f.scope,actor,f.definition.id,commit)).rejects.toThrow('TARGET_UNKNOWN_BLOCKED');expect((await f.service.get(f.scope,actor,f.definition.id)).activeRevision).toBe(2);
});
it('keeps unconfigured restoration disabled and surfaces existing managed-role policy/history without input values',async()=>{
 const f=await fixture(),plain=new AutomationService(db,{admission:f.options.admission,authorize:f.options.authorize});
 expect((await plain.get(f.scope,actor,f.definition.id)).rollbackReadiness.preparationAvailable).toBe(false);await expect(plain.prepareRollback(f.scope,actor,f.definition.id,f.request)).rejects.toThrow('AUTOMATION_ROLLBACK_AUDIT_NOT_READY');
 const policy=await f.service.managedRoles(f.scope,actor);expect(policy.directMutationAvailable).toBe(false);expect(policy.items[0]!.roleIds).toEqual(['888111111111111111']);
 await sql`INSERT INTO automation_operations(organization_id,guild_id,run_id,identity,operation,fingerprint,state) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${f.run.id}::uuid,'synthetic-role','discord.addRole',${fingerprint({synthetic:true})},'UNKNOWN')`.execute(db);
 const history=await f.service.managedRoleHistory(f.scope,actor);expect(history.items[0]!.state).toBe('UNKNOWN');expect(history.items[0]).not.toHaveProperty('inputs');expect(history.items[0]).not.toHaveProperty('memberId');expect(history.items[0]).not.toHaveProperty('roleId');
});
