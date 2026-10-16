import {sql,tenant,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {SettingsService,type Actor} from "../../settings/src/index";
import {operationsAccess} from "../../operations/src/policy";
import {Reports} from "../../operations/src/reports";
import {canonicalRuleTimestamp,hashRuleValue,immutableSourceHealthId,timestampMicros,type FactValue,type SourceHealthObservation} from "./facts";
import type {NativeProjectionCandidate} from "./native-projections";
import type {NativeSourceRequest} from "./native-source-request";
const iso=(at:Date)=>canonicalRuleTimestamp(at.toISOString());
const minimum=(...values:string[])=>values.reduce((a,b)=>timestampMicros(a)<=timestampMicros(b)?a:b);
const maximum=(...values:string[])=>values.reduce((a,b)=>timestampMicros(a)>=timestampMicros(b)?a:b);
const bounded=(at:Date,seconds:number)=>iso(new Date(at.getTime()+seconds*1000));
export interface NativeReportDeliveryRow {id:string;actionId:string|null;deliveryId:string|null;actionState:string|null;deliveryState:string|null;}
export function nativeReportDeliveryOutcomes(rows:readonly NativeReportDeliveryRow[]):Extract<FactValue,{kind:"outcomes"}>{
 assert(rows.length<=2000&&new Set(rows.map(row=>row.id)).size===rows.length,"RULE_NATIVE_REPORT_ROWS_INVALID");
 const result={succeeded:0n,failed:0n,unknown:0n,cancelled:0n,unfinished:0n,expired:0n};
 for(const row of rows){
  if(row.actionId&&row.deliveryId)throw new Error("RULE_NATIVE_DELIVERY_AMBIGUOUS");
  if(!row.actionId&&!row.deliveryId){result.unfinished++;continue;}
  const state=row.actionId?row.actionState:row.deliveryState;
  if(state==="SUCCEEDED")result.succeeded++;else if(state==="FAILED")result.failed++;
  else if(state==="UNKNOWN"||state===null)result.unknown++;
  else if(state==="PENDING"||state==="RUNNING"||state==="PAUSED_PLAN_LIMIT")result.unfinished++;
  else throw new Error("RULE_NATIVE_DELIVERY_STATE_UNVERIFIED");
 }
 return {kind:"outcomes",succeeded:String(result.succeeded),failed:String(result.failed),unknown:String(result.unknown),cancelled:String(result.cancelled),unfinished:String(result.unfinished),expired:String(result.expired)};
}
interface ReportRow extends NativeReportDeliveryRow {scheduled_at:Date;requested_at:Date;state:string;template_revision:number|null;binding_id:string|null;binding_hash:string|null;binding_reference_hash:string|null;outbound_created_at:Date|null;outbound_observed_at:Date|null;generated_at:Date|null;generated_source_expires_at:Date|null;definition_revision_id:string|null;definition_content_hash:string|null;definition_reference_hash:string|null;}
/** Template configuration lineage and native delivery retention are separate
 * from the new 48h generation observation. An expired generation observation
 * cannot erase a retained confirmed delivery or become a successful timestamp. */
export async function readNativeReportProjection(tx:Tx,s:Scope,actor:Actor,request:Extract<NativeSourceRequest,{kind:"REPORT_DELIVERY"|"REPORT_GENERATION_STATE"}>,asOf:string):Promise<NativeProjectionCandidate[]>{
 await operationsAccess(tx,s,actor,"ANALYZE","scheduled_reports");
 const generation=request.kind==="REPORT_GENERATION_STATE",fallback={targetType:"REPORT_DEFINITION",targetId:request.scheduleId,liveVersion:String(request.liveRevision)};
 const base={sourceType:"ReportOperationalStatusAdapter",metricId:generation?"REPORT.GENERATION_DUE_STATE":"REPORT.DELIVERY_RESULT_COUNTS",target:fallback,value:null,observedAt:asOf,expiresAt:null,sourceRevision:"unavailable",windowStart:generation?iso(new Date(Date.parse(asOf)-1)):request.windowStart,windowEnd:generation?asOf:request.windowEnd,periodRole:generation?"CURRENT" as const:request.periodRole,sampleSize:null,sealable:false} as const;
 const unknown=(reason:string):NativeProjectionCandidate[]=>[{...base,reasonCodes:[reason]}];
 const schedule=(await sql<{revision:number;template_id:string;next_at:Date;timezone:string;state:string}>`SELECT revision,template_id,next_at,timezone,state FROM report_schedules WHERE ${tenant(s)} AND id=${request.scheduleId}::uuid`.execute(tx)).rows[0];
 if(!schedule||schedule.revision!==request.liveRevision||schedule.state!=="ENABLED")return unknown("NATIVE_LIVE_REVISION_MISMATCH");
 const current=await new Reports(tx).currentDefinitionInTransaction(tx,s,schedule.template_id);
 if(!current.bindingVerified||!current.definitionRevisionId)return unknown("REPORT_NATIVE_DEFINITION_BINDING_UNAVAILABLE");
 const target={targetType:"REPORT_DEFINITION",targetId:current.templateId,liveVersion:current.liveVersion};
 const cfg=await new SettingsService(tx).get(s,tx),from=generation?iso(new Date(Date.parse(asOf)-cfg.detailedRetentionDays*86400000)):request.windowStart,to=generation?asOf:request.windowEnd;
 if(timestampMicros(from)>=timestampMicros(to)||timestampMicros(to)>timestampMicros(asOf)||!generation&&timestampMicros(from)<=timestampMicros(asOf)-BigInt(cfg.detailedRetentionDays)*86400000000n)return unknown("REPORT_NATIVE_WINDOW_EXCEEDS_RETAINED_COVERAGE");
 // Each target is the current immutable template binding. A retained Run of
 // another template revision belongs to that other target, not this census.
 const rows=(await sql<ReportRow>`SELECT r.id,r.scheduled_at,r.requested_at,r.state,r.template_revision,r.action_id AS "actionId",r.delivery_id AS "deliveryId",a.state AS "actionState",d.state AS "deliveryState",b.definition_revision_id AS binding_id,b.content_hash AS binding_hash,b.reference_hash AS binding_reference_hash,
 COALESCE(a.created_at,e.created_at) AS outbound_created_at,COALESCE(a.completed_at,a.updated_at,d.completed_at,e.created_at) AS outbound_observed_at,
 r.generated_at,r.generated_source_expires_at,r.definition_revision_id,r.definition_content_hash,r.definition_reference_hash
 FROM report_runs r LEFT JOIN report_template_definition_bindings b ON b.organization_id=r.organization_id AND b.guild_id=r.guild_id AND b.template_id=${current.templateId}::uuid AND b.template_revision=r.template_revision
 LEFT JOIN action_outbox a ON a.organization_id=r.organization_id AND a.guild_id=r.guild_id AND a.id=r.action_id
 LEFT JOIN webhook_deliveries d ON d.organization_id=r.organization_id AND d.guild_id=r.guild_id AND d.id=r.delivery_id
 LEFT JOIN operations_domain_events e ON e.organization_id=d.organization_id AND e.guild_id=d.guild_id AND e.id=d.event_id
 WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.schedule_id=${request.scheduleId}::uuid AND r.schedule_revision=${request.liveRevision} AND r.template_revision=${current.templateRevision} AND r.run_kind='SCHEDULED' AND r.scheduled_at>=${from}::timestamptz AND r.scheduled_at<${to}::timestamptz ORDER BY r.id LIMIT 2001`.execute(tx)).rows;
 if(rows.length>2000)return unknown("NATIVE_SOURCE_LIMIT_EXCEEDED");
 if(rows.some(row=>row.binding_id!==current.definitionRevisionId||row.binding_hash!==current.contentHash||row.binding_reference_hash!==current.referenceHash||row.template_revision!==current.templateRevision))return unknown("REPORT_RUN_IMMUTABLE_DEFINITION_MAPPING_UNVERIFIED");
 const comparison={cohortDefinitionVersion:hashRuleValue({scheduleId:request.scheduleId,revision:schedule.revision,definitionId:current.definitionRevisionId,content:current.contentHash,references:current.referenceHash}),campaignClass:"NATIVE_SCHEDULED_REPORTS",maturityOffset:"0",windowKind:"ELAPSED" as const,timeZone:schedule.timezone,cohortId:hashRuleValue({templateId:current.templateId,scheduleId:request.scheduleId})};
 let value:FactValue,observedAt:string,expiry:string;
 if(generation){
  const latest=[...rows].sort((a,b)=>b.scheduled_at.getTime()-a.scheduled_at.getTime())[0];
  if(!latest)return unknown("REPORT_GENERATION_NATIVE_OBSERVATION_UNAVAILABLE");
  const generated=rows.filter(row=>row.generated_at&&row.generated_source_expires_at&&row.generated_source_expires_at.getTime()>Date.parse(asOf)&&row.generated_at.getTime()<=Date.parse(asOf)&&row.definition_revision_id===current.definitionRevisionId&&row.definition_content_hash===current.contentHash&&row.definition_reference_hash===current.referenceHash);
  if(latest.generated_at&&!generated.includes(latest)||!latest.generated_at&&!["PENDING","RUNNING","FAILED"].includes(latest.state))return unknown("REPORT_GENERATION_SUCCESS_TIME_MISSING_OR_EXPIRED");
  const dueAt=schedule.next_at.getTime()<=Date.parse(asOf)?schedule.next_at:latest.scheduled_at;
  value={kind:"generation",dueAt:iso(dueAt),lastSuccessAt:generated.length?maximum(...generated.map(row=>iso(row.generated_at!))):null};
  observedAt=maximum(iso(latest.requested_at),...generated.map(row=>iso(row.generated_at!)));
  expiry=minimum(bounded(new Date(observedAt),48*3600),bounded(latest.requested_at,cfg.detailedRetentionDays*86400),...generated.map(row=>iso(row.generated_source_expires_at!)));
 }else{
  // Failed generation with no outbound identity never counts as delivery
  // failure. Missing referenced outbound records remain UNKNOWN/partial.
  const outbound=rows.filter(row=>row.actionId||row.deliveryId);
  if(!outbound.length)return unknown("REPORT_DELIVERY_NO_NATIVE_OUTBOUND_OBSERVATION");
  if(outbound.some(row=>!row.outbound_created_at||!row.outbound_observed_at))return unknown("REPORT_DELIVERY_ORIGINAL_RECORD_MISSING");
  if(outbound.some(row=>row.outbound_observed_at!.getTime()>Date.parse(asOf)))return unknown("REPORT_DELIVERY_OBSERVATION_AFTER_AS_OF");
  try{value=nativeReportDeliveryOutcomes(outbound);}catch{return unknown("NATIVE_DELIVERY_STATE_OR_IDENTITY_UNVERIFIED");}
  observedAt=maximum(...outbound.map(row=>iso(row.outbound_observed_at!)));
  expiry=minimum(bounded(new Date(asOf),48*3600),...outbound.map(row=>bounded(row.outbound_created_at!,cfg.detailedRetentionDays*86400)),...rows.map(row=>bounded(row.requested_at,cfg.detailedRetentionDays*86400)));
 }
 if(timestampMicros(observedAt)>timestampMicros(asOf)||timestampMicros(expiry)<=timestampMicros(asOf))return unknown("REPORT_NATIVE_OBSERVATION_EXPIRED_OR_FUTURE");
 const sourceRevision=hashRuleValue({target,scheduleId:request.scheduleId,definitionId:current.definitionRevisionId,templateRevision:current.templateRevision,scheduleRevision:schedule.revision,windowStart:base.windowStart,windowEnd:base.windowEnd,value});
 const health:SourceHealthObservation={observationId:immutableSourceHealthId(s,base.sourceType,sourceRevision,asOf,target),revision:sourceRevision,sourceType:base.sourceType,observedAt:asOf,expiresAt:expiry,quality:"SUFFICIENT",state:"HEALTHY",lastSuccessfulIngestAt:observedAt,neverSucceeded:false,coverage:"1",target};
 if(timestampMicros(health.expiresAt)<=timestampMicros(asOf))return unknown("REPORT_NATIVE_HEALTH_OBSERVATION_EXPIRED");
 return [{...base,target,value,observedAt:generation?observedAt:asOf,expiresAt:expiry,sourceRevision,sampleSize:String(rows.length),sealable:true,reasonCodes:[],...(!generation?{comparison}:{}),generatedHealth:[health]}];
}
