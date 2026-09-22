import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {signalSchema,signalRegistry,canonicalSignal,type NexusSignal} from '../../events/src/registry.js';
import {sql,tenant,json,type Tx} from '../../db/src/index.js';
import type {Scope} from '../../shared/src/index.js';
import type {Revision} from '../../settings/src/revisions.js';
import {SettingsService} from '../../settings/src/index.js';
export type Condition=
 |{op:'all'|'any',rules:Condition[]}|{op:'not',rule:Condition}
 |{op:'event'|'count',event:NexusSignal,gte?:number,withinSeconds:number}
 |{op:'duration',event:'voice.duration',gteSeconds:number,withinSeconds:number}
 |{op:'role_present',roleId:string}
 |{op:'join_age',minSeconds:number,maxSeconds:number}
 |{op:'activation_state',activated:boolean}
 |{op:'connection_state',connected:boolean}
 |{op:'channel_activity',channelId:string,gte:number,withinSeconds:number}
 |{op:'reply_received'|'scheduled_event_subscribed',withinSeconds:number}
 |{op:'flow_answer',nodeId:string,optionId:string,withinSeconds:number};
const window=z.number().int().positive().max(30*86400);
const snowflake=z.string().regex(/^\d{17,20}$/);
export const conditionSchema:z.ZodType<Condition>=z.lazy(()=>z.discriminatedUnion('op',[
 z.object({op:z.literal('all'),rules:z.array(conditionSchema).min(1).max(20)}).strict(),
 z.object({op:z.literal('any'),rules:z.array(conditionSchema).min(1).max(20)}).strict(),
 z.object({op:z.literal('not'),rule:conditionSchema}).strict(),
 z.object({op:z.literal('event'),event:signalSchema,withinSeconds:window,gte:z.number().int().positive().optional()}).strict(),
 z.object({op:z.literal('count'),event:signalSchema,gte:z.number().int().positive(),withinSeconds:window}).strict(),
 z.object({op:z.literal('duration'),event:z.literal('voice.duration'),gteSeconds:z.number().positive(),withinSeconds:window}).strict(),
 z.object({op:z.literal('role_present'),roleId:snowflake}).strict(),
 z.object({op:z.literal('join_age'),minSeconds:z.number().int().nonnegative(),maxSeconds:window}).strict(),
 z.object({op:z.literal('activation_state'),activated:z.boolean()}).strict(),
 z.object({op:z.literal('connection_state'),connected:z.boolean()}).strict(),
 z.object({op:z.literal('channel_activity'),channelId:snowflake,gte:z.number().int().positive(),withinSeconds:window}).strict(),
 z.object({op:z.literal('reply_received'),withinSeconds:window}).strict(),
 z.object({op:z.literal('scheduled_event_subscribed'),withinSeconds:window}).strict(),
 z.object({op:z.literal('flow_answer'),nodeId:z.string().max(100),optionId:z.string().max(100),withinSeconds:window}).strict()
]));
export const activationSchema=z.object({name:z.string().min(1).max(100),windowSeconds:window,rule:conditionSchema}).strict().superRefine((d,ctx)=>{
 let nodes=0;const walk=(c:Condition,depth:number)=>{nodes++;if(depth>8||nodes>100){ctx.addIssue({code:'custom',message:'Rule complexity exceeded'});return;}if(c.op==='activation_state'||('event'in c&&c.event==='activation.completed'))ctx.addIssue({code:'custom',message:'Activation cannot depend on its own result'});if('withinSeconds'in c&&c.withinSeconds>d.windowSeconds)ctx.addIssue({code:'custom',message:'Rule window exceeds activation window'});if('rules'in c)c.rules.forEach(r=>walk(r,depth+1));if('rule'in c)walk(c.rule,depth+1);};walk(d.rule,0);
});
export type ActivationDefinition=z.infer<typeof activationSchema>;
export type SignalFact={kind:string,at:number,data:Record<string,unknown>};
export type Evidence={joinedAt:number,asOf:number,facts:SignalFact[],roles:string[],rolesObservedAt?:number,unavailable?:NexusSignal[]};
type Truth=true|false|'unknown';
export function evaluateCondition(c:Condition,e:Evidence):Truth {
 if(c.op==='all'||c.op==='any'){const values=c.rules.map(r=>evaluateCondition(r,e));return c.op==='all'?(values.includes(false)?false:values.includes('unknown')?'unknown':true):(values.includes(true)?true:values.includes('unknown')?'unknown':false);}
 if(c.op==='not'){const value=evaluateCondition(c.rule,e);return value==='unknown'?'unknown':!value;}
 if(c.op==='role_present')return e.rolesObservedAt!==undefined&&e.rolesObservedAt>e.asOf?'unknown':e.roles.includes(c.roleId)?true:e.rolesObservedAt===undefined?'unknown':false;
 if(c.op==='join_age')return e.asOf-e.joinedAt>=c.minSeconds*1000&&e.asOf-e.joinedAt<=c.maxSeconds*1000;
 if(c.op==='activation_state'||c.op==='connection_state'){
  const kind=c.op==='activation_state'?'activation.completed':'reply.received';if(e.unavailable?.includes(kind))return 'unknown';
  const has=e.facts.some(f=>canonicalSignal(f.kind)===kind&&f.at<=e.asOf);return has===(c.op==='activation_state'?c.activated:c.connected);
 }
 if(!('withinSeconds'in c))return 'unknown';
 const kind=c.op==='reply_received'?'reply.received':c.op==='scheduled_event_subscribed'?'scheduled_event.subscribed':c.op==='channel_activity'?'message.sent':c.op==='flow_answer'?'fallback.answer':'event'in c?c.event:'interaction.used';
 const facts=e.facts.filter(f=>canonicalSignal(f.kind)===kind&&f.at>=e.joinedAt&&f.at<=Math.min(e.asOf,e.joinedAt+c.withinSeconds*1000));
 let satisfied:boolean;
 if(c.op==='duration')satisfied=facts.reduce((sum,f)=>sum+(typeof f.data.seconds==='number'?f.data.seconds:0),0)>=c.gteSeconds;
 else if(c.op==='channel_activity')satisfied=facts.filter(f=>f.data.channelId===c.channelId).length>=c.gte;
 else if(c.op==='flow_answer')satisfied=facts.some(f=>f.data.nodeId===c.nodeId&&f.data.optionId===c.optionId);
 else satisfied=facts.length>=('gte'in c?c.gte??1:1);
 // Absence is not a completed negative result until the full observation window matures.
 return satisfied?true:e.unavailable?.includes(kind)||e.asOf<e.joinedAt+c.withinSeconds*1000?'unknown':false;
}
export async function unavailableSignals(tx:Tx,s:Scope,episodeId:string,joinedAt:Date,asOf:Date):Promise<NexusSignal[]>{
 const cfg=await new SettingsService(tx).get(s,tx);
 const cursor=(await sql<{first_seen:Date,last_seen:Date}>`SELECT first_seen,last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(tx)).rows[0];
 const gaps=(await sql`SELECT id FROM telemetry_health WHERE ${tenant(s)} AND started_at<${asOf} AND (ended_at IS NULL OR ended_at>${joinedAt})`.execute(tx)).rows.length;
 if(!cursor||cursor.first_seen>joinedAt||cursor.last_seen.getTime()+90000<asOf.getTime()||gaps||joinedAt.getTime()<Date.now()-cfg.detailedRetentionDays*86400000)return Object.keys(signalRegistry) as NexusSignal[];
 const snapshot=(await sql<{observed_at:Date}>`SELECT observed_at FROM native_member_snapshots WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND observed_at<=${asOf} ORDER BY observed_at DESC LIMIT 1`.execute(tx)).rows[0];
 return cfg.flags.native_snapshot_v2&&snapshot&&snapshot.observed_at.getTime()+90000>=asOf.getTime()?[]:(Object.keys(signalRegistry) as NexusSignal[]).filter(key=>signalRegistry[key].source==='rest');
}
export async function projectActivation(tx:Tx,s:Scope,episodeId:string,asOf=new Date()){
 const episode=(await sql<{joined_at:Date}>`SELECT joined_at FROM membership_episodes WHERE ${tenant(s)} AND id=${episodeId}::uuid AND context='PRODUCTION' FOR UPDATE`.execute(tx)).rows[0];if(!episode)return;
 let pin=(await sql<{revision_id:string}>`SELECT revision_id FROM activation_members WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid`.execute(tx)).rows[0];
 if(!pin){
  // Only a revision published before this membership episode may define its historical metric.
  const revision=(await sql<Revision>`SELECT * FROM guild_config_revisions WHERE ${tenant(s)} AND domain='activation' AND state='published' AND published_at<=${episode.joined_at} ORDER BY published_at DESC LIMIT 1`.execute(tx)).rows[0];if(!revision)return;
  await sql`INSERT INTO activation_members VALUES(${s.organizationId}::uuid,${s.guildId},${episodeId}::uuid,${revision.id}::uuid,NULL) ON CONFLICT DO NOTHING`.execute(tx);pin={revision_id:revision.id};
 }
 const revision=(await sql<Revision>`SELECT * FROM guild_config_revisions WHERE ${tenant(s)} AND id=${pin.revision_id}::uuid`.execute(tx)).rows[0]!;
 const definition=activationSchema.parse(revision.definition);
 const facts=(await sql<{kind:string,occurred_at:Date,data:Record<string,unknown>}>`SELECT kind,occurred_at,data FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND context='PRODUCTION' AND occurred_at<=${asOf} ORDER BY occurred_at`.execute(tx)).rows.map(f=>({kind:f.kind,at:f.occurred_at.getTime(),data:f.data}));
 const roleState=(await sql<{roles:string[],roles_observed_at:Date|null}>`SELECT roles,roles_observed_at FROM member_observable_state WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid`.execute(tx)).rows[0];
 const roles=roleState?.roles??[],rolesObservedAt=roleState?.roles_observed_at?.getTime();
 const deadline=episode.joined_at.getTime()+definition.windowSeconds*1000;
 const unavailable=await unavailableSignals(tx,s,episodeId,episode.joined_at,asOf);
 const times=[...new Set([...facts.map(f=>f.at),...(rolesObservedAt===undefined?[]:[rolesObservedAt]),Math.min(asOf.getTime(),deadline)])].sort((a,b)=>a-b);
 const first=times.find(at=>at<=deadline&&at<=asOf.getTime()&&evaluateCondition(definition.rule,{joinedAt:episode.joined_at.getTime(),asOf:at,facts,roles,rolesObservedAt,unavailable})===true);
 if(first===undefined)return;
 await sql`UPDATE activation_members SET activated_at=LEAST(COALESCE(activated_at,${new Date(first)}),${new Date(first)}) WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid`.execute(tx);
 await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episodeId}::uuid,'activation.completed',${new Date(first)},'PRODUCTION',${json({definitionId:revision.id,definitionVersion:revision.version})}) ON CONFLICT DO NOTHING`.execute(tx);
 await sql`UPDATE lifecycle_events SET occurred_at=LEAST(occurred_at,${new Date(first)}) WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND kind='activation.completed' AND data->>'definitionId'=${revision.id}`.execute(tx);
}
