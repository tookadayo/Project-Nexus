import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sql,tenant,type Database,type Tx} from '../../db/src/index.js';
import {assert,type Scope} from '../../shared/src/index.js';
import {SettingsService,audit,type Actor} from '../../settings/src/index.js';
import {canAdmin} from '../../security/src/index.js';
import {conditionSchema,evaluateCondition,unavailableSignals,type Evidence} from './activation.js';
import {EntitlementService} from '../../settings/src/entitlements.js';
import {signalSchema} from '../../events/src/registry.js';
import {enqueue} from '../../discord/src/outbox.js';
const id=z.string().regex(/^\d{17,20}$/);
const safeText=z.string().min(1).max(1500).refine(t=>!/@everyone|@here/.test(t),'Mass mentions prohibited');
export const interventionActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('staff_alert'),channelId:id,text:safeText}).strict(),
 z.object({type:z.literal('channel_message'),channelId:id,text:safeText}).strict(),
 z.object({type:z.literal('send_dm'),text:safeText}).strict(),
 z.object({type:z.literal('recommend_channels'),channelId:id,channels:z.array(id).min(1).max(5)}).strict(),
 z.object({type:z.literal('recommend_event'),channelId:id,eventId:id}).strict(),
 z.object({type:z.literal('assign_nexus_role'),roleId:id}).strict(),
 z.object({type:z.literal('remove_nexus_role'),roleId:id}).strict()
]);
export const interventionSchema=z.object({name:z.string().min(1).max(100),trigger:signalSchema.exclude(['role.added','role.removed']),delaySeconds:z.number().int().min(0).max(604800).default(0),conditions:z.array(conditionSchema).max(20),actions:z.array(interventionActionSchema).length(1),cooldownSeconds:z.number().int().min(3600).max(2592000),safetyMode:z.enum(['suggest','approval','auto']).default('suggest'),frequencyCaps:z.object({dmPerDay:z.number().int().min(0).max(1),contactsPerWeek:z.number().int().min(0).max(3)}).strict(),massRoleOperation:z.boolean().default(false)}).strict();
export type InterventionDefinition=z.infer<typeof interventionSchema>;
export type InterventionAction=z.infer<typeof interventionActionSchema>;
export async function evidence(tx:Tx,s:Scope,episodeId:string,asOf=new Date()):Promise<Evidence|null>{
 const member=(await sql<{joined_at:Date}>`SELECT joined_at FROM membership_episodes WHERE ${tenant(s)} AND id=${episodeId}::uuid AND context='PRODUCTION' AND left_at IS NULL`.execute(tx)).rows[0];if(!member)return null;
 const facts=(await sql<{kind:string,occurred_at:Date,data:Record<string,unknown>}>`SELECT kind,occurred_at,data FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND context='PRODUCTION' AND occurred_at<=${asOf}`.execute(tx)).rows;
 const state=(await sql<{roles:string[],roles_observed_at:Date|null}>`SELECT roles,roles_observed_at FROM member_observable_state WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid`.execute(tx)).rows[0];
 const unavailable=await unavailableSignals(tx,s,episodeId,member.joined_at,asOf);
 return {joinedAt:member.joined_at.getTime(),asOf:asOf.getTime(),facts:facts.map(f=>({kind:f.kind,at:f.occurred_at.getTime(),data:f.data})),roles:state?.roles??[],rolesObservedAt:state?.roles_observed_at?.getTime(),unavailable};
}
export function interventionEligible(d:InterventionDefinition,e:Evidence,origin:'member'|'bot'|'nexus'='member'){
 return origin==='member'&&e.facts.some(f=>f.kind===d.trigger&&f.at+d.delaySeconds*1000<=e.asOf)&&d.conditions.every(c=>evaluateCondition(c,e)===true);
}
export class InterventionService {
 constructor(private readonly db:Database){}
 async propose(s:Scope,revisionId:string,episodeId:string,assignmentId:string|null=null,origin:'member'|'bot'|'nexus'='member'){
  return this.db.transaction().execute(async tx=>{
   const cfg=await new SettingsService(this.db).get(s,tx);assert(cfg.enabled&&cfg.flags.interventions_v2,'INTERVENTIONS_DISABLED');
   assert(await new EntitlementService(tx).can(s,'interventions'),'ENTITLEMENT_REQUIRED',403);
   const row=(await sql<{definition:unknown}>`SELECT definition FROM guild_config_revisions WHERE ${tenant(s)} AND id=${revisionId}::uuid AND domain='intervention' AND state='published'`.execute(tx)).rows[0];assert(row,'INTERVENTION_NOT_PUBLISHED');const definition=interventionSchema.parse(row.definition);
   const ev=await evidence(tx,s,episodeId);if(!ev||!interventionEligible(definition,ev,origin))return null;
   if(assignmentId){
    const assigned=(await sql<{variant:string,definition:{variants:{key:string,interventionRevisionId:string|null}[]}}>`SELECT a.variant,r.definition FROM experiment_assignments a JOIN guild_config_revisions r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.id=a.revision_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.id=${assignmentId}::uuid AND a.episode_id=${episodeId}::uuid`.execute(tx)).rows[0];
    assert(assigned?.definition.variants.some(v=>v.key===assigned.variant&&v.interventionRevisionId===revisionId),'ASSIGNMENT_TREATMENT_MISMATCH');
   }
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+':contact:'+episodeId},0))`.execute(tx);
   const previous=(await sql`SELECT id FROM intervention_runs WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND revision_id=${revisionId}::uuid AND COALESCE(delivered_at,available_at)>${new Date(Date.now()-definition.cooldownSeconds*1000)}`.execute(tx)).rows;if(previous.length)return null;
   const counts=(await sql<{weekly:number,daily:number}>`SELECT count(*) FILTER(WHERE COALESCE(delivered_at,available_at)>now()-interval '7 days')::integer AS weekly,count(*) FILTER(WHERE COALESCE(delivered_at,available_at)>now()-interval '24 hours')::integer AS daily FROM intervention_runs WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND state IN ('queued','running','delivered','unknown')`.execute(tx)).rows[0]!;
   const dm=definition.actions.some(a=>a.type==='send_dm');
   const reason=dm&&!cfg.dmEnabled?'DM_DISABLED':counts.weekly>=Math.min(3,definition.frequencyCaps.contactsPerWeek)?'CONTACT_CAP':dm&&counts.daily>=Math.min(1,definition.frequencyCaps.dmPerDay)?'DM_CAP':null;
   const state=reason?'suppressed':definition.safetyMode==='suggest'?'suggested':definition.safetyMode==='approval'||definition.massRoleOperation?'approval':'queued';
   if(state==='queued')assert(await new EntitlementService(tx).can(s,'automation_auto'),'ENTITLEMENT_REQUIRED',403);
   const id=randomUUID();const added=await sql`INSERT INTO intervention_runs(organization_id,guild_id,id,episode_id,revision_id,state,reason,assignment_id) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${episodeId}::uuid,${revisionId}::uuid,${state},${reason},${assignmentId}::uuid) ON CONFLICT DO NOTHING RETURNING id`.execute(tx);
   if(added.rows.length&&state==='queued')await enqueue(tx,s,`intervention:${id}`,'INTERVENTION_DELIVER',{runId:id});
   return added.rows.length?{id,state,reason}:null;
  });
 }
 async approve(s:Scope,actor:Actor,id:string){
  return this.db.transaction().execute(async tx=>{
   const cfg=await new SettingsService(this.db).get(s,tx);assert(canAdmin(actor.permissions,actor.roles,cfg.adminRoleId),'ADMIN_REQUIRED',403);
   assert(cfg.flags.interventions_v2&&await new EntitlementService(tx).can(s,'interventions'),'ENTITLEMENT_REQUIRED',403);
   const updated=await sql`UPDATE intervention_runs SET state='queued',available_at=now(),approved_by=${actor.key} WHERE ${tenant(s)} AND id=${id}::uuid AND state IN ('suggested','approval') RETURNING id`.execute(tx);assert(updated.rows.length,'RUN_NOT_APPROVABLE');
   await enqueue(tx,s,`intervention:${id}`,'INTERVENTION_DELIVER',{runId:id});
   await audit(tx,s,actor,'intervention.approved',null,{id});
  });
 }
}
