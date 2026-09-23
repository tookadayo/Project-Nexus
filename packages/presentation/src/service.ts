import {sql,tenant,type Database} from '../../db/src/index.js';
import type {Scope} from '../../shared/src/index.js';
import {AnalyticsService,coverage as telemetryCoverage} from '../../analytics/src/index.js';
import {diagnose} from '../../analytics/src/diagnoses.js';
import type {MetricKey} from '../../analytics/src/registry.js';
import {SettingsService} from '../../settings/src/index.js';
import {domainRevisions} from '../../settings/src/domain-config.js';
import {activationSchema} from '../../lifecycle/src/activation.js';
import {interventionSchema,type InterventionDefinition} from '../../lifecycle/src/interventions.js';
import {experimentSchema,ExperimentService,type ExperimentDefinition} from '../../lifecycle/src/experiments.js';
import {actionTemplates} from './templates.js';
import {aggregateHealth,rankOpportunities,retentionMaturity,toAction,toExperiment,toJourney,toKpi,toOpportunity,toTrendPoint} from './adapters.js';
import type {ActionsPresentation,HomePresentation,JourneyPresentation,OpportunitiesPresentation,ResponseDistribution,ResultsPresentation,RetentionCohort,SetupState,TrendPoint} from './types.js';

const DAY=86400000;
const ACTIVE_KINDS=new Set(['message.sent','reaction.added','voice.duration','scheduled_event.subscribed','fallback.answer','nexus_onboarding.answered','interaction.used']);
export class PresentationService{
 private readonly analytics:AnalyticsService;
 private readonly settings:SettingsService;
 constructor(private readonly db:Database){this.settings=new SettingsService(db);this.analytics=new AnalyticsService(db,this.settings);}

