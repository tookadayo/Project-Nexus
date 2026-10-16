import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql,tenant,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {canonicalCaseHash,normalizeCaseTimestamp,validCohortWindow} from "./case-engine";
import {retentionExpiry,type PlatformPolicy} from "./domain";
import {ALPHA16_RETENTION_CONTRACT} from "./retention-contract";
import {CASE_CATALOG} from "./catalog";
import type {CaseRegistry,CaseValue,DecisionContext,EvaluationProfile,Observation,Scalar,Unit} from "./case-types";

const name=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),stamp=z.string().refine(value=>{try{normalizeCaseTimestamp(value);return true;}catch{return false;}});
const unit=z.enum(["state","boolean","count","ratio","seconds","minutes","instant","identifier"]),quality=z.enum(["SUFFICIENT","PARTIAL","STALE","MISSING","SUPPRESSED","UNKNOWN"]);
const window=z.object({start:stamp,end:stamp}).strict().refine(value=>normalizeCaseTimestamp(value.start)<normalizeCaseTimestamp(value.end));
const target=z.object({targetType:name,targetId:name,liveVersion:name.nullable()}).strict();
const versions=z.object({catalog:name,rule:name,engine:name,config:name,schema:name,branch:name,action:name,explanation:name}).strict();
const cohort=z.object({cohortId:name,cohortClass:z.enum(["NEW","ESTABLISHED","EVENT"]),cohortDefinitionVersion:name,campaignClass:name,maturityOffset:z.number().finite(),maturityWindowSeconds:z.number().int().positive(),metricWindowSeconds:z.number().int().positive(),joinWindow:window,windowContractId:name.optional(),windowKind:z.enum(["ELAPSED","CALENDAR_DAY"]),timeZone:z.string().min(1).max(128).regex(/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/),calendarDays:z.number().int().min(1).max(366).optional(),calendarStartDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),calendarEndDateExclusive:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),resolvedCalendar:z.object({start:stamp,end:stamp,boundaryRule:z.literal("firstValidEarlier"),rulesVersion:name,confirmed:z.literal(true)}).strict().optional()}).strict();
const scope=z.object({guildId:z.string().regex(/^\d{5,30}$/),targetType:name,targetId:name,liveVersion:name.nullable().optional(),permissions:z.array(name).max(32)}).strict();
const observationMetadata=z.object({observationId:name,quality,unit,sourceId:name,sourceRevision:name,sourceKind:z.enum(["OPERATOR","SYSTEM_OBSERVATION"]),observedAt:stamp,expiresAt:stamp,authorityScope:scope,periodRole:z.enum(["CURRENT","PRIOR","CONTEXT"]),window,metricId:name.optional(),cohort:cohort.optional()}).strict();
const healthSchema=z.object({observationId:name,sourceId:name,revision:name,quality,authorized:z.boolean(),observedAt:stamp,expiresAt:stamp}).strict();
const contextMetadata=z.object({contextId:name,guildId:z.string().regex(/^\d{5,30}$/),evaluationAsOf:stamp,target,rootTrigger:z.object({kind:z.enum(["BASE_RULE_RESULT","AUTHORIZED_OPERATIONAL_CONTEXT"]),ruleId:name.optional(),outcome:z.enum(["FIRE","NO_FIRE","INELIGIBLE","DISABLED"]).optional(),sourceId:name.optional(),ruleResultRef:z.object({ruleId:name,ruleVersion:name,target,window,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict(),permissions:z.array(name).max(32),versions,window,scopeActive:z.boolean(),tombstoned:z.boolean(),cancelled:z.boolean(),evaluationComplete:z.boolean(),deadlineAt:stamp,audience:z.enum(["GUILD_AUTHORIZED","RESTRICTED_STAFF"]).optional()}).strict();
const profileMetadata=z.object({id:name,revision:name,kind:z.enum(["SYNTHETIC_FIXTURE","OPERATIONAL"]),approved:z.boolean(),retentionApproved:z.boolean(),budget:z.object({maxDepth:z.number().int().positive(),maxSteps:z.number().int().positive(),maxOperations:z.number().int().positive(),maxInputs:z.number().int().positive()}).strict(),metricConfigs:z.record(name,z.object({revision:name,minN:z.number().int().positive(),minCoverage:z.number().min(0).max(1)}).strict())}).strict();
const registrySchema=z.object({version:name,sources:z.array(z.object({id:name,confirmed:z.boolean(),codeRefs:z.array(z.string().max(512)).max(32),requiredPermissions:z.array(name).max(32),purpose:z.string().max(1024)}).strict()).max(64),targetTypes:z.array(name).max(64)}).strict();
export interface CaseSnapshotInput {caseId:string;context:DecisionContext;profile:EvaluationProfile;registry:CaseRegistry;}
export interface CaseContextRef {snapshotId:string;caseId:string;revision:string;contentHash:string;profileHash:string;registryHash:string;expiresAt:string;}
export interface SealedCaseRequest extends CaseSnapshotInput {seal:CaseContextRef;}
export interface CaseContextAdapter {
 id:string;revision:string;confirmed:boolean;
 /** Only source metadata; preparation never creates or substitutes a snapshot. */
 expiresAt(tx:Tx,s:Scope):Promise<Date>;
 /** Internal trusted adapter only. No browser route accepts this value. */
 read(tx:Tx,s:Scope,envelope:{evaluationAsOf:string;versions:DecisionContext["versions"];permissions:string[];requestedCaseIds?:readonly string[];requestedContextIds?:readonly string[]}):Promise<readonly CaseSnapshotInput[]>;
}
export interface CaseRuntimeConfiguration {approved:boolean;aggregateBudget:{maxSteps:number;maxOperations:number;maxInputs:number};adapters:readonly CaseContextAdapter[];}
export interface EncodedCaseValue {kind:"NULL"|"INTEGER"|"DECIMAL"|"BOOLEAN"|"ENUM"|"IDENTIFIER"|"TIMESTAMP"|"COHORT";integer:string|null;decimal:string|null;boolean:boolean|null;text:string|null;timestamp:string|null;numerator:string|null;denominator:string|null;coverage:string|null;}
/** Only bounded states/identities and typed numeric components cross this codec. */
export function encodeCaseValue(value:CaseValue,valueUnit:Unit):EncodedCaseValue{
 const encoded:EncodedCaseValue={kind:"NULL",integer:null,decimal:null,boolean:null,text:null,timestamp:null,numerator:null,denominator:null,coverage:null};
 if(value===null)return encoded;
 if(typeof value==="boolean"){assert(valueUnit==="boolean","CASE_VALUE_TYPE");return {...encoded,kind:"BOOLEAN",boolean:value};}
 if(typeof value==="number"){assert(Number.isFinite(value)&&["count","ratio","seconds","minutes"].includes(valueUnit)&&(valueUnit!=="count"||Number.isSafeInteger(value)&&value>=0),"CASE_VALUE_TYPE");return Number.isSafeInteger(value)?{...encoded,kind:"INTEGER",integer:String(value)}:{...encoded,kind:"DECIMAL",decimal:String(value)};}
 if(typeof value==="string"){
  if(valueUnit==="instant")return {...encoded,kind:"TIMESTAMP",timestamp:normalizeCaseTimestamp(value)};
  name.parse(value);assert(valueUnit==="identifier"||valueUnit==="state","CASE_VALUE_TYPE");return {...encoded,kind:valueUnit==="identifier"?"IDENTIFIER":"ENUM",text:value};
 }
 assert(valueUnit==="ratio"&&Object.keys(value).length===3&&Object.keys(value).every(key=>["numerator","denominator","coverage"].includes(key))&&Number.isSafeInteger(value.numerator)&&Number.isSafeInteger(value.denominator)&&value.numerator>=0&&value.denominator>=value.numerator&&Number.isFinite(value.coverage)&&value.coverage>=0&&value.coverage<=1,"CASE_VALUE_TYPE");
 return {...encoded,kind:"COHORT",numerator:String(value.numerator),denominator:String(value.denominator),coverage:String(value.coverage)};
}
const number=(value:string|null):number=>{assert(value!==null&&Number.isFinite(Number(value)),"CASE_VALUE_TYPE");return Number(value);};
export function decodeCaseValue(value:EncodedCaseValue):CaseValue{
 if(value.kind==="NULL")return null;
 if(value.kind==="INTEGER"){const result=number(value.integer);assert(Number.isSafeInteger(result),"CASE_VALUE_TYPE");return result;}
 if(value.kind==="DECIMAL")return number(value.decimal);
 if(value.kind==="BOOLEAN"){assert(typeof value.boolean==="boolean","CASE_VALUE_TYPE");return value.boolean;}
 if(value.kind==="TIMESTAMP"){assert(value.timestamp,"CASE_VALUE_TYPE");return normalizeCaseTimestamp(value.timestamp);}
 if(value.kind==="ENUM"||value.kind==="IDENTIFIER"){name.parse(value.text);return value.text!;}
 const result={numerator:number(value.numerator),denominator:number(value.denominator),coverage:number(value.coverage)};encodeCaseValue(result,"ratio");return result;
}
const minimum=(values:readonly string[])=>{assert(values.length>0,"CASE_EVIDENCE_REQUIRED");return values.map(normalizeCaseTimestamp).sort()[0]!;};
/** Runtime validation is shared by initial persistence and every reconstruction. */
export function validateCaseSnapshot(input:CaseSnapshotInput):void{
 name.parse(input.caseId);const {fields,sourceHealth,...meta}=input.context;contextMetadata.parse(meta);registrySchema.parse(input.registry);
 const {values,...profile}=input.profile;profileMetadata.parse(profile);
 assert(Object.keys(fields).length<=2000&&sourceHealth.length<=64&&new Set(sourceHealth.map(h=>h.sourceId)).size===sourceHealth.length,"CASE_CONTEXT_SCHEMA");
 for(const [id,observation] of Object.entries(fields)){name.parse(id);const {value,...metadata}=observation;observationMetadata.parse(metadata);encodeCaseValue(value,observation.unit);}
 sourceHealth.forEach(h=>healthSchema.parse(h));
 for(const [id,value] of Object.entries(values)){name.parse(id);unit.parse(value.unit);assert(encodeCaseValue(value.value,value.unit).kind!=="COHORT","CASE_PROFILE_SCHEMA");}
}
export function caseSnapshotHash(input:CaseSnapshotInput):string{validateCaseSnapshot(input);return canonicalCaseHash({caseId:input.caseId,context:{...input.context,sourceHealth:[...input.context.sourceHealth].sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0)},profile:input.profile,registry:input.registry});}
/** FACT policy is anchored to each original observation, never the retry time. */
export async function persistCaseContext(tx:Tx,s:Scope,input:CaseSnapshotInput,now:Date,policy:PlatformPolicy|undefined,adapterConfirmed=false):Promise<CaseContextRef>{
 assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);assert(adapterConfirmed,"SOURCE_ADAPTER_NOT_CONFIRMED",409);validateCaseSnapshot(input);
 assert(input.context.guildId===s.guildId,"CASE_CONTEXT_SCOPE",403);
 assert(input.profile.kind==="OPERATIONAL"&&input.profile.approved&&input.profile.retentionApproved,"CASE_PROFILE_NOT_OPERATIONAL",409);
 const observations=Object.values(input.context.fields),health=input.context.sourceHealth;
 const expiries=[...observations,...health].flatMap(item=>[item.expiresAt,retentionExpiry(policy,"FACT",new Date(item.observedAt)).toISOString()]);
 const definition=CASE_CATALOG.find(c=>c.id===input.caseId);assert(definition,"CASE_NOT_REGISTERED",409);
 assert(Object.keys(input.context.fields).every(id=>definition.fields.some(f=>(f.observationField??f.id)===id)),"CASE_FIELD_NOT_REGISTERED",409);
 for(const [id,observation] of Object.entries(input.context.fields)){
  const field=definition.fields.find(f=>(f.observationField??f.id)===id)!;
  assert(observation.authorityScope.guildId===s.guildId&&observation.authorityScope.targetType===input.context.target.targetType&&observation.authorityScope.targetId===input.context.target.targetId&&(observation.authorityScope.liveVersion??null)===input.context.target.liveVersion,"CASE_CONTEXT_SCOPE",403);
  assert(observation.sourceId===field.sourceId&&observation.unit===(field.projection?"ratio":field.unit),"CASE_SOURCE_SCOPE",403);
  assert(normalizeCaseTimestamp(observation.observedAt)<=normalizeCaseTimestamp(input.context.evaluationAsOf),"CASE_OBSERVATION_IN_FUTURE",409);
  if(observation.cohort)assert(validCohortWindow(observation,true),"CASE_CALENDAR_WINDOW_INVALID",409);
 }
 assert(input.context.sourceHealth.every(h=>definition.sourceMappings.some(source=>source.id===h.sourceId)&&normalizeCaseTimestamp(h.observedAt)<=normalizeCaseTimestamp(input.context.evaluationAsOf)),"CASE_SOURCE_SCOPE",403);
 const expiresAt=minimum([...expiries,input.context.deadlineAt,new Date(now.getTime()+ALPHA16_RETENTION_CONTRACT.factSnapshot.maximumSeconds*1000).toISOString()]);assert(expiresAt>normalizeCaseTimestamp(now.toISOString()),"CASE_EVIDENCE_EXPIRED",409);
 const snapshotId=randomUUID(),contentHash=caseSnapshotHash(input),profileHash=canonicalCaseHash(input.profile),registryHash=canonicalCaseHash(input.registry),revision=definition.revision;
 const {fields,sourceHealth,...context}=input.context,{values,...profile}=input.profile;
 await sql`INSERT INTO rule_case_contexts(organization_id,guild_id,id,case_id,revision,content_hash,evaluation_as_of,target_type,target_id,live_version,window_start,window_end,context_metadata,profile_metadata,registry_metadata,profile_hash,registry_hash,captured_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${input.caseId},${revision},${contentHash},${context.evaluationAsOf}::timestamptz,${context.target.targetType},${context.target.targetId},${context.target.liveVersion},${context.window.start}::timestamptz,${context.window.end}::timestamptz,${JSON.stringify(context)}::jsonb,${JSON.stringify(profile)}::jsonb,${JSON.stringify(input.registry)}::jsonb,${profileHash},${registryHash},${now},${expiresAt}::timestamptz)`.execute(tx);
 for(const [id,observation] of Object.entries(fields)){
  const {value,...metadata}=observation,c=encodeCaseValue(value,observation.unit);
  await sql`INSERT INTO rule_case_observations(organization_id,guild_id,context_id,field_id,metadata,value_kind,integer_value,decimal_value,boolean_value,enum_value,timestamp_value,numerator,denominator,coverage) VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${id},${JSON.stringify(metadata)}::jsonb,${c.kind},${c.integer}::bigint,${c.decimal}::numeric,${c.boolean},${c.text},${c.timestamp}::timestamptz,${c.numerator}::bigint,${c.denominator}::bigint,${c.coverage}::numeric)`.execute(tx);
 }
 for(const h of sourceHealth)await sql`INSERT INTO rule_case_source_health VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${h.sourceId},${h.observationId},${h.revision},${JSON.stringify(h)}::jsonb)`.execute(tx);
 for(const [id,value] of Object.entries(values)){const c=encodeCaseValue(value.value,value.unit);await sql`INSERT INTO rule_case_profile_values VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${id},${value.unit},${c.kind},${c.integer}::bigint,${c.decimal}::numeric,${c.boolean},${c.text},${c.timestamp}::timestamptz)`.execute(tx);}
 return {snapshotId,caseId:input.caseId,revision,contentHash,profileHash,registryHash,expiresAt};
}
interface ValueRow {field_id?:string;config_key?:string;metadata?:Omit<Observation,"value">;unit?:Unit;value_kind:EncodedCaseValue["kind"];integer_value:string|null;decimal_value:string|null;boolean_value:boolean|null;enum_value:string|null;timestamp_value:string|null;numerator?:string|null;denominator?:string|null;coverage?:string|null;}
const decodeRow=(row:ValueRow)=>decodeCaseValue({kind:row.value_kind,integer:row.integer_value,decimal:row.decimal_value,boolean:row.boolean_value,text:row.enum_value,timestamp:row.timestamp_value,numerator:row.numerator??null,denominator:row.denominator??null,coverage:row.coverage??null});
const pgStamp=(column:string)=>sql.raw(`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
export async function loadCaseContexts(tx:Tx,s:Scope,refs:readonly CaseContextRef[],evaluationAsOf:string):Promise<SealedCaseRequest[]>{
 assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);assert(refs.length<=20&&new Set(refs.map(ref=>ref.caseId)).size===refs.length,"CASE_CONTEXT_SCHEMA");
 const output:SealedCaseRequest[]=[];
 for(const ref of refs){
  z.uuid().parse(ref.snapshotId);
  const row=(await sql<{case_id:string;revision:string;content_hash:string;context_metadata:Omit<DecisionContext,"fields"|"sourceHealth">;profile_metadata:Omit<EvaluationProfile,"values">;registry_metadata:CaseRegistry;profile_hash:string;registry_hash:string;evaluation_as_of:string;expires_at:string;target_type:string;target_id:string;live_version:string|null;window_start:string;window_end:string}>`SELECT *,${pgStamp("evaluation_as_of")} AS evaluation_as_of,${pgStamp("expires_at")} AS expires_at,${pgStamp("window_start")} AS window_start,${pgStamp("window_end")} AS window_end FROM rule_case_contexts WHERE ${tenant(s)} AND id=${ref.snapshotId}::uuid AND revision=${ref.revision} AND expires_at>clock_timestamp()`.execute(tx)).rows[0];
  assert(row&&row.case_id===ref.caseId&&row.content_hash===ref.contentHash&&row.profile_hash===ref.profileHash&&row.registry_hash===ref.registryHash&&normalizeCaseTimestamp(row.expires_at)===normalizeCaseTimestamp(ref.expiresAt),"CASE_CONTEXT_NOT_AVAILABLE",409);
  assert(normalizeCaseTimestamp(row.evaluation_as_of)===normalizeCaseTimestamp(evaluationAsOf)&&normalizeCaseTimestamp(row.context_metadata.evaluationAsOf)===normalizeCaseTimestamp(evaluationAsOf),"CASE_CONTEXT_NOT_SEALED",409);
  const observations=(await sql<ValueRow>`SELECT *,${pgStamp("timestamp_value")} AS timestamp_value FROM rule_case_observations WHERE ${tenant(s)} AND context_id=${ref.snapshotId}::uuid ORDER BY field_id`.execute(tx)).rows;
  const health=(await sql<{metadata:DecisionContext["sourceHealth"][number]}>`SELECT metadata FROM rule_case_source_health WHERE ${tenant(s)} AND context_id=${ref.snapshotId}::uuid ORDER BY source_id`.execute(tx)).rows;
  const profileValues=(await sql<ValueRow>`SELECT *,${pgStamp("timestamp_value")} AS timestamp_value FROM rule_case_profile_values WHERE ${tenant(s)} AND context_id=${ref.snapshotId}::uuid ORDER BY config_key`.execute(tx)).rows;
  const input:CaseSnapshotInput={caseId:ref.caseId,context:{...row.context_metadata,fields:Object.fromEntries(observations.map(r=>[r.field_id!,{...r.metadata!,value:decodeRow(r)}])),sourceHealth:health.map(h=>h.metadata)},profile:{...row.profile_metadata,values:Object.fromEntries(profileValues.map(r=>[r.config_key!,{value:decodeRow(r) as Scalar,unit:r.unit!}]))},registry:row.registry_metadata};
  assert(input.context.guildId===s.guildId&&input.context.target.targetType===row.target_type&&input.context.target.targetId===row.target_id&&input.context.target.liveVersion===row.live_version&&normalizeCaseTimestamp(input.context.window.start)===normalizeCaseTimestamp(row.window_start)&&normalizeCaseTimestamp(input.context.window.end)===normalizeCaseTimestamp(row.window_end),"CASE_CONTEXT_NOT_SEALED",409);
  assert(caseSnapshotHash(input)===ref.contentHash&&canonicalCaseHash(input.profile)===ref.profileHash&&canonicalCaseHash(input.registry)===ref.registryHash,"CASE_CONTEXT_HASH_MISMATCH",409);
  output.push({...input,seal:ref});
 }
 return output;
}
