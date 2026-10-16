import {z} from "zod";
import {sql,tenant,json,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {canonicalRuleTimestamp,hashRuleValue,type RuleTarget} from "./facts";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "./locks";

const id=z.string().regex(/^\d{17,20}$/), uuid=z.uuid();
const ids=z.array(id).min(1).max(1000).refine(values=>new Set(values).size===values.length);
const common={settingsRevision:z.number().int().nonnegative(),campaignClass:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),timeZone:z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}})};
/** These are existing structured, eligible-human events. No message body,
 * arbitrary SQL/event name, personal score or new membership collection. */
export const cohortActivitySignals=["message.sent","reaction.added","reply.received","thread.member_added","voice.duration","scheduled_event.attended","scheduled_event.subscribed","interaction.used","activation.completed","nexus_onboarding.answered"] as const;
export const channelActivitySignals=["message.sent","reaction.added","reply.received","thread.member_added","voice.duration","scheduled_event.attended"] as const;
export const nativeCohortDefinition=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("ONBOARDING_FIRST_ACTION"),...common,flowVersionId:uuid,flowTargetVersion:z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),activationRevisionId:uuid,observationSeconds:z.number().int().positive().max(30*86400),windowDays:z.literal(7)}).strict(),
 z.object({kind:z.literal("HELP_BACKLOG_COHORT"),...common,panels:z.array(z.object({panelId:uuid,version:z.number().int().positive()}).strict()).min(1).max(100).refine(values=>new Set(values.map(value=>value.panelId)).size===values.length),slaSeconds:z.number().int().positive().max(30*86400),stalledAfterSeconds:z.number().int().positive().max(30*86400).nullable(),windowDays:z.literal(7)}).strict(),
 z.object({kind:z.literal("ENGAGEMENT_CONTINUATION_COHORT"),...common,channelIds:ids,signals:z.array(z.enum(cohortActivitySignals)).min(1).max(cohortActivitySignals.length).refine(values=>new Set(values).size===values.length),windowDays:z.literal(7)}).strict(),
 z.object({kind:z.literal("CHANNEL_PARTICIPATION_COHORT"),...common,channelId:id,channelTargetVersion:z.string().regex(/^[a-f0-9]{64}$/),populationChannelIds:ids,signals:z.array(z.enum(channelActivitySignals)).min(1).max(channelActivitySignals.length).refine(values=>new Set(values).size===values.length),windowDays:z.literal(7)}).strict().refine(value=>value.populationChannelIds.includes(value.channelId)),
 z.object({kind:z.literal("EVENT_RSVP_ATTENDANCE_COHORT"),...common,eventIds:z.array(id).min(1).max(100).refine(values=>new Set(values).size===values.length),channelIds:ids,confirmation:z.literal("DISCORD_SUBSCRIPTION_AT_EVENT_START"),attendance:z.literal("OBSERVED_VOICE_STAGE"),windowDays:z.literal(28)}).strict(),
]);
export type NativeCohortDefinition=z.infer<typeof nativeCohortDefinition>;
export const nativeCohortRevisionRequest=z.object({sourceId:uuid,revisionId:uuid,baseVersion:z.number().int().nonnegative(),enabled:z.boolean(),definition:nativeCohortDefinition}).strict();
export interface NativeCohortConfig {sourceId:string;revisionId:string;version:number;baseVersion:number;draftParentRevisionId:string|null;enabled:boolean;definition:NativeCohortDefinition;contentHash:string;createdAt:string;expiresAt:string;target:RuleTarget;}
interface ConfigRow {source_id:string;id:string;version:number;base_version:number;draft_parent_revision_id:string|null;enabled:boolean;definition:unknown;content_hash:string;created_at:Date;expires_at:Date;}
export function nativeCohortTarget(sourceId:string,version:number,definition:NativeCohortDefinition):RuleTarget {
 const targetType={ONBOARDING_FIRST_ACTION:"ONBOARDING_FLOW",HELP_BACKLOG_COHORT:"HELP_INTAKE_POLICY",ENGAGEMENT_CONTINUATION_COHORT:"COMMUNITY_ENGAGEMENT_POLICY",CHANNEL_PARTICIPATION_COHORT:"CHANNEL",EVENT_RSVP_ATTENDANCE_COHORT:"EVENT_PROGRAM"}[definition.kind];
 return {targetType,targetId:definition.kind==="ONBOARDING_FIRST_ACTION"?definition.flowVersionId:definition.kind==="CHANNEL_PARTICIPATION_COHORT"?definition.channelId:sourceId,liveVersion:definition.kind==="ONBOARDING_FIRST_ACTION"?definition.flowTargetVersion:definition.kind==="CHANNEL_PARTICIPATION_COHORT"?definition.channelTargetVersion:String(version)};
}
function dto(row:ConfigRow):NativeCohortConfig {
 const definition=nativeCohortDefinition.parse(row.definition);
 assert(hashRuleValue(definition)===row.content_hash,"RULE_COHORT_CONFIG_HASH_MISMATCH",409);
 return {sourceId:row.source_id,revisionId:row.id,version:row.version,baseVersion:row.base_version,draftParentRevisionId:row.draft_parent_revision_id,enabled:row.enabled,definition,contentHash:row.content_hash,createdAt:canonicalRuleTimestamp(row.created_at.toISOString()),expiresAt:canonicalRuleTimestamp(row.expires_at.toISOString()),target:nativeCohortTarget(row.source_id,row.version,definition)};
}
export async function listNativeCohortConfigs(tx:Tx,s:Scope,now:Date,sourceId?:string){
 if(sourceId)uuid.parse(sourceId);
 const rows=(await sql<ConfigRow>`SELECT r.* FROM rule_native_cohort_heads h JOIN rule_native_cohort_revisions r ON r.organization_id=h.organization_id AND r.guild_id=h.guild_id AND r.source_id=h.source_id AND r.id=h.revision_id WHERE h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId} AND r.expires_at>${now} ${sourceId?sql`AND h.source_id=${sourceId}::uuid`:sql``} ORDER BY r.source_id LIMIT 101`.execute(tx)).rows;
 assert(rows.length<=100,"RULE_COHORT_CONFIG_LIMIT",409);return rows.map(dto);
}
export async function readNativeCohortConfig(tx:Tx,s:Scope,sourceId:string,revisionId:string,now:Date){
 uuid.parse(sourceId);uuid.parse(revisionId);
 const rows=await listNativeCohortConfigs(tx,s,now,sourceId),value=rows[0];
 assert(value&&value.revisionId===revisionId,"RULE_COHORT_CONFIG_VERSION_MISMATCH",412);return value;
}
/** Exact immutable identity for retry; it does not claim that this revision is
 * still the active head and never refreshes its original expiry. */