 private async windows(s:Scope,now:Date){const cfg=await this.settings.get(s),days=Math.max(1,Math.floor(cfg.detailedRetentionDays/2)),end=now.getTime();return {current:[new Date(end-days*DAY),now] as const,previous:[new Date(end-days*2*DAY),new Date(end-days*DAY)] as const};}
 private async actionFailure(s:Scope,from:Date,to:Date){return (await sql<{failed:number;total:number}>`SELECT count(*) FILTER(WHERE state='failed')::integer AS failed,count(*)::integer AS total FROM intervention_runs WHERE ${tenant(s)} AND created_at>=${from} AND created_at<${to}`.execute(this.db)).rows[0]??{failed:0,total:0};}
 private async setup(s:Scope,now:Date):Promise<SetupState>{
  const [cfg,activation,capabilityResult,cursorResult,gapResult,memberResult]=await Promise.all([this.settings.get(s),domainRevisions(this.db).current(s,'activation'),sql<{profile:{coverage:string;sendMessages:boolean;manageRoles:boolean;nativeOnboardingEnabled:boolean;recommendedMode:'native'|'fallback'}}>`SELECT profile FROM guild_capabilities WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(this.db),sql<{last_seen:Date}>`SELECT last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db),sql`SELECT id FROM telemetry_health WHERE ${tenant(s)} AND ended_at IS NULL LIMIT 1`.execute(this.db),sql<{count:number}>`SELECT count(*)::integer AS count FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION'`.execute(this.db)]),capability=capabilityResult.rows[0]?.profile,cursor=cursorResult.rows[0],ingestion=Boolean(cursor&&cursor.last_seen.getTime()>now.getTime()-10*60*1000&&!gapResult.rows.length),connected=Boolean(capability&&capability.coverage==='healthy'&&capability.sendMessages&&ingestion);let preset:SetupState['activationPreset']='not_configured';
  if(activation){const definition=activationSchema.parse(activation.definition),text=JSON.stringify(definition.rule);preset=text.includes('reply.received')?'reply':text.includes('scheduled_event.subscribed')?'event':text.includes('message.sent')?'message':'custom';}
  const fallbackReady=Boolean(cfg.startChannelId&&cfg.flowVersionId),nativeReady=Boolean(capability?.nativeOnboardingEnabled),onboardingReady=cfg.onboardingMode==='native'?nativeReady:cfg.onboardingMode==='fallback'?fallbackReady:cfg.onboardingMode==='hybrid'?Boolean(nativeReady&&cfg.hybrid.enabled&&cfg.hybrid.flowVersionId&&cfg.startChannelId):capability?.recommendedMode==='native'?nativeReady:fallbackReady,measuring=connected&&Boolean(activation)&&memberResult.rows[0]!.count>0;
  const connectReason:SetupState['steps'][number]['reason']=connected?'ready':!capability?'capability_unknown':!capability.sendMessages?'permissions_missing':'ingestion_unavailable',onboardingReason:SetupState['steps'][number]['reason']=onboardingReady?'ready':cfg.onboardingMode==='native'?'native_not_ready':cfg.onboardingMode==='hybrid'?'hybrid_not_ready':'fallback_not_ready';
  const recommendedMode=capability?.recommendedMode==='native'&&nativeReady?'native':fallbackReady?'fallback':null;
  return {required:!connected||!activation||!onboardingReady,recommendedMode,steps:[{key:'connect',complete:connected,reason:connectReason},{key:'activation',complete:Boolean(activation),reason:activation?'ready':'activation_missing'},{key:'onboarding',complete:onboardingReady,reason:onboardingReason},{key:'measuring',complete:measuring,reason:measuring?'ready':'measurement_waiting'}],activationPreset:preset,activationWindowDays:cfg.activationWindowHours/24};
 }
 async home(s:Scope,now=new Date()):Promise<HomePresentation>{
  const w=await this.windows(s,now),[current,previous,setup,actionFailure]=await Promise.all([this.analytics.canonical(s,...w.current,now),this.analytics.canonical(s,...w.previous,now),this.setup(s,now),this.actionFailure(s,...w.current)]);
  const opportunities=diagnose(current,previous,'New members',actionFailure).map((d,i)=>toOpportunity(d,i,current)),ranked=rankOpportunities(opportunities.filter(o=>o.stage!=='data'&&o.stage!=='delivery')),measurementWarning=opportunities.find(o=>o.stage==='data')??null,actionWarning=opportunities.find(o=>o.stage==='delivery')??null;
  const keys=['new_members','activation_rate','direct_reply_connection_rate','d7_active_retention'] as const;
  return {generatedAt:now.toISOString(),kpis:keys.map(key=>toKpi(key,current[key],previous[key])),journey:toJourney(current),communityOpportunity:ranked[0]??null,measurementWarning,actionWarning,suggestedAction:ranked[0]?.suggestedAction??null,dataHealth:aggregateHealth(keys.map(k=>current[k])),setup};
 }
 async opportunities(s:Scope,now=new Date()):Promise<OpportunitiesPresentation>{
  const w=await this.windows(s,now),[current,previous]=await Promise.all([this.analytics.canonical(s,...w.current,now),this.analytics.canonical(s,...w.previous,now)]),items=diagnose(current,previous).map((d,i)=>toOpportunity(d,i,current));
  return {generatedAt:now.toISOString(),items:rankOpportunities(items.filter(o=>o.stage!=='data'&&o.stage!=='delivery')),measurementWarnings:items.filter(o=>o.stage==='data'),dataHealth:aggregateHealth(Object.values(current))};
 }
 private async trends(s:Scope,range:7|30|90,now:Date){
  const bucketDays=range===90?7:1,buckets=Math.ceil(range/bucketDays),starts=Array.from({length:buckets},(_,i)=>new Date(now.getTime()-(buckets-i)*bucketDays*DAY));
  const metrics=await Promise.all(starts.map(from=>this.analytics.canonical(s,from,new Date(Math.min(now.getTime(),from.getTime()+bucketDays*DAY)),now)));
  const points=(key:MetricKey):TrendPoint[]=>metrics.map((m,i)=>toTrendPoint(starts[i]!.toISOString().slice(0,10),m[key]));
  return {activation:points('activation_rate'),connection:points('direct_reply_connection_rate'),d7_retention:points('d7_active_retention')};
 }
 private async retention(s:Scope,range:7|30|90,now:Date):Promise<RetentionCohort[]>{
  const from=new Date(now.getTime()-range*DAY),cfg=await this.settings.get(s);
  const [aggregateResult,episodeResult,eventResult,cursorResult,gapResult,trackingResult]=await Promise.all([
   sql<{cohort_day:Date|string;members:number;d30_active:number}>`SELECT cohort_day,members,d30_active FROM retention_cohorts WHERE ${tenant(s)} AND cohort_day>=${from}::date ORDER BY cohort_day`.execute(this.db),
   sql<{id:string;joined_at:Date}>`SELECT id,joined_at FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION' AND joined_at>=${from} ORDER BY joined_at`.execute(this.db),
   sql<{episode_id:string;kind:string;occurred_at:Date}>`SELECT episode_id,kind,occurred_at FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND occurred_at>=${from}`.execute(this.db),
   sql<{first_seen:Date;last_seen:Date}>`SELECT first_seen,last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db),
   sql<{started_at:Date;ended_at:Date|null}>`SELECT started_at,ended_at FROM telemetry_health WHERE ${tenant(s)} AND started_at<${now} AND (ended_at IS NULL OR ended_at>${from})`.execute(this.db),
   sql<{started_at:Date}>`SELECT started_at FROM retention_tracking WHERE ${tenant(s)}`.execute(this.db)
  ]),aggregate=aggregateResult.rows,episodes=episodeResult.rows,events=eventResult.rows,cursor=cursorResult.rows[0],gaps=gapResult.rows.map(g=>({start:g.started_at.getTime(),end:g.ended_at?.getTime()??null})),tracking=trackingResult.rows[0];
  const rawByDay=new Map<string,typeof episodes>();for(const e of episodes){const day=e.joined_at.toISOString().slice(0,10),list=rawByDay.get(day)??[];list.push(e);rawByDay.set(day,list);}
  const aggregateByDay=new Map(aggregate.map(r=>[new Date(r.cohort_day).toISOString().slice(0,10),r]));
  return [...new Set([...aggregateByDay.keys(),...rawByDay.keys()])].sort().map(cohort=>{
   const row=aggregateByDay.get(cohort),members=row?.members??rawByDay.get(cohort)?.length??0,joinedAt=Date.parse(`${cohort}T00:00:00Z`),raw=rawByDay.get(cohort)??[],withinRetention=joinedAt>=now.getTime()-cfg.detailedRetentionDays*DAY;
   const windowCoverage=(day:number)=>Math.min(telemetryCoverage(joinedAt,joinedAt+DAY,cursor?.first_seen.getTime()??null,cursor?.last_seen.getTime()??null,gaps,now.getTime()),telemetryCoverage(joinedAt+day*DAY,joinedAt+(day+1)*DAY,cursor?.first_seen.getTime()??null,cursor?.last_seen.getTime()??null,gaps,now.getTime()));
   const rate=(day:number)=>{if(now.getTime()<joinedAt+(day+1)*DAY||!withinRetention||!raw.length||windowCoverage(day)<1)return null;const yes=raw.filter(e=>events.some(f=>f.episode_id===e.id&&ACTIVE_KINDS.has(f.kind)&&f.occurred_at.getTime()>=e.joined_at.getTime()+day*DAY&&f.occurred_at.getTime()<e.joined_at.getTime()+(day+1)*DAY)).length;return yes/raw.length;};
   const d1Coverage=windowCoverage(1),d7Coverage=windowCoverage(7),d30Coverage=windowCoverage(30),d1=rate(1),d7=rate(7),d30=now.getTime()>=joinedAt+31*DAY&&row&&members&&tracking&&tracking.started_at.getTime()<=joinedAt&&d30Coverage===1?row.d30_active/members:null,matureRatios=[{day:1,ratio:d1Coverage},{day:7,ratio:d7Coverage},{day:30,ratio:d30Coverage}].filter(item=>now.getTime()>=joinedAt+(item.day+1)*DAY).map(item=>item.ratio),ratio=matureRatios.length?Math.min(...matureRatios):null,status=ratio===null?'unavailable':ratio===1?'healthy':ratio>0?'degraded':'unavailable';
   return {cohort,members,d1,d7,d30,maturity:{d1:retentionMaturity(d1,joinedAt,1,now.getTime(),withinRetention&&d1Coverage===1),d7:retentionMaturity(d7,joinedAt,7,now.getTime(),withinRetention&&d7Coverage===1),d30:retentionMaturity(d30,joinedAt,30,now.getTime(),Boolean(row)&&d30Coverage===1)},coverage:{status,coverageRatio:ratio,label:status==='healthy'?'healthy':status==='degraded'?'partial':'unavailable',notes:status==='healthy'?[]:['retention_gap']}};
  });
 }
 private async replyDistribution(s:Scope,range:7|30|90,now:Date):Promise<ResponseDistribution[]>{
  const from=new Date(now.getTime()-range*DAY),cfg=await this.settings.get(s),rows=(await sql<{occurred_at:Date;data:Record<string,unknown>}>`SELECT DISTINCT ON(e.id) f.occurred_at,f.data FROM membership_episodes e JOIN lifecycle_events f ON f.organization_id=e.organization_id AND f.guild_id=e.guild_id AND f.episode_id=e.id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.context='PRODUCTION' AND e.joined_at>=${from} AND e.joined_at<${now} AND f.context='PRODUCTION' AND f.kind='message.sent' AND f.occurred_at>=e.joined_at AND f.occurred_at<e.joined_at+make_interval(hours=>${cfg.activationWindowHours}) ORDER BY e.id,f.occurred_at`.execute(this.db)).rows.filter(row=>row.occurred_at.getTime()+DAY<=now.getTime());
  const counts=[0,0,0,0,0];for(const row of rows){const seconds=typeof row.data.firstReplyLatencySeconds==='number'?row.data.firstReplyLatencySeconds:Infinity;counts[seconds<300?0:seconds<3600?1:seconds<21600?2:seconds<=86400?3:4]!++;}
  const keys=['under_5m','5m_1h','1h_6h','6h_24h','unanswered_24h'] as const;return keys.map((bucket,i)=>({bucket,count:rows.length?counts[i]!:null,rate:rows.length?counts[i]!/rows.length:null}));
 }
 async journey(s:Scope,range:7|30|90=30,now=new Date()):Promise<JourneyPresentation>{
  const from=new Date(now.getTime()-range*DAY),[metrics,trends,retention,firstReplyDistribution]=await Promise.all([this.analytics.canonical(s,from,now,now),this.trends(s,range,now),this.retention(s,range,now),this.replyDistribution(s,range,now)]);
  return {generatedAt:now.toISOString(),range,funnel:toJourney(metrics),trends,retention,firstReplyDistribution,dataHealth:aggregateHealth(Object.values(metrics))};
 }
 async actions(s:Scope,now=new Date()):Promise<ActionsPresentation>{
  const rows=(await sql<{id:string;version:number;definition:unknown}>`SELECT r.id,r.version,r.definition FROM guild_config_heads h JOIN guild_config_revisions r ON r.organization_id=h.organization_id AND r.guild_id=h.guild_id AND r.id=h.revision_id WHERE h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId} AND h.domain='intervention'`.execute(this.db)).rows;
  const items=[];for(const row of rows){const runs=(await sql<{id:string;state:string}>`SELECT id,state FROM intervention_runs WHERE ${tenant(s)} AND revision_id=${row.id}::uuid ORDER BY created_at DESC LIMIT 500`.execute(this.db)).rows;items.push(toAction({id:row.id,version:row.version,definition:interventionSchema.parse(row.definition) as InterventionDefinition},runs));}
  return {generatedAt:now.toISOString(),templates:actionTemplates,items};
 }
 async results(s:Scope,now=new Date()):Promise<ResultsPresentation>{
  const rows=(await sql<{id:string;definition:unknown;published_at:Date|null}>`SELECT id,definition,published_at FROM guild_config_revisions WHERE ${tenant(s)} AND domain='experiment' AND state='published' ORDER BY published_at DESC LIMIT 20`.execute(this.db)).rows;
  const items=[];for(const row of rows){const result=await new ExperimentService(this.db).result(s,row.id,now);items.push(toExperiment({id:row.id,definition:experimentSchema.parse(row.definition) as ExperimentDefinition,publishedAt:row.published_at?.toISOString()??null},result));}
  return {generatedAt:now.toISOString(),items};
 }
}
