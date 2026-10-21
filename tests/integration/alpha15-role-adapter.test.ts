import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {IdentityVault} from '../../packages/identity/src/index';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime} from '../../packages/automation/src/runtime';
import {fingerprint,type AutomationApproval} from '../../packages/automation/src/store';
import {ALPHA15_BETA_ADMISSION,ALPHA15_ADOPTED_ACTIONS} from '../../packages/automation/src/admission';
import {DiscordFailure,type AutomationDiscordWrite,type AutomationRolePolicyInput} from '../../packages/discord/src/rest';
import {createAlpha15DiscordAdapter,previewAlpha15RolePolicy} from '../../apps/worker/src/alpha15-discord';
import type {FlowDefinition} from '../../packages/automation/src/types';
import {FakeDiscord} from '../fixtures/discord';
import {isolatedPostgres} from '../fixtures/postgres';
// Production adoption is enabled only by the parent after the connector tests.
vi.mock('../../packages/automation/src/admission',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../packages/automation/src/admission')>();
  return {...actual,ALPHA15_ADOPTED_ACTIONS:new Set([...actual.ALPHA15_ADOPTED_ACTIONS,'discord.addRole','discord.removeRole'])};
});
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,sequence=0;
const requester='887111111111111111',approver='887222222222222222',member='887333333333333333',role='887444444444444444',vault=new IdentityVault('ab'.repeat(32),'cd'.repeat(32));
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(operation:'discord.addRole'|'discord.removeRole'='discord.addRole'){
  const s=scopeForGuild(String(887000000000000000n+BigInt(++sequence)));await ensureGuild(db,s);
  const actor=(user:string)=>({key:vault.hash(s,user),encryptedUserId:vault.seal(s,user),permissions:'268435488',roles:[],source:'WEB_DASHBOARD' as const,requestId:randomUUID()});
  const requesterActor=actor(requester),approverActor=actor(approver);
  const discord=Object.assign(new FakeDiscord(),{automationPreflight:vi.fn(async()=>{}),automationRolePreflight:vi.fn(async(_input:AutomationRolePolicyInput)=>({fingerprint:'a'.repeat(64),changedChannelCount:1})),automationWrite:vi.fn(async(_input:AutomationDiscordWrite,before:()=>Promise<void>)=>{await before();return null;})});
  for(const id of [requester,approver,member])discord.members.set(id,{permissions:id===member?'0':'268435488',roles:[],joinedAt:'2026-01-01T00:00:00Z',bot:false});
  const definition:FlowDefinition={schemaVersion:1,id:'role-adapter-'+sequence,guildId:s.guildId,name:'Synthetic roles',trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[],roleIds:[role],parentCategoryIds:[]},body:[{id:'role',kind:'action',operation,approvalRequired:true,inputs:{role:{kind:'literal',type:'RoleRef',value:{id:role,guildId:s.guildId}},member:{kind:'literal',type:'MemberRef',value:{id:member,guildId:s.guildId}}}}]};
  const service=new AutomationService(db,{admission:ALPHA15_BETA_ADMISSION,adoptedActions:ALPHA15_ADOPTED_ACTIONS});
  const saved=await service.save(s,requesterActor,{definition,expectedRevision:0,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(s,requesterActor,definition.id,1,kind,kind==='TEST'?{outcomes:{role:'SUCCEEDED'}}:{});
  await service.enable(s,requesterActor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const adapter=createAlpha15DiscordAdapter(db,discord,vault),runtime=new AutomationRuntime(db,{admission:service.limits,adapter}),run=await service.start(s,requesterActor,definition.id,{requestId:randomUUID()});
  expect(await runtime.tick(s,run.id)).toMatchObject({state:'WAITING_APPROVAL'});
  const approval=(await sql<AutomationApproval>`SELECT * FROM automation_approvals WHERE ${tenant(s)} AND run_id=${run.id}::uuid`.execute(db)).rows[0]!,record=(await service.store.run(s,run.id))!;
  const policy=await previewAlpha15RolePolicy(db,discord,vault,s,record,approval,approverActor);
  // Seed an actual immutable receipt to test the connector independently of the
  // service/API decision handler (which has its own policy-echo tests).
  await sql`UPDATE automation_approvals SET state='APPROVED',approver_hash=${approverActor.key},approver_ciphertext=${approverActor.encryptedUserId},policy_fingerprint=${policy.fingerprint},decided_at=now(),request_id=${randomUUID()}::uuid WHERE ${tenant(s)} AND id=${approval.id}::uuid`.execute(db);
  // The decision handler also wakes the waiting run. Mirror that transition
  // while keeping this connector test independent of the policy-echo API.
  await sql`UPDATE automation_runs SET status='QUEUED',wake_at=NULL WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(db);
  return {s,requesterActor,approverActor,discord,service,adapter,runtime,run,approval,record,policy};
}
it.each(['discord.addRole','discord.removeRole'] as const)('executes a fixed allowlisted %s only after rechecking both real people',async operation=>{
  const f=await fixture(operation);expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});
  expect(f.discord.automationRolePreflight).toHaveBeenLastCalledWith({guildId:f.s.guildId,memberId:member,roleId:role,add:operation==='discord.addRole',requesterId:requester,approverId:approver,protectedRoleIds:[]});
  expect(f.discord.automationWrite).toHaveBeenCalledTimes(1);
});
it('stops an approval whose native permission meaning changed before dispatch',async()=>{
  const f=await fixture();f.discord.automationRolePreflight.mockResolvedValue({fingerprint:'b'.repeat(64),changedChannelCount:2});
  let sent=0;f.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();sent++;return null;});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});expect(sent).toBe(0);
  expect((await sql`SELECT state,reason FROM automation_operations WHERE ${tenant(f.s)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([{state:'NOT_STARTED',reason:'AUTOMATION_APPROVAL_POLICY_CHANGED'}]);
});
it('rechecks a formal approver current authorization rather than trusting their saved receipt',async()=>{
  const f=await fixture();f.discord.members.get(approver)!.permissions='0';let sent=0;
  f.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();sent++;return null;});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});expect(sent).toBe(0);
});
it('checks the persisted immutable flow allowlist even when a connector context claims another role',async()=>{
  const f=await fixture(),other='887555555555555555',inputs={...f.approval.inputs,role:{...f.approval.inputs.role!,value:{id:other,guildId:f.s.guildId}}};
  expect(await f.adapter.execute({scope:f.s,runId:f.run.id,identity:f.approval.identity,operation:'discord.addRole',inputs,targets:{channelIds:[],roleIds:[other],parentCategoryIds:[]},approvalRequired:true,approval:{id:f.approval.id,fingerprint:fingerprint(inputs),expiresAt:f.approval.expires_at.toISOString()}})).toEqual({state:'NOT_STARTED',code:'AUTOMATION_TARGET_NOT_ALLOWED'});
  expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
it('bounds consecutive role operations per guild using existing operation timestamps',async()=>{
  const f=await fixture();for(let i=0;i<5;i++)await sql`INSERT INTO automation_operations(organization_id,guild_id,run_id,identity,operation,fingerprint,state) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${f.run.id}::uuid,${'previous-'+i},'discord.addRole','synthetic','SUCCEEDED')`.execute(db);
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
it('does not automatically repeat a role operation whose external result is unknown',async()=>{
  const f=await fixture();f.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();throw new DiscordFailure(0,0,{kind:'network'});});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'UNKNOWN'});await f.runtime.tick(f.s,f.run.id);expect(f.discord.automationWrite).toHaveBeenCalledTimes(1);
});