export async function readNativeCohortRevision(tx:Tx,s:Scope,sourceId:string,revisionId:string,now:Date){
 uuid.parse(sourceId);uuid.parse(revisionId);
 const row=(await sql<ConfigRow>`SELECT * FROM rule_native_cohort_revisions WHERE ${tenant(s)} AND source_id=${sourceId}::uuid AND id=${revisionId}::uuid`.execute(tx)).rows[0];
 if(!row)return null;
 assert(row.expires_at>now,"RULE_COHORT_CONFIG_EXPIRED",410);return dto(row);
}
/** The canonical guild fence also covers an absent source/head. Callers which
 * subsequently lock a Suggestion acquire this target first. */
export async function lockNativeCohortConfig(tx:Tx,s:Scope,sourceId:string,now:Date){
 uuid.parse(sourceId);await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
 const row=(await sql<ConfigRow>`SELECT r.* FROM rule_native_cohort_heads h JOIN rule_native_cohort_revisions r ON r.organization_id=h.organization_id AND r.guild_id=h.guild_id AND r.source_id=h.source_id AND r.id=h.revision_id WHERE h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId} AND h.source_id=${sourceId}::uuid FOR UPDATE OF h`.execute(tx)).rows[0];
 assert(row,"TARGET_NOT_FOUND",404);assert(row.expires_at>now,"RULE_COHORT_CONFIG_EXPIRED",410);return dto(row);
}
async function appendRevision(tx:Tx,s:Scope,input:z.infer<typeof nativeCohortRevisionRequest>,now:Date,expiry:Date,parent:string|null){
 const version=(await sql<{version:number}>`SELECT COALESCE(MAX(version),0) AS version FROM rule_native_cohort_revisions WHERE ${tenant(s)} AND source_id=${input.sourceId}::uuid`.execute(tx)).rows[0]!.version+1;
 assert(version>input.baseVersion&&version<=2147483647,"RULE_COHORT_CONFIG_VERSION_LIMIT",409);
 const contentHash=hashRuleValue(input.definition);
 await sql`INSERT INTO rule_native_cohort_revisions(organization_id,guild_id,source_id,id,version,base_version,draft_parent_revision_id,enabled,kind,definition,content_hash,created_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${input.sourceId}::uuid,${input.revisionId}::uuid,${version},${input.baseVersion},${parent}::uuid,${input.enabled},${input.definition.kind},${json(input.definition)},${contentHash},${now},${expiry})`.execute(tx);
 return dto({source_id:input.sourceId,id:input.revisionId,version,base_version:input.baseVersion,draft_parent_revision_id:parent,enabled:input.enabled,definition:input.definition,content_hash:contentHash,created_at:now,expires_at:expiry});
}
/** Immutable revision UUID+content gives retry identity without a second receipt
 * containing the definition. Read/retry/enable never refreshes its expiry. */
