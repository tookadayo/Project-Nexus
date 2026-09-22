import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import {scopeSchema,assert,DomainError} from '../../../packages/shared/src/index.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import {AnalyticsService} from '../../../packages/analytics/src/index.js';
import {diagnose} from '../../../packages/analytics/src/diagnoses.js';
import {SettingsService,type Actor} from '../../../packages/settings/src/index.js';
import {EntitlementService,type Feature} from '../../../packages/settings/src/entitlements.js';
import {domainRevisions} from '../../../packages/settings/src/domain-config.js';
import type {ConfigDomain} from '../../../packages/settings/src/revisions.js';
import {ExperimentService} from '../../../packages/lifecycle/src/experiments.js';
import {InterventionService} from '../../../packages/lifecycle/src/interventions.js';
export function registerV02(app:FastifyInstance,db:Database,key:string){
 const base='/v2/organizations/:organizationId/guilds/:guildId';
 const auth=(params:unknown,header:unknown)=>{const scope=scopeSchema.parse(params);assert(validApiToken(key,scope,String(header??'').replace(/^Bearer /,'')),'FORBIDDEN',403);return scope;};
 const schemas=domainRevisions(db);
 app.get(base+'/dashboard',async(req,reply)=>{
  const s=auth(req.params,req.headers.authorization);reply.header('Cache-Control','no-store');
  const analytics=new AnalyticsService(db,new SettingsService(db)),now=Date.now(),day=86400000;
  const metrics=await analytics.canonical(s),baseline=await analytics.canonical(s,new Date(now-30*day),new Date(now-15*day));
  const current=await analytics.canonical(s,new Date(now-15*day),new Date(now));
  const capability=(await sql<{profile:unknown}>`SELECT profile FROM guild_capabilities WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(db)).rows[0]?.profile??null;
  const revisions=(await sql`SELECT id,domain,version,definition,state,hash,published_at FROM guild_config_revisions WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 100`.execute(db)).rows;
  const interventions=(await sql`SELECT id,revision_id,state,reason,created_at,delivered_at FROM intervention_runs WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 100`.execute(db)).rows;
  const experiments=(await sql<{id:string}>`SELECT id FROM guild_config_revisions WHERE ${tenant(s)} AND domain='experiment' AND state='published' ORDER BY published_at DESC LIMIT 10`.execute(db)).rows;
  const results=[];for(const e of experiments)results.push({id:e.id,...await new ExperimentService(db).result(s,e.id)});
  return {metrics,diagnoses:diagnose(current,baseline),capability,revisions,interventions,experiments:results,usage:await new EntitlementService(db).usage(s),settings:await new SettingsService(db).get(s)};
 });
 app.post(base+'/configuration',async(req,reply)=>{
  try{
   const s=auth(req.params,req.headers.authorization);
   const input=z.object({action:z.enum(['draft','preview','publish','rollback','approve','experiment_control']),domain:z.enum(['activation','intervention','experiment','onboarding','privacy']).optional(),definition:z.unknown().optional(),id:z.uuid().optional(),expectedHead:z.uuid().nullable().optional(),confirmationHash:z.string().optional(),state:z.enum(['running','paused','stopped']).optional()}).strict().parse(req.body);
   // The scoped bearer token is a server-held administration credential; never sent to browsers.
   const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
   const feature:Partial<Record<ConfigDomain,Feature>>={activation:'custom_activation',intervention:'interventions',experiment:'experiments'};
   if(input.action==='draft'){
    assert(input.domain,'DOMAIN_REQUIRED');const needed=feature[input.domain];if(needed)assert(needed==='custom_activation'?await new EntitlementService(db).canDefineActivation(s,input.definition):await new EntitlementService(db).can(s,needed),'ENTITLEMENT_REQUIRED',403);
    const id=await schemas.draft(s,actor,input.domain,input.definition);return schemas.preview(s,id);
   }
   assert(input.id,'REVISION_REQUIRED');
   if(input.action==='experiment_control'){assert(input.state,'STATE_REQUIRED');await new ExperimentService(db).control(s,actor,input.id,input.state);return {state:input.state};}
   if(input.action==='preview')return schemas.preview(s,input.id);
   if(input.action==='rollback'){const id=await schemas.rollback(s,actor,input.id);return schemas.preview(s,id);}
   if(input.action==='approve'){await new InterventionService(db).approve(s,actor,input.id);return {approved:true};}
   assert(input.confirmationHash&&input.expectedHead!==undefined,'PREVIEW_REQUIRED');
   const next=await schemas.get(s,input.id),needed=feature[next.domain];if(needed)assert(needed==='custom_activation'?await new EntitlementService(db).canDefineActivation(s,next.definition):await new EntitlementService(db).can(s,needed),'ENTITLEMENT_REQUIRED',403);
   const published=await schemas.publish(s,actor,input.id,input.expectedHead,input.confirmationHash);
   return published;
  }catch(error){return reply.code(error instanceof DomainError?error.status:400).send({error:error instanceof DomainError?error.code:'INVALID_CONFIGURATION'});}
 });
}
