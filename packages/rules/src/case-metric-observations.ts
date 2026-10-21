import {randomUUID} from "node:crypto";
import {sql,tenant,json,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {canonicalRuleTimestamp,hashRuleValue,timestampMicros} from "./facts";
import {canonicalCaseHash} from "./case-engine";
import {encodeCaseValue,decodeCaseValue,type EncodedCaseValue} from "./case-storage";
import type {OperationalSourceField,OperationalSourceRequest} from "./operational-context-sources";
import type {Unit,Window,CohortMetadata} from "./case-types";

export interface NativeCaseMetric {fieldId:string;value:OperationalSourceField["value"];unit:Unit;expiresAt:string;window:Window;periodRole?:"CURRENT"|"PRIOR"|"CONTEXT";metricId?:string;cohort?:CohortMetadata;}
export interface NativeCaseRead {fields:NativeCaseMetric[];/** Includes exact native bindings and source clocks, no identity lists. */ source:unknown;}
interface Header {id:string;source_hash:string;captured_at:Date;captured_exact:string;expires_at:Date;}
type ValueRow={field_id:string;value_kind:EncodedCaseValue["kind"];integer_value:string|null;decimal_value:string|null;boolean_value:boolean|null;text_value:string|null;timestamp_value:Date|null;exact_timestamp:string|null;numerator:string|null;denominator:string|null;coverage:string|null;unit:Unit;source_expires_at:Date;metadata:{window:Window;periodRole?:OperationalSourceField["periodRole"];metricId?:string;cohort?:CohortMetadata}};
const iso=(date:Date)=>canonicalRuleTimestamp(date.toISOString());
/** A fresh bounded SQL observation is captured once. Its business window and
 * underlying ingest/source clocks are hashed separately. Revalidation uses
 * the original asOf and returns original clocks; neither read nor retry can
 * recapture or renew it. The caller already holds canonical scope locks. */
export async function observeCaseMetrics(tx:Tx,s:Scope,request:OperationalSourceRequest,config:unknown,read:(capturedAt:string,fresh:boolean)=>Promise<NativeCaseRead>):Promise<readonly OperationalSourceField[]>{
 const key=hashRuleValue({contract:"CASE_NATIVE_SQL_V1",caseId:request.caseId,target:request.target,...(request.rootTarget?{rootTarget:request.rootTarget}:{}),window:request.window,config});
 const header=(await sql<Header>`SELECT id,source_hash,captured_at,to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS captured_exact,expires_at FROM rule_case_metric_observations WHERE ${tenant(s)} AND context_id=${request.contextId}::uuid AND config_hash=${key}`.execute(tx)).rows[0];
 if(header&&timestampMicros(iso(header.expires_at))<=timestampMicros(request.evaluationAsOf))return [];
 if(!header&&request.phase==="VALIDATE")return [];
 const capturedAt=header?canonicalRuleTimestamp(header.captured_exact):canonicalRuleTimestamp(request.evaluationAsOf),native=await read(capturedAt,!header);
 assert(native.fields.length<=12&&new Set(native.fields.map(value=>value.fieldId)).size===native.fields.length,"CASE_NATIVE_SOURCE_LIMIT",409);
 if(!native.fields.length)return [];
 // Date-valued DB metadata is explicitly serialized before canonical hashing;
 // the case codec permits finite fractional elapsed seconds (rule-only integer
 // canonical JSON deliberately does not). No raw identity set is retained.
 const sourceHash=canonicalCaseHash(JSON.parse(JSON.stringify({fields:native.fields.map(({expiresAt:_expiresAt,...value})=>value).sort((a,b)=>a.fieldId.localeCompare(b.fieldId)),source:native.source})));
 if(header&&header.source_hash!==sourceHash)return [];
 let saved=header;
 if(!saved){
  assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);
  const retained=(await sql`SELECT id FROM rule_case_metric_observations WHERE ${tenant(s)} AND context_id=${request.contextId}::uuid LIMIT 64`.execute(tx)).rows;
  assert(retained.length<64,"CASE_NATIVE_SNAPSHOT_LIMIT",409);
  const parent=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_operational_contexts WHERE ${tenant(s)} AND id=${request.contextId}::uuid`.execute(tx)).rows[0];
  const expiry=new Date(Math.min(Date.parse(capturedAt)+48*3600000,...(request.captureExpiresAt?[Date.parse(request.captureExpiresAt)]:[]),...(parent?[parent.expires_at.getTime()]:[]),...native.fields.map(value=>Date.parse(value.expiresAt))));
  if(!Number.isFinite(expiry.getTime())||expiry<=new Date(request.evaluationAsOf))return [];
  await request.beforeWrite();
  saved={id:randomUUID(),source_hash:sourceHash,captured_at:new Date(capturedAt),captured_exact:capturedAt,expires_at:expiry};
  await sql`INSERT INTO rule_case_metric_observations(organization_id,guild_id,id,context_id,config_hash,source_hash,captured_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${saved.id}::uuid,${request.contextId}::uuid,${key},${sourceHash},${capturedAt}::timestamptz,${expiry})`.execute(tx);
  for(const field of native.fields){
   const value=encodeCaseValue(field.value,field.unit);assert(value.kind!=="NULL","CASE_NATIVE_VALUE_MISSING",500);
   const metadata={window:field.window,...(field.periodRole?{periodRole:field.periodRole}:{}),...(field.metricId?{metricId:field.metricId}:{}),...(field.cohort?{cohort:field.cohort}:{})};
   await request.beforeWrite();
   await sql`INSERT INTO rule_case_metric_values(organization_id,guild_id,observation_id,field_id,value_kind,integer_value,decimal_value,boolean_value,text_value,timestamp_value,numerator,denominator,coverage,unit,source_expires_at,metadata) VALUES(${s.organizationId}::uuid,${s.guildId},${saved.id}::uuid,${field.fieldId},${value.kind},${value.integer}::numeric,${value.decimal}::numeric,${value.boolean},${value.text},${value.timestamp}::timestamptz,${value.numerator}::numeric,${value.denominator}::numeric,${value.coverage}::numeric,${field.unit},${field.expiresAt}::timestamptz,${json(metadata)})`.execute(tx);
  }
 }
 const rows=(await sql<ValueRow>`SELECT *,to_char(timestamp_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact_timestamp FROM rule_case_metric_values WHERE ${tenant(s)} AND observation_id=${saved.id}::uuid ORDER BY field_id`.execute(tx)).rows;
 assert(rows.length===native.fields.length,"CASE_NATIVE_SNAPSHOT_INCOMPLETE",409);
 const snapshot=saved;
 return rows.map<OperationalSourceField>(row=>{
  const value=decodeCaseValue({kind:row.value_kind,integer:row.integer_value,decimal:row.decimal_value,boolean:row.boolean_value,text:row.text_value,timestamp:row.exact_timestamp,numerator:row.numerator,denominator:row.denominator,coverage:row.coverage}),current=native.fields.find(entry=>entry.fieldId===row.field_id);
  assert(current&&canonicalCaseHash({fieldId:row.field_id,value,unit:row.unit,...row.metadata})===canonicalCaseHash((({expiresAt:_expiresAt,...rest})=>rest)(current)),"CASE_NATIVE_SNAPSHOT_VALUE_MISMATCH",409);
  return {fieldId:row.field_id,value,quality:"SUFFICIENT",unit:row.unit,sourceKind:"SYSTEM_OBSERVATION",observedAt:canonicalRuleTimestamp(snapshot.captured_exact),expiresAt:iso(new Date(Math.min(snapshot.expires_at.getTime(),row.source_expires_at.getTime(),Date.parse(current.expiresAt)))),sourceRevision:snapshot.source_hash,sourceReference:`case-native:${snapshot.id}`,...row.metadata};
 });
}
/** Child EAV rows cascade before the source header. Context deletion cascades
 * both in the existing context purpose; no independent retention is created. */
export async function expireCaseMetricObservations(tx:Tx,s:Scope,now:Date){return sql`DELETE FROM rule_case_metric_observations WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);}
export async function purgeCaseMetricObservations(tx:Tx,s:Scope){return sql`DELETE FROM rule_case_metric_observations WHERE ${tenant(s)}`.execute(tx);}