export async function reviseNativeCohortConfig(tx:Tx,s:Scope,raw:unknown,now:Date,expiry:Date){
 const input=nativeCohortRevisionRequest.parse(raw),contentHash=hashRuleValue(input.definition);
 assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);assert(expiry>now,"RULE_COHORT_CONFIG_EXPIRED",409);
 await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
 const prior=(await sql<ConfigRow>`SELECT * FROM rule_native_cohort_revisions WHERE ${tenant(s)} AND id=${input.revisionId}::uuid`.execute(tx)).rows[0];
 if(prior){assert(prior.source_id===input.sourceId&&prior.base_version===input.baseVersion&&prior.draft_parent_revision_id===null&&prior.enabled===input.enabled&&prior.content_hash===contentHash,"IDEMPOTENCY_KEY_REUSED",409);assert(prior.expires_at>now,"RULE_COHORT_CONFIG_EXPIRED",410);return {...dto(prior),deduplicated:true};}
 const head=(await sql<{version:number;revision_id:string}>`SELECT h.version,h.revision_id FROM rule_native_cohort_heads h WHERE ${tenant(s)} AND source_id=${input.sourceId}::uuid FOR UPDATE`.execute(tx)).rows[0];
 assert((head?.version??0)===input.baseVersion,"RULE_COHORT_CONFIG_VERSION_MISMATCH",412);
 if(head){const current=await readNativeCohortRevision(tx,s,input.sourceId,head.revision_id,now);assert(current&&current.definition.kind===input.definition.kind,"RULE_COHORT_CONFIG_KIND_MISMATCH",409);}
 if(!head)assert((await listNativeCohortConfigs(tx,s,now)).length<100,"RULE_COHORT_CONFIG_LIMIT",409);
 const saved=await appendRevision(tx,s,input,now,expiry,null),version=saved.version;
 if(head){const updated=await sql`UPDATE rule_native_cohort_heads SET revision_id=${input.revisionId}::uuid,version=${version} WHERE ${tenant(s)} AND source_id=${input.sourceId}::uuid AND revision_id=${head.revision_id}::uuid AND version=${input.baseVersion} RETURNING source_id`.execute(tx);assert(updated.rows.length===1,"RULE_COHORT_CONFIG_VERSION_MISMATCH",412);}
 else await sql`INSERT INTO rule_native_cohort_heads(organization_id,guild_id,source_id,revision_id,version) VALUES(${s.organizationId}::uuid,${s.guildId},${input.sourceId}::uuid,${input.revisionId}::uuid,${version})`.execute(tx);
 return {...saved,deduplicated:false};
}
/** Adds one immutable, explicitly unheaded revision. No head/enabled setting or
 * source observation is changed. The caller owns authorization, CONFIG policy,
 * typed native bindings and the surrounding Suggestion/link transaction. */
export async function draftNativeCohortConfig(tx:Tx,s:Scope,raw:unknown,now:Date,expiry:Date,beforeWrite?:(tx:Tx)=>Promise<void>){
 const input=nativeCohortRevisionRequest.omit({enabled:true}).parse(raw),current=await lockNativeCohortConfig(tx,s,input.sourceId,now);
 assert(current.version===input.baseVersion,"RULE_COHORT_CONFIG_VERSION_MISMATCH",412);
 assert(current.definition.kind===input.definition.kind,"RULE_COHORT_CONFIG_KIND_MISMATCH",409);
 const end=new Date(Math.min(expiry.getTime(),Date.parse(current.expiresAt)));
 assert(Number.isFinite(end.getTime())&&end>now,"RULE_COHORT_CONFIG_EXPIRED",409);
 const prior=await readNativeCohortRevision(tx,s,input.sourceId,input.revisionId,now);
 if(prior){assert(prior.baseVersion===input.baseVersion&&prior.draftParentRevisionId===current.revisionId&&prior.enabled===current.enabled&&prior.contentHash===hashRuleValue(input.definition),"IDEMPOTENCY_KEY_REUSED",409);if(beforeWrite)await beforeWrite(tx);return {...prior,deduplicated:true};}
 if(beforeWrite)await beforeWrite(tx);
 const saved=await appendRevision(tx,s,{...input,enabled:current.enabled},now,end,current.revisionId);
 if(beforeWrite)await beforeWrite(tx);
 const completed=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
 assert(end>completed,"RULE_COHORT_CONFIG_EXPIRED",410);return {...saved,deduplicated:false};
}
