import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {sql,tenant,type Database} from '../../../packages/db/src/index';
import type {DiscordPort} from '../../../packages/discord/src/rest';
import type {IdentityVault} from '../../../packages/identity/src/index';
import {assert} from '../../../packages/shared/src/index';
import {publicApiContext} from '../../../packages/security/src/public-api';
import {AutomationService,type AutomationServiceOptions} from '../../../packages/automation/src/service';
import type {EvaluatedValue} from '../../../packages/automation/src/types';
import {DEFAULT_AUTOMATION_LIMITS} from '../../../packages/automation/src/types';
import type {AutomationSimulationInput} from '../../../packages/automation/src/simulation';
import {previewAlpha15RolePolicy} from '../../worker/src/alpha15-discord';
import {parallelRunStatus} from '../../../packages/automation/src/parallel';
import {iterationRunStatus} from '../../../packages/automation/src/iteration-results';
import {registerManagedRolePolicies} from './alpha16-managed-roles';
import type {ManagedRoleAdmissionAdapter} from '../../../packages/automation/src/managed-role-admission';

export function registerAlpha15Automation(app:FastifyInstance,db:Database,key:string,discord?:DiscordPort,vault?:IdentityVault,options:AutomationServiceOptions={},managedRoleAdmission?:ManagedRoleAdmissionAdapter) {
  const service=new AutomationService(db,{...options,approvalPolicy:discord&&vault?(tx,s,run,approval,actor)=>previewAlpha15RolePolicy(db,discord,vault,s,run,approval,actor,tx):options.approvalPolicy}),base='/v3/organizations/:organizationId/guilds/:guildId/automation';
  const auth=async(req:Parameters<typeof publicApiContext>[0],permission:'READ'|'CONFIGURE'|'GOVERN'='READ')=>{
    const params=req.params as {organizationId:string;guildId:string};
    return publicApiContext({method:req.method,url:req.url,id:req.id,headers:req.headers,body:req.body,params:{organizationId:params.organizationId,guildId:params.guildId}},db,key,discord,vault,permission);
  };
  const flowId=(params:unknown)=>z.object({flowId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)}).parse(params).flowId;
  registerManagedRolePolicies(app,service,auth,managedRoleAdmission);
  const revision=z.object({revision:z.number().int().positive()}).strict();
  const mockValue=z.object({type:z.unknown(),value:z.unknown()}).strict();
  const mockOutcome=z.enum(['SUCCEEDED','FAILED','NOT_STARTED','UNKNOWN']);
  const mockAwait=z.discriminatedUnion('state',[z.object({state:z.literal('TIMED_OUT')}).strict(),z.object({state:z.literal('MATCHED'),value:z.object({state:z.enum(['OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED']),version:z.number().int().min(0).max(2147483647)}).strict(),occurredAt:z.string().max(30)}).strict()]);
  const testRevision=z.object({revision:z.number().int().positive(),simulation:z.object({values:z.record(z.string(),mockValue).optional(),outputs:z.record(z.string(),mockValue).optional(),outcomes:z.record(z.string(),mockOutcome).optional(),pollReads:z.record(z.string(),z.array(z.object({outcome:mockOutcome.optional(),output:mockValue.optional()}).strict()).max(100)).optional(),awaitEvents:z.record(z.string(),mockAwait).optional(),approvals:z.record(z.string(),z.enum(["APPROVED","REJECTED","EXPIRED"])).optional(),clock:z.string().max(30).optional(),inspectVariables:z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)).max(DEFAULT_AUTOMATION_LIMITS.maxVariables).refine(ids=>new Set(ids).size===ids.length).optional()}).strict().optional()}).strict();
  app.get(base+'/time-zone',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req);return service.timeZonePreference(context.scope,context.actor);});
  app.get(base+'/overview',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req);return service.overview(context.scope,context.actor);});
  app.get(base+'/event-receipts',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req),query=z.object({flowId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional()}).strict().parse(req.query);return service.eventReceipts(context.scope,context.actor,query.flowId);});
  app.get(base+'/flows',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req);return service.list(context.scope,context.actor);});
  app.get(base+'/managed-roles',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');return service.managedRoles(context.scope,context.actor);});
  app.get(base+'/managed-roles/history',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');return service.managedRoleHistory(context.scope,context.actor);});
  app.get(base+'/flows/:flowId',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req);return service.get(context.scope,context.actor,flowId(req.params));});
  app.get(base+'/flows/:flowId/revisions/:revision',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req);const input=z.object({revision:z.coerce.number().int().positive().max(2147483647)}).parse(req.params);return service.getRevision(context.scope,context.actor,flowId(req.params),input.revision);});
  app.get(base+'/flows/:flowId/rollback-history',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req);return service.rollbackHistory(context.scope,context.actor,flowId(req.params));});
  app.post(base+'/flows/:flowId/rollback-draft',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');return service.prepareRollback(context.scope,context.actor,flowId(req.params),z.object({sourceRevision:z.number().int().positive().max(2147483647),expectedRevision:z.number().int().positive().max(2147483647),expectedActiveRevision:z.number().int().positive().max(2147483647).nullable(),expectedGeneration:z.number().int().nonnegative().max(2147483647),requestId:z.uuid()}).strict().parse(req.body));});
  app.post(base+'/flows/:flowId/rollback',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');return service.commitRollback(context.scope,context.actor,flowId(req.params),z.object({rollbackId:z.uuid(),revision:z.number().int().positive().max(2147483647),semanticHash:z.string().regex(/^[a-f0-9]{64}$/),expectedActiveRevision:z.number().int().positive().max(2147483647).nullable(),expectedGeneration:z.number().int().nonnegative().max(2147483647),requestId:z.uuid()}).strict().parse(req.body));});
  app.put(base+'/flows/:flowId/draft',async(req,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');
    const input=z.object({definition:z.unknown(),expectedRevision:z.number().int().nonnegative(),requestId:z.uuid()}).strict().parse(req.body);
    assert(input.definition&&typeof input.definition==='object'&&(input.definition as {id?:unknown}).id===flowId(req.params),'AUTOMATION_FLOW_MISMATCH');
    return service.save(context.scope,context.actor,input);
  });
  for(const [route,kind] of [['validate','VALIDATE'],['test','TEST'],['impact','IMPACT']] as const)
    app.post(base+'/flows/:flowId/'+route,async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');const input=kind==='TEST'?testRevision.parse(req.body):revision.parse(req.body);return service.check(context.scope,context.actor,flowId(req.params),input.revision,kind,('simulation' in input?input.simulation:undefined) as AutomationSimulationInput|undefined);});
  app.post(base+'/flows/:flowId/enable',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');return service.enable(context.scope,context.actor,flowId(req.params),z.object({revision:z.number().int().positive(),semanticHash:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.uuid()}).strict().parse(req.body));});
  app.post(base+'/flows/:flowId/disable',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');return service.disable(context.scope,context.actor,flowId(req.params),z.object({requestId:z.uuid()}).strict().parse(req.body).requestId);});
  app.delete(base+'/flows/:flowId',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');return service.disable(context.scope,context.actor,flowId(req.params),z.object({requestId:z.uuid()}).strict().parse(req.body).requestId,true);});
  app.get(base+'/requests/:requestId',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req);return service.request(context.scope,context.actor,z.object({requestId:z.uuid()}).parse(req.params).requestId);});
  app.post(base+'/flows/:flowId/runs',async(req,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');
    const input=z.object({requestId:z.uuid(),values:z.record(z.string(),z.unknown()).optional()}).strict().parse(req.body);
    return service.start(context.scope,context.actor,flowId(req.params),{requestId:input.requestId,values:input.values as Record<string,EvaluatedValue>|undefined});
  });
  app.get(base+'/approvals',async(req,reply)=>{reply.header('Cache-Control','no-store');const context=await auth(req,'GOVERN');return service.approvals(context.scope,context.actor);});
  app.post(base+'/approvals/:approvalId',async(req,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(req,'GOVERN');
    return service.decideApproval(context.scope,context.actor,z.object({approvalId:z.uuid()}).parse(req.params).approvalId,z.object({decision:z.enum(['APPROVE','REJECT']),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.uuid(),policyFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(req.body));
  });
  app.post(base+'/runs/:runId/cancel',async(req,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE');
    return service.cancel(context.scope,context.actor,z.object({runId:z.uuid()}).parse(req.params).runId,z.object({requestId:z.uuid()}).strict().parse(req.body).requestId);
  });
  app.get(base+'/runs/:runId',async(req,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(req),runId=z.object({runId:z.uuid()}).parse(req.params).runId;
    const run=await service.store.run(context.scope,runId);assert(run,'AUTOMATION_RUN_NOT_FOUND',404);
    const events=(await sql<{sequence:number;block_id:string|null;state:string;code:string|null;occurred_at:Date}>`SELECT sequence,block_id,state,code,occurred_at FROM automation_run_events WHERE ${tenant(context.scope)} AND run_id=${runId}::uuid ORDER BY sequence LIMIT 200`.execute(db)).rows;
    // Resume state, input values, draws, and encrypted identities never enter a
    // history response. This endpoint deliberately returns only status evidence.
    return {id:run.id,flowId:run.flow_id,revision:run.revision,state:run.status,startedAt:run.started_at.toISOString(),endedAt:run.ended_at?.toISOString()??null,dueAt:run.wake_at?.toISOString()??null,reason:run.reason,events,...(run.resume.parallel?{parallel:parallelRunStatus(run.resume)}:{}),...(run.resume.iterations?.length?{iterations:iterationRunStatus(run.resume)}:{})};
  });
  app.get(base+'/targets',async(req,reply)=>{
    reply.header('Cache-Control','no-store');const context=await auth(req,'CONFIGURE'),query=z.object({kind:z.enum(['ChannelRef','RoleRef']),q:z.string().max(100).optional()}).parse(req.query);
    assert(discord?.options,'DISCORD_UNAVAILABLE',503);
    try{
      const options=await discord.options(context.scope.guildId),search=query.q?.toLocaleLowerCase()??'';
      if(query.kind==='RoleRef')return {state:'AVAILABLE',items:options.roles.filter(item=>item.label.toLocaleLowerCase().includes(search)).slice(0,50).map(item=>({id:item.id,name:item.label,type:'RoleRef',kind:'RoleRef',guildId:context.scope.guildId}))};
      assert(discord.automationPreflight,'AUTOMATION_TARGETS_UNAVAILABLE',503);
      const candidates=(options.surfaces??options.channels.map(item=>({...item,type:0}))).filter(item=>[0,4,5].includes(item.type)&&item.label.toLocaleLowerCase().includes(search)).slice(0,50);
      const items:{id:string;name:string;type:number;kind:string;guildId:string}[]=[];
      for(const item of candidates){
        try {await discord.automationPreflight(context.scope.guildId,context.userId,item.type===4?'channel':'message',item.id);items.push({id:item.id,name:item.label,type:item.type,kind:'ChannelRef',guildId:context.scope.guildId});}
        catch(error){
          // A confirmed invisible/unusable target is omitted without its name.
          // An unknown network/check failure cannot be presented as zero items.
          if(!(error&&typeof error==='object'&&'code' in error&&['AUTOMATION_TARGET_PERMISSION','AUTOMATION_BOT_PERMISSION','AUTOMATION_CHANNEL_TYPE','AUTOMATION_TARGET_GUILD'].includes(String(error.code))))throw error;
        }
      }
      return {state:'AVAILABLE',items};
    }
    catch{return {state:'UNAVAILABLE',items:[]};}
  });
  return service;
}
