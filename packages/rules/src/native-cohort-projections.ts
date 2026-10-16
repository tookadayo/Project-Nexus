import {sql,tenant,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {SettingsService,type Actor} from "../../settings/src/index";
import {resolveAnalysisScope,type ScopeChannel} from "../../shared/src/channel-scope";
import type {CapabilitySnapshot,ChannelMetadata} from "../../shared/src/community-model";
import {operationsAccess,actorPermissions} from "../../operations/src/policy";
import {OnboardingFlowDrafts,onboardingFlowTargetVersion} from "../../onboarding/src/flow-drafts";
import {addCalendarDays,dateBoundary} from "../../automation/src/datetime";
import {activationSchema,type Condition} from "../../lifecycle/src/activation";
import {signalRegistry,canonicalSignal} from "../../events/src/registry";
import {canonicalRuleTimestamp,hashRuleValue,immutableSourceHealthId,timestampMicros,type FactSnapshot,type SourceHealthObservation} from "./facts";
import {readNativeCohortConfig,type NativeCohortDefinition} from "./native-cohort-config";
import type {NativeProjectionCandidate,NativeSourceRequest} from "./native-projections";

export type NativeCohortKind=NativeCohortDefinition["kind"];
export type NativeCohortRequest=Extract<NativeSourceRequest,{kind:NativeCohortKind}>;
const SOURCES={ONBOARDING_FIRST_ACTION:"ONBOARDING_AGGREGATE_V1",HELP_BACKLOG_COHORT:"INTAKE_STATUS_AGGREGATE_V1",ENGAGEMENT_CONTINUATION_COHORT:"PERMITTED_ENGAGEMENT_AGGREGATE_V1",CHANNEL_PARTICIPATION_COHORT:"ChannelParticipationAggregateAdapter",EVENT_RSVP_ATTENDANCE_COHORT:"EventParticipationAggregateAdapter"} as const;
const METRICS={ONBOARDING_FIRST_ACTION:"ONB_FIRST_ACTION_COMPLETION_RATE",HELP_BACKLOG_COHORT:"HELP_UNANSWERED_STALLED_RATE",ENGAGEMENT_CONTINUATION_COHORT:"ENGAGEMENT_CONTINUATION_RATE",CHANNEL_PARTICIPATION_COHORT:"COMM.CHANNEL_PARTICIPATION_RATE",EVENT_RSVP_ATTENDANCE_COHORT:"EVENT.RSVP_TO_ATTENDANCE_CONVERSION"} as const;
const iso=(value:Date)=>canonicalRuleTimestamp(value.toISOString());
const minimum=(...values:string[])=>values.reduce((a,b)=>timestampMicros(a)<=timestampMicros(b)?a:b);
const sourceEnd=(value:Date,days:number)=>iso(new Date(value.getTime()+days*86400000));
interface AggregateRow {numerator:string|null;denominator:string;rows:string;oldest:Date|null;last_ingest:Date|null;eligible_events?:string;unknown:string;}
interface NativeBinding {settings:Awaited<ReturnType<SettingsService["get"]>>;channelExpiry:string|null;firstActionIntents:string[];firstActionSourceSupported:boolean;}
export function nativeFirstActionSources(rule:Condition){
 const intents=new Set<string>(),mapping:Record<string,string>={GuildMembers:"members",GuildMessages:"messages",GuildMessageReactions:"reactions",GuildVoiceStates:"voice",GuildScheduledEvents:"scheduledEvents",GuildMessagePolls:"polls"};let supported=true;
 const signal=(value:string)=>{const key=canonicalSignal(value);if(!key){supported=false;return;}const source=signalRegistry[key];if(source.source==="rest")supported=false;if(source.requiredIntent){const intent=mapping[source.requiredIntent];if(intent)intents.add(intent);else supported=false;}};
 const walk=(node:Condition):void=>{if(node.op==="all"||node.op==="any"){node.rules.forEach(walk);return;}if(node.op==="not"){walk(node.rule);return;}if(node.op==="role_present"||node.op==="activation_state"){supported=false;return;}if(node.op==="connection_state"||node.op==="reply_received"||node.op==="channel_activity"){intents.add("messages");return;}if(node.op==="scheduled_event_subscribed"){intents.add("scheduledEvents");return;}if("event" in node)signal(node.event);};
 walk(rule);return {intents:[...intents].sort(),supported};
}
export const nativeObservedChannelVersion=(snapshotId:string,channel:ChannelMetadata)=>hashRuleValue({contract:"native-channel-observation-v1",snapshotId,channel});

/** Current scope/settings are rechecked at read and configuration time. A
 * source definition is not an operational engine approval. */
export async function validateNativeCohortBinding(tx:Tx,s:Scope,definition:NativeCohortDefinition,now:Date):Promise<NativeBinding>{
 const settings=await new SettingsService(tx).get(s,tx);
 let firstActionIntents:string[]=[],firstActionSourceSupported=true;
 assert(settings.enabled&&settings.revision===definition.settingsRevision,"RULE_COHORT_SETTINGS_VERSION_MISMATCH",412);
 if(definition.kind==="ONBOARDING_FIRST_ACTION"){
  assert(settings.onboardingEnabled&&(settings.flowVersionId===definition.flowVersionId||settings.hybrid.flowVersionId===definition.flowVersionId),"RULE_COHORT_ONBOARDING_BINDING_MISMATCH",412);
  const current=await new OnboardingFlowDrafts(tx).current(tx,s,definition.flowVersionId);
  assert(onboardingFlowTargetVersion(current)===definition.flowTargetVersion,"RULE_COHORT_ONBOARDING_BINDING_MISMATCH",412);
  const revision=(await sql<{definition:unknown}>`SELECT a.definition FROM flow_versions f JOIN guild_config_revisions a ON a.organization_id=f.organization_id AND a.guild_id=f.guild_id AND a.id=${definition.activationRevisionId}::uuid AND a.domain='activation' AND a.state='published' WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.id=${definition.flowVersionId}::uuid`.execute(tx)).rows[0];
  assert(revision,"RULE_COHORT_NATIVE_REVISION_UNAVAILABLE",409);
  const sources=nativeFirstActionSources(activationSchema.parse(revision.definition).rule);firstActionIntents=sources.intents;firstActionSourceSupported=sources.supported;
 }
 if(definition.kind==="HELP_BACKLOG_COHORT"){
  const rows=(await sql<{id:string;version:number}>`SELECT id,version FROM operations_intake_panels WHERE ${tenant(s)} AND id IN (${sql.join(definition.panels.map(value=>value.panelId))}) AND state='PUBLISHED'`.execute(tx)).rows;
  assert(rows.length===definition.panels.length&&definition.panels.every(value=>rows.some(row=>row.id===value.panelId&&row.version===value.version)),"RULE_COHORT_INTAKE_BINDING_UNAVAILABLE",409);
 }
 const channels=definition.kind==="CHANNEL_PARTICIPATION_COHORT"?definition.populationChannelIds:"channelIds" in definition?definition.channelIds:[];
 let channelExpiry:string|null=null;
 if(channels.length){
  const rows=(await sql<{channel_id:string;channel_type:number;parent_id:string|null;visibility_state:string;visibility_observed_at:Date|null;deleted_at:Date|null;collection_forbidden:boolean}>`SELECT channel_id,channel_type,parent_id,visibility_state,visibility_observed_at,deleted_at,collection_forbidden FROM discord_surface_state WHERE ${tenant(s)}`.execute(tx)).rows;
  const actual:ScopeChannel[]=rows.map(row=>({id:row.channel_id,type:row.channel_type,parentId:row.parent_id,observable:row.visibility_state==="VISIBLE"&&!!row.visibility_observed_at&&row.visibility_observed_at<=now&&row.visibility_observed_at.getTime()+3600000>now.getTime(),deleted:row.deleted_at!==null,collectionForbidden:row.collection_forbidden}));
  const resolved=resolveAnalysisScope(settings.communityModel,settings.analysisScope,actual),selected=new Set(resolved.actualChannelIds);
  assert(channels.every(value=>selected.has(value)),"RULE_COHORT_CHANNEL_NOT_CURRENTLY_PERMITTED",403);
  channelExpiry=minimum(...rows.filter(row=>channels.includes(row.channel_id)).map(row=>iso(new Date(row.visibility_observed_at!.getTime()+3600000))));
  if(definition.kind==="CHANNEL_PARTICIPATION_COHORT"){
   const snapshot=(await sql<{id:string;snapshot:CapabilitySnapshot;checked_at:Date}>`SELECT id,snapshot,checked_at FROM guild_capability_snapshots WHERE ${tenant(s)} AND checked_at<=${now} ORDER BY checked_at DESC,id DESC LIMIT 1`.execute(tx)).rows[0],channel=snapshot?.snapshot.channels.find(value=>value.id===definition.channelId),surface=rows.find(value=>value.channel_id===definition.channelId);
   assert(snapshot&&snapshot.checked_at.getTime()+3600000>now.getTime()&&channel&&surface&&channel.observable&&!channel.deleted&&!channel.collectionForbidden&&channel.type===surface.channel_type&&channel.parentId===surface.parent_id&&nativeObservedChannelVersion(snapshot.id,channel)===definition.channelTargetVersion,"RULE_COHORT_CHANNEL_OBSERVATION_VERSION_MISMATCH",412);
   channelExpiry=minimum(channelExpiry,iso(new Date(snapshot.checked_at.getTime()+3600000)));
  }
 }
 return {settings,channelExpiry,firstActionIntents,firstActionSourceSupported};
}
export async function nativeCohortOptions(tx:Tx,s:Scope,actor:Actor,now:Date){
 await operationsAccess(tx,s,actor,"READ");const settings=await new SettingsService(tx).get(s,tx),reasons:string[]=[];
 const flowVersions:{id:string;version:number;targetVersion:string}[]=[];
 for(const value of [...new Set([settings.flowVersionId,settings.hybrid.flowVersionId].filter((value):value is string=>!!value))]){
  const current=await new OnboardingFlowDrafts(tx).current(tx,s,value);flowVersions.push({id:value,version:current.flowVersion,targetVersion:onboardingFlowTargetVersion(current)});
 }
 if(!flowVersions.length)reasons.push("NATIVE_ONBOARDING_FLOW_NOT_CONFIGURED");
 const activationRevisions=(await sql<{id:string;version:number}>`SELECT r.id,r.version FROM guild_config_revisions r JOIN guild_config_heads h ON h.organization_id=r.organization_id AND h.guild_id=r.guild_id AND h.revision_id=r.id AND h.domain=r.domain WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.domain='activation' AND r.state='published' ORDER BY r.version DESC LIMIT 100`.execute(tx)).rows;
 const intakePanels=(await sql<{id:string;version:number}>`SELECT id,version FROM operations_intake_panels WHERE ${tenant(s)} AND state='PUBLISHED' ORDER BY id LIMIT 101`.execute(tx)).rows;
 if(intakePanels.length>100){intakePanels.length=0;reasons.push("NATIVE_INTAKE_PANEL_LIMIT_EXCEEDED");}
 const surfaces=(await sql<{channel_id:string;channel_type:number;parent_id:string|null;visibility_state:string;visibility_observed_at:Date|null;deleted_at:Date|null;collection_forbidden:boolean}>`SELECT channel_id,channel_type,parent_id,visibility_state,visibility_observed_at,deleted_at,collection_forbidden FROM discord_surface_state WHERE ${tenant(s)} ORDER BY channel_id LIMIT 1001`.execute(tx)).rows;
 const projected:ScopeChannel[]=surfaces.map(row=>({id:row.channel_id,type:row.channel_type,parentId:row.parent_id,observable:row.visibility_state==="VISIBLE"&&!!row.visibility_observed_at&&row.visibility_observed_at<=now&&row.visibility_observed_at.getTime()+3600000>now.getTime(),deleted:row.deleted_at!==null,collectionForbidden:row.collection_forbidden}));
 const permitted=surfaces.length>1000?[]:resolveAnalysisScope(settings.communityModel,settings.analysisScope,projected).actualChannelIds;
 if(!permitted.length)reasons.push("NATIVE_CURRENT_CHANNEL_VISIBILITY_UNAVAILABLE");
 const events=permitted.length?(await sql<{id:string;startAt:string|null}>`SELECT state_key AS id,data->>'activeSince' AS "startAt" FROM adaptive_states WHERE ${tenant(s)} AND domain='event' AND subject_hash='' AND data->>'channelId' IN (${sql.join(permitted)}) AND data->>'entityType' IN ('1','2') AND data->>'status' IN ('2','3') AND observed_at>=${new Date(now.getTime()-settings.detailedRetentionDays*86400000)} AND observed_at<=${now} ORDER BY state_key LIMIT 101`.execute(tx)).rows:[];
 if(events.length>100){events.length=0;reasons.push("NATIVE_EVENT_LIMIT_EXCEEDED");}
 const snapshot=(await sql<{id:string;snapshot:CapabilitySnapshot;checked_at:Date}>`SELECT id,snapshot,checked_at FROM guild_capability_snapshots WHERE ${tenant(s)} AND checked_at<=${now} ORDER BY checked_at DESC,id DESC LIMIT 1`.execute(tx)).rows[0];
 const channels=permitted.map(id=>{const channel=snapshot?.snapshot.channels.find(value=>value.id===id),surface=surfaces.find(value=>value.channel_id===id);return {id,eligible:true,targetVersion:snapshot&&snapshot.checked_at.getTime()+3600000>now.getTime()&&channel&&surface&&channel.type===surface.channel_type&&channel.parentId===surface.parent_id&&channel.observable&&!channel.deleted&&!channel.collectionForbidden?nativeObservedChannelVersion(snapshot.id,channel):null};});
 return {settingsRevision:settings.revision,timeZone:settings.timezone,flowVersions,activationRevisions,intakePanels,channels,events,reasonCodes:reasons,canConfigure:(await actorPermissions(tx,s,actor)).includes("CONFIGURE"),operationalApproval:false as const};
}

/** Pure aggregate contract used by fixtures. Empty observed populations stay
 * ratio 0/0; the engine decides minimum-N, never ABSENT/healthy by coercion. */
export function cohortRatio(numerator:string,denominator:string,eligibleEvents?:string){
 assert(/^\d+$/.test(numerator)&&/^\d+$/.test(denominator)&&BigInt(numerator)<=BigInt(denominator),"RULE_COHORT_INTERSECTION_INVALID",500);
 return {kind:"ratio" as const,numerator:BigInt(numerator).toString(),denominator:BigInt(denominator).toString(),...(eligibleEvents===undefined?{}:{eligibleEvents})};
}
function localDate(at:string,timeZone:string){const parts=new Intl.DateTimeFormat("en-CA",{timeZone,calendar:"iso8601",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(at)),part=(type:string)=>parts.find(value=>value.type===type)!.value;return `${part("year")}-${part("month")}-${part("day")}`;}
/** II-A uses calendar windows; II-B uses elapsed windows. A DST transition
 * changes elapsed hours, never the declared calendar cohort length. */
export function nativeCohortWindow(definition:NativeCohortDefinition,start:string,end:string){
 const calendar=["ONBOARDING_FIRST_ACTION","HELP_BACKLOG_COHORT","ENGAGEMENT_CONTINUATION_COHORT"].includes(definition.kind),days=definition.windowDays;
 if(calendar){
  const date=localDate(start,definition.timeZone),boundary=canonicalRuleTimestamp(dateBoundary(date,definition.timeZone)),finish=canonicalRuleTimestamp(dateBoundary(addCalendarDays(date,days),definition.timeZone));
  assert(boundary===canonicalRuleTimestamp(start)&&finish===canonicalRuleTimestamp(end),"NATIVE_COHORT_CALENDAR_WINDOW_MISMATCH",400);
  return {windowKind:"CALENDAR" as const,previousStart:canonicalRuleTimestamp(dateBoundary(addCalendarDays(date,-days),definition.timeZone))};
 }
 assert(timestampMicros(end)-timestampMicros(start)===BigInt(days)*86400000000n,"NATIVE_COHORT_ELAPSED_WINDOW_MISMATCH",400);
 return {windowKind:"ELAPSED" as const,previousStart:iso(new Date(Date.parse(start)-days*86400000))};
}
/** All identity intersections stay inside SQL. No member IDs or form content
 * are returned to the rule service, new config tables, Fact or evidence. */
async function onboarding(tx:Tx,s:Scope,c:Extract<NativeCohortDefinition,{kind:"ONBOARDING_FIRST_ACTION"}>,from:string,to:string,now:string):Promise<AggregateRow>{
 return (await sql<AggregateRow>`WITH sessions AS (
  SELECT f.id,f.episode_id,f.created_at,lead(f.created_at) OVER(PARTITION BY f.episode_id ORDER BY f.created_at,f.id) AS next_start,f.flow_version_id
  FROM flow_sessions f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id
  JOIN member_identity_map i ON i.organization_id=e.organization_id AND i.guild_id=e.guild_id AND i.id=e.identity_id
  WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.context='PRODUCTION' AND e.context='PRODUCTION'
  AND f.created_at>=${from}::timestamptz-make_interval(secs=>${c.observationSeconds}) AND f.created_at<${to}::timestamptz
  AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest
  AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=e.organization_id AND d.guild_id=e.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.lookup_hash))
 ), cohort AS (
  SELECT q.*,q.created_at+make_interval(secs=>${c.observationSeconds}) AS maturity FROM sessions q WHERE q.flow_version_id=${c.flowVersionId}::uuid
  AND q.created_at+make_interval(secs=>${c.observationSeconds})>=${from}::timestamptz AND q.created_at+make_interval(secs=>${c.observationSeconds})<${to}::timestamptz ORDER BY q.id LIMIT 200001
 ), observed AS (
  SELECT c.id,c.created_at,c.maturity,a.revision_id,
   (SELECT max(l.occurred_at) FROM lifecycle_events l WHERE l.organization_id=${s.organizationId}::uuid AND l.guild_id=${s.guildId} AND l.episode_id=c.episode_id AND l.context='PRODUCTION' AND ((l.kind='nexus_onboarding.completed' AND l.data->>'flowVersionId'=${c.flowVersionId}) OR (l.kind='activation.completed' AND l.data->>'definitionId'=${c.activationRevisionId})) AND l.occurred_at>=c.created_at AND l.occurred_at<=c.maturity AND (c.next_start IS NULL OR l.occurred_at<c.next_start)) AS last_event_at,
   EXISTS(SELECT 1 FROM lifecycle_events l WHERE l.organization_id=${s.organizationId}::uuid AND l.guild_id=${s.guildId} AND l.episode_id=c.episode_id AND l.context='PRODUCTION' AND l.kind='nexus_onboarding.completed' AND l.data->>'flowVersionId'=${c.flowVersionId} AND l.occurred_at>=c.created_at AND l.occurred_at<=c.maturity AND (c.next_start IS NULL OR l.occurred_at<c.next_start)) AS completed,
   EXISTS(SELECT 1 FROM lifecycle_events l WHERE l.organization_id=${s.organizationId}::uuid AND l.guild_id=${s.guildId} AND l.episode_id=c.episode_id AND l.context='PRODUCTION' AND l.kind='activation.completed' AND l.data->>'definitionId'=${c.activationRevisionId} AND l.occurred_at>=c.created_at AND l.occurred_at<=c.maturity AND (c.next_start IS NULL OR l.occurred_at<c.next_start)) AS first_action
  FROM cohort c LEFT JOIN activation_members a ON a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.episode_id=c.episode_id
 ) SELECT count(*) FILTER(WHERE completed AND first_action AND revision_id=${c.activationRevisionId}::uuid)::text AS numerator,count(*)::text AS denominator,count(*)::text AS rows,min(created_at) AS oldest,max(GREATEST(created_at,last_event_at)) AS last_ingest,
 count(*) FILTER(WHERE revision_id IS NULL OR revision_id<>${c.activationRevisionId}::uuid OR maturity>${now}::timestamptz)::text AS unknown FROM observed`.execute(tx)).rows[0]!;
}
async function help(tx:Tx,s:Scope,c:Extract<NativeCohortDefinition,{kind:"HELP_BACKLOG_COHORT"}>,from:string,to:string,now:string):Promise<AggregateRow>{
 // II-A assigns intake creation to the window and includes only SLA-mature
 // cases at asOf. Native ACKNOWLEDGED/IN_PROGRESS are not first responses or
 // an explicit STALLED status. Their absent response source remains unknown.
 return (await sql<AggregateRow>`WITH cohort AS (
 SELECT r.id,r.created_at,a.status,a.version,a.updated_at
 FROM operations_requests r LEFT JOIN attention_items a ON a.organization_id=r.organization_id AND a.guild_id=r.guild_id AND a.message_id=r.attention_key
 WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.panel_id IN (${sql.join(c.panels.map(value=>value.panelId))}) AND r.erased_at IS NULL AND r.state<>'DELETED'
 AND r.created_at>=${from}::timestamptz AND r.created_at<${to}::timestamptz AND r.created_at+make_interval(secs=>${c.slaSeconds})<=${now}::timestamptz
 AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=r.organization_id AND d.guild_id=r.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=r.actor_hash))
 ) SELECT NULL::text AS numerator,count(*)::text AS denominator,count(*)::text AS rows,min(created_at) AS oldest,max(GREATEST(created_at,updated_at)) AS last_ingest,count(*)::text AS unknown FROM cohort`.execute(tx)).rows[0]!;
}
function eligibleEvents(s:Scope,kinds:readonly string[],channels:readonly string[],from:string,to:string){return sql`SELECT l.episode_id,e.identity_id,l.kind,l.occurred_at,l.data->>'channelId' AS channel_id
 FROM lifecycle_events l JOIN membership_episodes e ON e.organization_id=l.organization_id AND e.guild_id=l.guild_id AND e.id=l.episode_id
 JOIN member_identity_map i ON i.organization_id=e.organization_id AND i.guild_id=e.guild_id AND i.id=e.identity_id
 WHERE l.organization_id=${s.organizationId}::uuid AND l.guild_id=${s.guildId} AND l.context='PRODUCTION' AND e.context='PRODUCTION'
 AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest
 AND l.occurred_at>=${from}::timestamptz AND l.occurred_at<${to}::timestamptz AND l.occurred_at>=COALESCE(e.engagement_started_at,e.joined_at) AND (e.left_at IS NULL OR l.occurred_at<e.left_at)
 AND l.kind IN (${sql.join(kinds)}) AND (l.data->>'channelId' IN (${sql.join(channels)}) OR (l.data->>'channelId' IS NULL AND l.kind IN ('interaction.used','activation.completed','nexus_onboarding.answered','scheduled_event.subscribed')))
 AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=e.organization_id AND d.guild_id=e.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.lookup_hash))`;}
async function continuation(tx:Tx,s:Scope,c:Extract<NativeCohortDefinition,{kind:"ENGAGEMENT_CONTINUATION_COHORT"}>,from:string,to:string,previous:string):Promise<AggregateRow>{
 return (await sql<AggregateRow>`WITH events AS (${eligibleEvents(s,c.signals,c.channelIds,previous,to)}), previous AS (SELECT DISTINCT identity_id FROM events WHERE occurred_at<${from}::timestamptz), current AS (SELECT DISTINCT identity_id FROM events WHERE occurred_at>=${from}::timestamptz)
 SELECT (SELECT count(*) FROM previous p JOIN current c USING(identity_id))::text AS numerator,(SELECT count(*) FROM previous)::text AS denominator,count(*)::text AS rows,min(occurred_at) AS oldest,max(occurred_at) AS last_ingest,'0'::text AS unknown FROM events`.execute(tx)).rows[0]!;
}
async function participation(tx:Tx,s:Scope,c:Extract<NativeCohortDefinition,{kind:"CHANNEL_PARTICIPATION_COHORT"}>,from:string,to:string):Promise<AggregateRow>{
 return (await sql<AggregateRow>`WITH events AS (${eligibleEvents(s,c.signals,c.populationChannelIds,from,to)})
 SELECT count(DISTINCT identity_id) FILTER(WHERE channel_id=${c.channelId})::text AS numerator,count(DISTINCT identity_id)::text AS denominator,count(*)::text AS rows,min(occurred_at) AS oldest,max(occurred_at) AS last_ingest,'0'::text AS unknown FROM events`.execute(tx)).rows[0]!;
}
async function eventParticipation(tx:Tx,s:Scope,c:Extract<NativeCohortDefinition,{kind:"EVENT_RSVP_ATTENDANCE_COHORT"}>,from:string,to:string,asOf:string):Promise<AggregateRow>{
 return (await sql<AggregateRow>`WITH events AS (
 SELECT data->>'eventId' AS event_id,min(occurred_at) FILTER(WHERE data->>'status'='2') AS started_at,min(occurred_at) FILTER(WHERE data->>'status'='3') AS completed_at,
 bool_or(kind='scheduled_event.deleted' OR data->>'status'='4') AS cancelled,bool_or(kind='scheduled_event.created') AS creation_observed,
 bool_and((data->>'entityType') IN ('1','2') AND (data->>'channelId') IN (${sql.join(c.channelIds)})) AS supported,min(occurred_at) AS oldest,max(occurred_at) AS last_ingest
 FROM adaptive_facts WHERE ${tenant(s)} AND subject_hash='' AND data->>'eventId' IN (${sql.join(c.eventIds)}) AND kind IN ('scheduled_event.created','scheduled_event.updated','scheduled_event.deleted') AND occurred_at<=${asOf}::timestamptz GROUP BY data->>'eventId'
 ), mature AS (SELECT * FROM events WHERE NOT cancelled AND completed_at>=${from}::timestamptz AND completed_at<${to}::timestamptz), rsvp AS (
 SELECT DISTINCT ON (e.event_id,i.id) e.event_id,i.id AS identity_id,f.kind,f.occurred_at,e.started_at,e.completed_at,e.supported
 FROM mature e JOIN adaptive_facts f ON f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.data->>'eventId'=e.event_id AND f.kind IN ('scheduled_event.subscribed','scheduled_event.unsubscribed') AND f.occurred_at<=e.started_at
 JOIN membership_episodes m ON m.organization_id=f.organization_id AND m.guild_id=f.guild_id AND m.id=f.episode_id
 JOIN member_identity_map i ON i.organization_id=m.organization_id AND i.guild_id=m.guild_id AND i.id=m.identity_id
 WHERE m.context='PRODUCTION' AND m.screening_observed_at IS NOT NULL AND m.guest_observed_at IS NOT NULL AND NOT m.screening_pending AND NOT m.is_guest
 AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=m.organization_id AND d.guild_id=m.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.lookup_hash))
 ORDER BY e.event_id,i.id,f.occurred_at DESC,f.id DESC
 ), confirmed AS (SELECT * FROM rsvp WHERE kind='scheduled_event.subscribed'), matched AS (
 SELECT c.*,EXISTS(SELECT 1 FROM adaptive_facts a JOIN membership_episodes m ON m.organization_id=a.organization_id AND m.guild_id=a.guild_id AND m.id=a.episode_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.kind='scheduled_event.attended' AND a.data->>'eventId'=c.event_id AND m.identity_id=c.identity_id AND m.context='PRODUCTION' AND a.occurred_at>=c.started_at AND a.occurred_at<=c.completed_at) AS attended FROM confirmed c
 ) SELECT count(*) FILTER(WHERE attended)::text AS numerator,count(*)::text AS denominator,
 ((SELECT count(*) FROM rsvp)+(SELECT count(*) FROM events))::text AS rows,
 LEAST((SELECT min(oldest) FROM events),(SELECT min(occurred_at) FROM rsvp)) AS oldest,
 GREATEST((SELECT max(last_ingest) FROM events),(SELECT max(occurred_at) FROM rsvp)) AS last_ingest,
 ((SELECT count(*) FROM mature WHERE started_at IS NULL OR supported IS DISTINCT FROM true OR NOT creation_observed)+${c.eventIds.length}-(SELECT count(*) FROM events))::text AS unknown,
 (SELECT count(*) FROM mature)::text AS eligible_events FROM matched`.execute(tx)).rows[0]!;
}

interface HealthRead {first_seen:Date|null;last_seen:Date|null;epoch_start:Date|null;epoch_end:Date|null;gaps:boolean;intents:Record<string,string>|null;gateway_state:string|null;last_gateway_at:Date|null;}
async function observedCoverage(tx:Tx,s:Scope,from:string,to:string){
 return (await sql<HealthRead>`SELECT c.first_seen,c.last_seen,e.started_at AS epoch_start,e.ended_at AS epoch_end,
 EXISTS(SELECT 1 FROM telemetry_health g WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND g.started_at<${to}::timestamptz AND (g.ended_at IS NULL OR g.ended_at>${from}::timestamptz)) AS gaps,
 h.intents,h.gateway_state,h.last_gateway_at FROM (SELECT 1) q LEFT JOIN telemetry_cursor c ON c.organization_id=${s.organizationId}::uuid AND c.guild_id=${s.guildId}
 LEFT JOIN discord_integration_health h ON h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId}
 LEFT JOIN LATERAL(SELECT started_at,ended_at FROM collection_epochs WHERE ${tenant(s)} AND source='GATEWAY' AND started_at<=${from}::timestamptz AND (ended_at IS NULL OR ended_at>=${to}::timestamptz) ORDER BY started_at DESC LIMIT 1) e ON true`.execute(tx)).rows[0]!;
}
function requiredIntents(c:NativeCohortDefinition){
 if(c.kind==="EVENT_RSVP_ATTENDANCE_COHORT")return ["members","scheduledEvents","voice"];
 if(c.kind==="ONBOARDING_FIRST_ACTION")return ["members"];
 if(c.kind==="HELP_BACKLOG_COHORT")return [];
 const values=new Set<string>(["members"]);
 for(const signal of c.signals){if(["message.sent","reply.received"].includes(signal))values.add("messages");if(signal==="reaction.added")values.add("reactions");if(signal==="voice.duration"||signal==="scheduled_event.attended")values.add("voice");if(signal.startsWith("scheduled_event."))values.add("scheduledEvents");}
 return [...values];
}
/** Full retained windows and a continuous native collection epoch are required.
 * Missing source facts/first success never acquire synthetic zero or success. */
export async function readNativeCohortProjection(tx:Tx,s:Scope,actor:Actor,request:NativeCohortRequest,now:string):Promise<NativeProjectionCandidate[]>{
 const missingTarget={targetType:{ONBOARDING_FIRST_ACTION:"ONBOARDING_FLOW",HELP_BACKLOG_COHORT:"HELP_INTAKE_POLICY",ENGAGEMENT_CONTINUATION_COHORT:"COMMUNITY_ENGAGEMENT_POLICY",CHANNEL_PARTICIPATION_COHORT:"CHANNEL",EVENT_RSVP_ATTENDANCE_COHORT:"EVENT_PROGRAM"}[request.kind],targetId:request.kind==="CHANNEL_PARTICIPATION_COHORT"?request.channelId:request.targetId,liveVersion:request.liveVersion};
 const base={sourceType:SOURCES[request.kind],metricId:METRICS[request.kind],target:missingTarget,observedAt:now,expiresAt:null,sourceRevision:"unavailable",windowStart:request.windowStart,windowEnd:request.windowEnd,periodRole:request.periodRole,sampleSize:null,sealable:false,value:null} as const;
 const unavailable=(reason:string):NativeProjectionCandidate[]=>[{...base,reasonCodes:[reason]}];
 if(!request.sourceConfig)return unavailable("NATIVE_COHORT_CONFIG_REFERENCE_REQUIRED");
 const config=await readNativeCohortConfig(tx,s,request.sourceConfig.sourceId,request.sourceConfig.revisionId,new Date(now)),c=config.definition;
 if(c.kind!==request.kind||!config.enabled)return unavailable("NATIVE_COHORT_CONFIG_DISABLED_OR_KIND_MISMATCH");
 if(hashRuleValue(config.target)!==hashRuleValue(missingTarget))return unavailable("NATIVE_COHORT_TARGET_VERSION_MISMATCH");
 const binding=await validateNativeCohortBinding(tx,s,c,new Date(now));
 await operationsAccess(tx,s,actor,"ANALYZE",c.kind==="HELP_BACKLOG_COHORT"?"intake_panels":undefined);
 if(timestampMicros(request.windowEnd)>timestampMicros(now))return unavailable("NATIVE_COHORT_WINDOW_DEFINITION_MISMATCH");
 const window=nativeCohortWindow(c,request.windowStart,request.windowEnd);
 const offset=c.kind==="ONBOARDING_FIRST_ACTION"?c.observationSeconds:0;
 const requiredStart=c.kind==="ENGAGEMENT_CONTINUATION_COHORT"?window.previousStart:iso(new Date(Date.parse(request.windowStart)-offset*1000));
 if(Date.parse(requiredStart)<=Date.parse(now)-binding.settings.detailedRetentionDays*86400000)return unavailable("NATIVE_COHORT_WINDOW_EXCEEDS_RETAINED_DETAIL");
 const rows=c.kind==="ONBOARDING_FIRST_ACTION"?await onboarding(tx,s,c,request.windowStart,request.windowEnd,now):c.kind==="HELP_BACKLOG_COHORT"?await help(tx,s,c,request.windowStart,request.windowEnd,now):c.kind==="ENGAGEMENT_CONTINUATION_COHORT"?await continuation(tx,s,c,request.windowStart,request.windowEnd,window.previousStart):c.kind==="CHANNEL_PARTICIPATION_COHORT"?await participation(tx,s,c,request.windowStart,request.windowEnd):await eventParticipation(tx,s,c,request.windowStart,request.windowEnd,now);
 if(BigInt(rows.rows)>200000n)return unavailable("NATIVE_COHORT_SOURCE_LIMIT_EXCEEDED");
 if(rows.last_ingest&&rows.last_ingest.getTime()>Date.parse(now))return unavailable("NATIVE_COHORT_SOURCE_OBSERVATION_AFTER_AS_OF");
 const coverageStart=rows.oldest&&rows.oldest<new Date(requiredStart)?iso(rows.oldest):requiredStart;
 if(Date.parse(coverageStart)<=Date.parse(now)-binding.settings.detailedRetentionDays*86400000)return unavailable("NATIVE_COHORT_REQUIRED_OBSERVATION_EXPIRED");
 const health=await observedCoverage(tx,s,coverageStart,request.windowEnd),intents=[...new Set([...requiredIntents(c),...binding.firstActionIntents])];
 const actualHealthAt=c.kind==="HELP_BACKLOG_COHORT"?rows.last_ingest:rows.last_ingest&&health.last_gateway_at&&health.last_gateway_at.getTime()<=Date.parse(now)?new Date(Math.max(rows.last_ingest.getTime(),health.last_gateway_at.getTime())):rows.last_ingest??(health.last_gateway_at&&health.last_gateway_at.getTime()<=Date.parse(now)?health.last_gateway_at:null);
 const unavailableObserved=(reason:string):NativeProjectionCandidate[]=>{
  if(!actualHealthAt)return unavailable(reason);
  const expiry=minimum(config.expiresAt,iso(new Date(Date.parse(now)+48*3600000)),sourceEnd(new Date(coverageStart),binding.settings.detailedRetentionDays));
  if(timestampMicros(expiry)<=timestampMicros(now))return unavailable(reason);
  const revision=hashRuleValue({config:config.revisionId,windowStart:request.windowStart,windowEnd:request.windowEnd,reason,nativeHealthAt:iso(actualHealthAt)});
  const observation:SourceHealthObservation={observationId:immutableSourceHealthId(s,SOURCES[c.kind],revision,now,config.target),revision,sourceType:SOURCES[c.kind],observedAt:now,expiresAt:expiry,quality:"SUFFICIENT",state:"UNKNOWN",lastSuccessfulIngestAt:rows.last_ingest?iso(rows.last_ingest):null,neverSucceeded:rows.last_ingest?false:null,coverage:null,target:config.target};
  return [{...base,sourceRevision:revision,reasonCodes:[reason],generatedHealth:[observation]}];
 };
 if(rows.numerator===null)return unavailableObserved("HELP_FIRST_RESPONSE_AND_STRUCTURED_STALLED_SOURCE_UNAVAILABLE");
 if(!binding.firstActionSourceSupported)return unavailableObserved("ONB_FIRST_ACTION_HISTORICAL_REST_OR_ROLE_ABSENCE_UNVERIFIED");
 if(BigInt(rows.unknown)>0n)return unavailableObserved("NATIVE_COHORT_STRUCTURED_OBSERVATION_UNKNOWN");
 // Intake metadata is a DB-native queue, not a Gateway-derived zero. For the
 // other cohorts prove an unbroken epoch and actual registered source ingest.
 const complete=c.kind==="HELP_BACKLOG_COHORT"||!!(health.first_seen&&health.last_seen&&health.epoch_start&&!health.gaps&&health.first_seen<=new Date(coverageStart)&&health.last_seen.getTime()<=Date.parse(now)&&health.last_seen.getTime()+90000>=Date.parse(request.windowEnd)&&health.gateway_state==="CONNECTED"&&health.last_gateway_at&&health.last_gateway_at.getTime()<=Date.parse(now)&&health.last_gateway_at.getTime()+90000>=Date.parse(now)&&intents.every(value=>health.intents?.[value]==="AVAILABLE"));
 if(!complete)return unavailableObserved("NATIVE_COHORT_COLLECTION_COVERAGE_UNVERIFIED");
 if(!rows.last_ingest||!rows.oldest)return unavailableObserved("NATIVE_COHORT_NO_SUCCESSFUL_SOURCE_INGEST_OBSERVED");
 // This is a new SQL observation over still-retained native detail, not a
 // copied Fact. Its creation clock is asOf; the old period end and the last
 // business ingest are separate timestamps. Native expiry always wins.
 const expiry=minimum(config.expiresAt,sourceEnd(rows.oldest,binding.settings.detailedRetentionDays),sourceEnd(new Date(coverageStart),binding.settings.detailedRetentionDays),iso(new Date(Date.parse(now)+48*3600000)));
 if(timestampMicros(expiry)<=timestampMicros(now))return unavailable("NATIVE_COHORT_SOURCE_EXPIRED");
 const value=cohortRatio(rows.numerator,rows.denominator,rows.eligible_events),sourceRevision=hashRuleValue({definition:config.contentHash,configRevision:config.revisionId,windowStart:request.windowStart,windowEnd:request.windowEnd,value,oldest:iso(rows.oldest),lastIngest:iso(rows.last_ingest)});
 const observation:SourceHealthObservation={observationId:immutableSourceHealthId(s,SOURCES[c.kind],sourceRevision,now,config.target),revision:sourceRevision,sourceType:SOURCES[c.kind],observedAt:now,expiresAt:expiry,quality:"SUFFICIENT",state:"HEALTHY",lastSuccessfulIngestAt:iso(rows.last_ingest),neverSucceeded:false,coverage:"1",target:config.target};
 const comparison:NonNullable<FactSnapshot["comparison"]>={cohortDefinitionVersion:config.contentHash,campaignClass:c.campaignClass,maturityOffset:String(offset),windowKind:window.windowKind,timeZone:c.timeZone,cohortId:hashRuleValue({sourceId:config.sourceId,target:config.target})};
 return [{...base,target:config.target,value,expiresAt:expiry,sourceRevision,sampleSize:rows.denominator,sealable:true,reasonCodes:[],comparison,nativeDefinitionRef:{sourceId:config.sourceId,revisionId:config.revisionId,contentHash:config.contentHash},generatedHealth:[observation]}];
}
