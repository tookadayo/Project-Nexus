import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assert } from "../../shared/src/index";
import { ALPHA16_RETENTION_CONTRACT } from "./retention-contract";
import { nativeSourceRequest } from "./native-source-request";

export const PLATFORM_VERSIONS = Object.freeze({engine:"alpha16.1",schema:"alpha16.1",catalog:"alpha16.1",branch:"alpha16-integrated-1",action:"alpha16-review-1",explanation:"alpha16-explanation-1"});
export const suggestionStates = ["ACTIVE","REJECTED","EXPIRED","INVALIDATED","CONSUMED"] as const;
export type SuggestionState = typeof suggestionStates[number];
export const targetTypes = ["GUILD","CHANNEL","AUTOMATION","ONBOARDING","INTAKE","EVENT","REPORT","PLAYBOOK","EXPERIMENT","COMMUNITY_REQUEST","ANNOUNCEMENT","SOURCE","PERMISSION","MODERATION_QUEUE","DUTY_BUCKET","FILTER","ACCESSIBILITY","FORUM","ONBOARDING_FLOW","HELP_INTAKE_POLICY","COMMUNITY_ENGAGEMENT_POLICY","EVENT_PROGRAM","REPORT_DEFINITION","AUTOMATION_FLOW","AUTOMATION_RUNTIME","GUILD_PERMISSION_PROFILE","ISSUE_TARGET","DATA_SOURCE_METRIC","COMMUNITY_POLICY"] as const;
export type TargetType = typeof targetTypes[number];
export type RetentionClass = "FACT"|"SOURCE_HEALTH"|"EVALUATION"|"SUGGESTION"|"HISTORY"|"USER_STATE"|"SUPPRESSION"|"CONFIG"|"DRAFT_LINK"|"RESERVATION"|"REQUEST_KEY"|"TARGET_LIVE_SAFETY";
export interface PlatformPolicy {
 kind:"OPERATIONAL"; revision:string; approved:boolean; visibilityApproved:boolean;
 retention:Partial<Record<RetentionClass,{seconds:number;approvalReference:string}>>;
 cursorSeconds?:number;
}
/** No implicit values: the absence of a policy cannot grant persistence. */
export function retentionExpiry(policy:PlatformPolicy|undefined, kind:RetentionClass, at:Date, ceiling?:Date):Date {
 const c=policy?.retention[kind];
 assert(policy?.kind==="OPERATIONAL"&&policy.approved&&c&&Number.isSafeInteger(c.seconds)&&c.seconds>0&&c.approvalReference.length>0,"RETENTION_NOT_APPROVED",409);
 const maximum:Partial<Record<RetentionClass,number>>={FACT:ALPHA16_RETENTION_CONTRACT.factSnapshot.maximumSeconds,SOURCE_HEALTH:ALPHA16_RETENTION_CONTRACT.sourceHealthSnapshot.maximumSeconds,EVALUATION:ALPHA16_RETENTION_CONTRACT.evaluation.maximumSeconds,SUGGESTION:ALPHA16_RETENTION_CONTRACT.minimalSuggestionHistory.maximumSeconds,HISTORY:ALPHA16_RETENTION_CONTRACT.minimalSuggestionHistory.maximumSeconds,SUPPRESSION:ALPHA16_RETENTION_CONTRACT.lineageSuppression.maximumSeconds,USER_STATE:ALPHA16_RETENTION_CONTRACT.minimalSuggestionHistory.maximumSeconds,REQUEST_KEY:ALPHA16_RETENTION_CONTRACT.evaluation.maximumSeconds,DRAFT_LINK:ALPHA16_RETENTION_CONTRACT.evidence.maximumSeconds};
 assert(maximum[kind]===undefined||c.seconds<=maximum[kind]!,"INVALID_RETENTION_POLICY",409);
 const end=new Date(at.getTime()+c.seconds*1000);
 assert(Number.isFinite(end.getTime()),"INVALID_RETENTION_POLICY",409);
 return ceiling&&ceiling<end?ceiling:end;
}
export function canonicalJson(input:unknown):string {
 const visit=(v:unknown):unknown=>{
  if(v===null||typeof v==="boolean"||typeof v==="string") return v;
  if(typeof v==="number") {assert(Number.isFinite(v),"INVALID_CANONICAL_NUMBER");return Object.is(v,-0)?0:v;}
  if(Array.isArray(v))return v.map(visit);
  assert(v&&typeof v==="object"&&Object.getPrototypeOf(v)===Object.prototype,"INVALID_CANONICAL_VALUE");
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,visit((v as Record<string,unknown>)[k])]));
 };
 return JSON.stringify(visit(input));
}
export function digest(input:unknown){return createHash("sha256").update(canonicalJson(input)).digest("hex");}
export const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const target = z.object({targetType:z.enum(targetTypes),targetId:id,liveVersion:id.nullable()}).strict();
export const inputRef = z.object({kind:z.enum(["FACT","SOURCE_HEALTH"]),id:z.uuid(),revision:id}).strict();
export type InputRef=z.infer<typeof inputRef>;
export const requestedCaseId=z.enum(["CASE01","CASE02","CASE03","CASE04","CASE05","CASE06","CASE07","CASE08","CASE09","CASE10","CASE11","CASE12","CASE13","CASE14","CASE15","CASE16","CASE17","CASE18","CASE19","CASE20"]);
export const enqueueRequest=z.object({configVersion:z.number().int().positive(),inputs:z.array(inputRef).max(2000),nativeInputs:z.array(nativeSourceRequest).min(1).max(20).optional(),requestedCaseIds:z.array(requestedCaseId).min(1).max(20).refine(values=>new Set(values).size===values.length,"CASE_SELECTOR_DUPLICATE").transform(values=>[...values].sort()).optional(),requestedContextIds:z.array(z.uuid()).min(1).max(20).refine(values=>new Set(values).size===values.length,"CASE_CONTEXT_SELECTOR_DUPLICATE").transform(values=>[...values].sort()).optional(),reason:z.enum(["MANUAL","SCHEDULED","DATA_REFRESH","SYSTEM"])}).strict().refine(value=>value.inputs.length>0||!!value.nativeInputs?.length||!!value.requestedCaseIds?.length||!!value.requestedContextIds?.length,"EVALUATION_INPUT_REQUIRED");
export const applyRequest=z.object({liveVersion:id,draftId:id,immutableDraftRevisionId:id,draftContentHash:hash,approvalId:id,safetyEpoch:z.string().regex(/^[1-9]\d*$/),operationToken:z.string().min(32).max(512)}).strict();
export function expectedVersion(header:string|null):number {
 assert(header,"PRECONDITION_REQUIRED",428);assert(/^"[1-9]\d*"$/.test(header),"INVALID_REQUEST");
 const version=Number(header.slice(1,-1));assert(Number.isSafeInteger(version)&&version<=2147483647,"INVALID_REQUEST");return version;
}
export function lineageKey(input:{organizationId:string;guildId:string;targetType:string;targetId:string;issueCode:string;metricScope:string}){
 return digest(input);
}
export interface CursorBinding {organizationId:string;guildId:string;actorHash:string;endpoint:string;filter:string;sort:"CREATED_DESC_ID_DESC";}
export interface CursorPosition {snapshotAt:string;createdAt:string;id:string;expiresAt:string;}
export function encodeCursor(key:string,binding:CursorBinding,position:CursorPosition){
 assert(key.length>=32,"CURSOR_UNAVAILABLE",503);
 const payload=Buffer.from(canonicalJson({v:1,binding,position})).toString("base64url");
 return payload+"."+createHmac("sha256",key).update(payload).digest("base64url");
}
export function decodeCursor(key:string,token:string,binding:CursorBinding,now:Date):CursorPosition{
 assert(token.length<=4096,"INVALID_CURSOR");const parts=token.split(".");assert(parts.length===2,"INVALID_CURSOR");
 const actual=Buffer.from(parts[1]!,"base64url"),expected=createHmac("sha256",key).update(parts[0]!).digest();
 assert(actual.length===expected.length&&timingSafeEqual(actual,expected),"INVALID_CURSOR");
 let raw:unknown;try{raw=JSON.parse(Buffer.from(parts[0]!,"base64url").toString("utf8"));}catch{assert(false,"INVALID_CURSOR");}
 const data=z.object({v:z.literal(1),binding:z.object({organizationId:z.string(),guildId:z.string(),actorHash:z.string(),endpoint:z.string(),filter:z.string(),sort:z.literal("CREATED_DESC_ID_DESC")}).strict(),position:z.object({snapshotAt:z.iso.datetime(),createdAt:z.iso.datetime(),id:z.uuid(),expiresAt:z.iso.datetime()}).strict()}).strict().safeParse(raw);
 assert(data.success&&canonicalJson(data.data.binding)===canonicalJson(binding),"INVALID_CURSOR");
 assert(Date.parse(data.data.position.expiresAt)>now.getTime(),"INVALID_CURSOR");return data.data.position;
}
export interface SuggestionRow {
 id:string;version:number;target_type:TargetType;target_id:string;live_version:string|null;
 rule_id:string;state:SuggestionState;issue_code:string;lineage_key:string;action_id:string;
 action_mode:"REVIEW_ONLY"|"CREATE_DRAFT";action_payload:unknown;explanation:unknown;
 audience:"GUILD"|"RESTRICTED";versions:Record<string,string>;evaluation_as_of:Date;
 created_at:Date;last_observed_at:Date;actionable_until:Date;history_expires_at:Date;
 invalidated_reason:string|null;window_start:Date;window_end:Date;
}
export function suggestionDto(row:SuggestionRow,now:Date){
 return {suggestionId:row.id,suggestionVersion:row.version,target:{targetType:row.target_type,targetId:row.target_id,liveVersion:row.live_version},ruleId:row.rule_id,issueCode:row.issue_code,sharedState:row.state==="ACTIVE"&&row.actionable_until<=now?"EXPIRED":row.state,action:{actionId:row.action_id,mode:row.action_mode},explanation:row.explanation,versions:row.versions,evaluationAsOf:row.evaluation_as_of.toISOString(),createdAt:row.created_at.toISOString(),lastObservedAt:row.last_observed_at.toISOString(),actionableUntil:row.actionable_until.toISOString(),historyExpiresAt:row.history_expires_at.toISOString(),invalidationReason:row.invalidated_reason,proposalVisibility:{approvalRequired:false,currentReadRequired:true},sideEffects:{canApply:false,requiresCurrentPermissionAndTargetSafety:true}};
}
