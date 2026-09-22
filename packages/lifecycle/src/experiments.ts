import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sql,tenant,json,type Database} from '../../db/src/index.js';
import {assert,type Scope} from '../../shared/src/index.js';
import {conditionSchema,evaluateCondition} from './activation.js';
import {evidence,InterventionService} from './interventions.js';
import {EntitlementService} from '../../settings/src/entitlements.js';
import {SettingsService,audit,type Actor} from '../../settings/src/index.js';
import {canAdmin} from '../../security/src/index.js';
import {coverage} from '../../analytics/src/index.js';
import {canonicalSignal,signalRegistry} from '../../events/src/registry.js';
export const experimentSchema=z.object({name:z.string().min(1).max(100),eligibility:z.array(conditionSchema).max(20),randomization:z.enum(['member','time_block']),blockSeconds:z.number().int().min(3600).max(604800),variants:z.array(z.object({key:z.enum(['control','treatment']),weight:z.number().int().positive().max(100),interventionRevisionId:z.uuid().nullable()}).strict()).length(2),primaryMetric:z.enum(['activation','connection','retention']),windowSeconds:z.number().int().min(3600).max(2592000),minimumSample:z.number().int().min(20),guardrails:z.object({maxLeaveRate:z.number().min(0).max(1),maxFailureRate:z.number().min(0).max(1),maxAlerts:z.number().int().positive()}).strict()}).strict().refine(d=>new Set(d.variants.map(v=>v.key)).size===2,'Control and treatment required');
export type ExperimentDefinition=z.infer<typeof experimentSchema>;
export function assignVariant(experimentId:string,unitKey:string,variants:ExperimentDefinition['variants']){
 const n=createHash('sha256').update(`${experimentId}:${unitKey}`).digest().readUInt32BE(0)/4294967296;
 const total=variants.reduce((sum,v)=>sum+v.weight,0);let cutoff=0;for(const v of variants){cutoff+=v.weight/total;if(n<cutoff)return v.key;}return variants[variants.length-1]!.key;
}
export type BinaryGroup={n:number,success:number};
export function analyzeBinary(control:BinaryGroup,treatment:BinaryGroup,minimumSample=20,guardrailBreach=false,independent=true){
 // Deterministic posterior Monte Carlo: Beta(1,1) prior; no Math.random in published results.
 let seed=0x12345678;const uniform=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
 const normal=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
 const gamma=(shape:number):number=>{const d=shape-1/3,c=1/Math.sqrt(9*d);for(;;){const x=normal(),v=(1+c*x)**3;if(v<=0)continue;const u=uniform();if(u<1-.0331*x**4||Math.log(u)<.5*x*x+d*(1-v+Math.log(v)))return d*v;}};
 const beta=(g:BinaryGroup)=>{const a=gamma(1+g.success),b=gamma(1+g.n-g.success);return a/(a+b);};
 assert(control.success>=0&&control.success<=control.n&&treatment.success>=0&&treatment.success<=treatment.n,'INVALID_BINARY_COUNTS');
 const lifts=Array.from({length:8000},()=>beta(treatment)-beta(control)).sort((a,b)=>a-b),probability=lifts.filter(n=>n>0).length/lifts.length;
 const status=guardrailBreach?'GUARDRAIL_BREACH':Math.min(control.n,treatment.n)<minimumSample||!independent?'INSUFFICIENT_DATA':probability>=.975?'SUPPORTED':probability>=.8?'DIRECTIONAL':'INCONCLUSIVE';
 return {analysis:'INTENTION_TO_TREAT',controlN:control.n,treatmentN:treatment.n,controlRate:control.n?control.success/control.n:null,treatmentRate:treatment.n?treatment.success/treatment.n:null,absoluteLift:control.n&&treatment.n?treatment.success/treatment.n-control.success/control.n:null,credibleInterval:independent?[lifts[200],lifts[7799]]:null,probabilityTreatmentBetter:independent?probability:null,evidenceStatus:status,causality:'not_established',note:independent?'Beta(1,1), 95% posterior interval; mature assigned members, including delivery failures.':'Time-block observations are correlated; member-level posterior is withheld pending cluster analysis.'};
}
export function analyzeTimeBlocks(controlBlocks:BinaryGroup[],treatmentBlocks:BinaryGroup[],minimumSample=20,guardrailBreach=false){
 const total=(blocks:BinaryGroup[])=>blocks.reduce((a,b)=>({n:a.n+b.n,success:a.success+b.success}),{n:0,success:0});
 const control=total(controlBlocks),treatment=total(treatmentBlocks),base=analyzeBinary(control,treatment,minimumSample,guardrailBreach,false);
 if(!controlBlocks.length||!treatmentBlocks.length)return {...base,controlBlocks:controlBlocks.length,treatmentBlocks:treatmentBlocks.length};
 let seed=0x98765432;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
 const gamma=(shape:number):number=>{const d=shape-1/3,c=1/Math.sqrt(9*d);for(;;){const x=Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random()),v=(1+c*x)**3;if(v<=0)continue;const u=random();if(u<1-.0331*x**4||Math.log(u)<.5*x*x+d*(1-v+Math.log(v)))return d*v;}};
 // Independent blocks, Beta(1,1) block risks and Bayesian bootstrap block weights.
 // All members assigned to the same block remain together in every posterior draw.
 const draw=(blocks:BinaryGroup[])=>{let successes=0,n=0;for(const b of blocks){const a=gamma(b.success+1),failure=gamma(b.n-b.success+1),weight=-Math.log(random());successes+=weight*b.n*a/(a+failure);n+=weight*b.n;}return successes/n;};
 const lifts=Array.from({length:4000},()=>draw(treatmentBlocks)-draw(controlBlocks)).sort((a,b)=>a-b),p=lifts.filter(x=>x>0).length/lifts.length;
 const enough=Math.min(controlBlocks.length,treatmentBlocks.length)>=20&&Math.min(control.n,treatment.n)>=minimumSample;
 return {...base,controlBlocks:controlBlocks.length,treatmentBlocks:treatmentBlocks.length,credibleInterval:enough?[lifts[100],lifts[3899]]:null,probabilityTreatmentBetter:enough?p:null,evidenceStatus:guardrailBreach?'GUARDRAIL_BREACH':!enough?'INSUFFICIENT_DATA':p>=.975?'SUPPORTED':p>=.8?'DIRECTIONAL':'INCONCLUSIVE',note:'Block-level Beta(1,1) risks with Bayesian bootstrap weights. At least 20 mature blocks per arm. Assumes independent blocks; cross-block spillover and carryover can bias estimates.'};
}
export class ExperimentService {
 constructor(private readonly db:Database){}
 async assign(s:Scope,revisionId:string,episodeId:string,now=new Date()){
  return this.db.transaction().execute(async tx=>{
   const cfg=await new SettingsService(this.db).get(s,tx);assert(cfg.enabled&&cfg.flags.experiments_v2,'EXPERIMENTS_DISABLED');assert(await new EntitlementService(tx).can(s,'experiments'),'ENTITLEMENT_REQUIRED',403);
   const control=(await sql<{state:string}>`SELECT state FROM experiment_controls WHERE ${tenant(s)} AND revision_id=${revisionId}::uuid`.execute(tx)).rows[0];if(control&&control.state!=='running')return null;
   const existing=(await sql<{id:string,variant:string}>`SELECT id,variant FROM experiment_assignments WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND revision_id=${revisionId}::uuid`.execute(tx)).rows[0];if(existing)return existing;
   const row=(await sql<{definition:unknown}>`SELECT definition FROM guild_config_revisions WHERE ${tenant(s)} AND id=${revisionId}::uuid AND domain='experiment' AND state='published'`.execute(tx)).rows[0];assert(row,'EXPERIMENT_NOT_PUBLISHED');const d=experimentSchema.parse(row.definition);
   const ev=await evidence(tx,s,episodeId,now);if(!ev||!d.eligibility.every(c=>evaluateCondition(c,ev)===true))return null;
   const unit=d.randomization==='member'?episodeId:`block:${Math.floor(now.getTime()/(d.blockSeconds*1000))}`;
   const variant=assignVariant(revisionId,unit,d.variants),id=randomUUID();
   await sql`INSERT INTO experiment_assignments VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${episodeId}::uuid,${revisionId}::uuid,${variant},${unit},${now},${new Date(now.getTime()+d.windowSeconds*1000)}) ON CONFLICT DO NOTHING`.execute(tx);
   return (await sql<{id:string,variant:string}>`SELECT id,variant FROM experiment_assignments WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND revision_id=${revisionId}::uuid`.execute(tx)).rows[0]!;
  });
 }
 async deliverAssigned(s:Scope,revisionId:string,episodeId:string){
  const assignment=await this.assign(s,revisionId,episodeId);if(!assignment)return null;
  const row=(await sql<{definition:unknown}>`SELECT definition FROM guild_config_revisions WHERE ${tenant(s)} AND id=${revisionId}::uuid`.execute(this.db)).rows[0]!;
  const d=experimentSchema.parse(row.definition),variant=d.variants.find(v=>v.key===assignment.variant)!;
  if(!variant.interventionRevisionId)return {assignment,holdout:true};
  return {assignment,run:await new InterventionService(this.db).propose(s,variant.interventionRevisionId,episodeId,assignment.id)};
 }
 async result(s:Scope,revisionId:string,now=new Date()){
  const row=(await sql<{definition:unknown}>`SELECT definition FROM guild_config_revisions WHERE ${tenant(s)} AND id=${revisionId}::uuid AND domain='experiment' AND state='published'`.execute(this.db)).rows[0];assert(row,'EXPERIMENT_NOT_FOUND');const d=experimentSchema.parse(row.definition);
  const rows=(await sql<{id:string,episode_id:string,variant:string,unit_key:string,assigned_at:Date,window_end:Date}>`SELECT * FROM experiment_assignments WHERE ${tenant(s)} AND revision_id=${revisionId}::uuid`.execute(this.db)).rows;
  const mature=rows.filter(r=>r.window_end<=now),control:BinaryGroup={n:0,success:0},treatment:BinaryGroup={n:0,success:0};let left=0;
  const cfg=await new SettingsService(this.db).get(s),cutoff=Date.now()-cfg.detailedRetentionDays*86400000;
  const cursor=(await sql<{first_seen:Date,last_seen:Date}>`SELECT first_seen,last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db)).rows[0];
  const gaps=(await sql<{started_at:Date,ended_at:Date|null}>`SELECT started_at,ended_at FROM telemetry_health WHERE ${tenant(s)}`.execute(this.db)).rows.map(g=>({start:g.started_at.getTime(),end:g.ended_at?.getTime()??null}));
  const ratios:number[]=[];
  const blocks={control:new Map<string,BinaryGroup>(),treatment:new Map<string,BinaryGroup>()};
  for(const a of mature){
   const events=(await sql<{kind:string,occurred_at:Date}>`SELECT kind,occurred_at FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${a.episode_id}::uuid AND occurred_at>=${a.assigned_at} AND occurred_at<=${a.window_end} AND context='PRODUCTION'`.execute(this.db)).rows;
   const group=a.variant==='control'?control:treatment;group.n++;
   const key=d.primaryMetric==='activation'?'activation.completed':d.primaryMetric==='connection'?'reply.received':'message.sent';
   let success=events.some(e=>d.primaryMetric==='retention'?Boolean(canonicalSignal(e.kind)&&signalRegistry[canonicalSignal(e.kind)!].active)&&e.occurred_at.getTime()>=a.window_end.getTime()-86400000:e.kind===key),departed=events.some(e=>e.kind==='member.left');
   let observed=coverage(a.assigned_at.getTime(),a.window_end.getTime(),cursor?.first_seen.getTime()??null,cursor?.last_seen.getTime()??null,gaps,now.getTime());
   if(a.assigned_at.getTime()<cutoff){
    const saved=(await sql<{success:boolean,left_during_window:boolean,coverage_ratio:number}>`SELECT * FROM experiment_outcomes WHERE ${tenant(s)} AND assignment_id=${a.id}::uuid`.execute(this.db)).rows[0];
    success=saved?.success??false;departed=saved?.left_during_window??false;observed=saved?.coverage_ratio??0;
   }else if(observed===1){
    await sql`INSERT INTO experiment_outcomes VALUES(${s.organizationId}::uuid,${s.guildId},${a.id}::uuid,${success},${departed},${observed},2,${now}) ON CONFLICT(organization_id,guild_id,assignment_id) DO UPDATE SET success=EXCLUDED.success,left_during_window=EXCLUDED.left_during_window,coverage_ratio=EXCLUDED.coverage_ratio,evaluated_at=EXCLUDED.evaluated_at`.execute(this.db);
   }
   ratios.push(observed);if(success)group.success++;
   const map=a.variant==='control'?blocks.control:blocks.treatment,block=map.get(a.unit_key)??{n:0,success:0};block.n++;if(success)block.success++;map.set(a.unit_key,block);
   if(departed)left++;
  }
  const runs=(await sql<{state:string}>`SELECT r.state FROM intervention_runs r JOIN experiment_assignments a ON a.organization_id=r.organization_id AND a.guild_id=r.guild_id AND a.id=r.assignment_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND a.revision_id=${revisionId}::uuid`.execute(this.db)).rows;
  const failed=runs.filter(r=>r.state==='failed'||r.state==='unknown').length;
  const guardrails={leaveRate:mature.length?left/mature.length:null,deliveryFailureRate:runs.length?failed/runs.length:null,alertVolume:runs.filter(r=>r.state==='delivered').length};
  const breach=(guardrails.leaveRate??0)>d.guardrails.maxLeaveRate||(guardrails.deliveryFailureRate??0)>d.guardrails.maxFailureRate||guardrails.alertVolume>d.guardrails.maxAlerts;
  if(breach)await sql`INSERT INTO experiment_controls(organization_id,guild_id,revision_id,state) VALUES(${s.organizationId}::uuid,${s.guildId},${revisionId}::uuid,'paused') ON CONFLICT(organization_id,guild_id,revision_id) DO UPDATE SET state=CASE WHEN experiment_controls.state='stopped' THEN 'stopped' ELSE 'paused' END,updated_at=now()`.execute(this.db);
  const state=(await sql<{state:string}>`SELECT state FROM experiment_controls WHERE ${tenant(s)} AND revision_id=${revisionId}::uuid`.execute(this.db)).rows[0]?.state??'running';
  const ratio=ratios.length?Math.min(...ratios):0;
  const stats=d.randomization==='member'?analyzeBinary(control,treatment,d.minimumSample,breach):analyzeTimeBlocks([...blocks.control.values()],[...blocks.treatment.values()],d.minimumSample,breach);
  const result={...stats,...(ratio<1?{evidenceStatus:breach?'GUARDRAIL_BREACH':'INSUFFICIENT_DATA',credibleInterval:null,probabilityTreatmentBetter:null}:{}),dataCoverage:ratio===1?'healthy':ratio>0?'degraded':'unavailable',coverageRatio:ratio,assigned:rows.length,mature:mature.length,provisional:rows.length>mature.length,guardrails,randomization:d.randomization,state};
  await sql`INSERT INTO experiment_metric_results VALUES(${s.organizationId}::uuid,${s.guildId},${revisionId}::uuid,${now},${json(result)}) ON CONFLICT DO NOTHING`.execute(this.db);return result;
 }
 async control(s:Scope,actor:Actor,revisionId:string,state:'running'|'paused'|'stopped'){
  await this.db.transaction().execute(async tx=>{
   const cfg=await new SettingsService(this.db).get(s,tx);assert(canAdmin(actor.permissions,actor.roles,cfg.adminRoleId),'ADMIN_REQUIRED',403);
   const revision=(await sql`SELECT id FROM guild_config_revisions WHERE ${tenant(s)} AND id=${revisionId}::uuid AND domain='experiment' AND state='published'`.execute(tx)).rows[0];assert(revision,'EXPERIMENT_NOT_FOUND');
   const previous=(await sql<{state:string}>`SELECT state FROM experiment_controls WHERE ${tenant(s)} AND revision_id=${revisionId}::uuid FOR UPDATE`.execute(tx)).rows[0];assert(previous?.state!=='stopped'||state==='stopped','STOPPED_EXPERIMENT_IMMUTABLE');
   await sql`INSERT INTO experiment_controls(organization_id,guild_id,revision_id,state) VALUES(${s.organizationId}::uuid,${s.guildId},${revisionId}::uuid,${state}) ON CONFLICT(organization_id,guild_id,revision_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`.execute(tx);
   await audit(tx,s,actor,'experiment.'+state,{state:previous?.state??'running'},{id:revisionId,state});
  });
 }
}
