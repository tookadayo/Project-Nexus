import {sql,tenant,type Database} from '../../db/src/index.js';
import type {Scope} from '../../shared/src/index.js';
import {AnalyticsService} from '../../analytics/src/index.js';
import {diagnose} from '../../analytics/src/diagnoses.js';
import type {MetricKey} from '../../analytics/src/registry.js';
import {SettingsService} from '../../settings/src/index.js';
import {domainRevisions} from '../../settings/src/domain-config.js';
import {activationSchema} from '../../lifecycle/src/activation.js';
import {interventionSchema,type InterventionDefinition} from '../../lifecycle/src/interventions.js';
import {experimentSchema,ExperimentService,type ExperimentDefinition} from '../../lifecycle/src/experiments.js';
import {actionTemplates} from './templates.js';
import {aggregateHealth,retentionMaturity,toAction,toExperiment,toJourney,toKpi,toOpportunity,toTrendPoint} from './adapters.js';
import type {ActionsPresentation,HomePresentation,JourneyPresentation,OpportunitiesPresentation,ResponseDistribution,ResultsPresentation,RetentionCohort,SetupState,TrendPoint} from './types.js';

const DAY=86400000;
const ACTIVE_KINDS=new Set(['message.sent','reaction.added','voice.duration','scheduled_event.subscribed','fallback.answer','nexus_onboarding.answered','interaction.used']);
export class PresentationService{
 private readonly analytics:AnalyticsService;
 private readonly settings:SettingsService;
 constructor(private readonly db:Database){this.settings=new SettingsService(db);this.analytics=new AnalyticsService(db,this.settings);}

 private windows(now:Date){const end=now.getTime();return {current:[new Date(end-30*DAY),now] as const,previous:[new Date(end-60*DAY),new Date(end-30*DAY)] as const};}
 private async setup(s:Scope):Promise<SetupState>{
  const cfg=await this.settings.get(s),activation=await domainRevisions(this.db).current(s,'activation');let preset:SetupState['activationPreset']='not_configured';
  if(activation){const definition=activationSchema.parse(activation.definition),text=JSON.stringify(definition.rule);preset=text.includes('reply.received')?'reply':text.includes('scheduled_event.subscribed')?'event':text.includes('message.sent')?'message':'custom';}
  return {required:!cfg.enabled||!activation||!cfg.onboardingEnabled,steps:[{key:'connect',complete:cfg.enabled},{key:'activation',complete:Boolean(activation)},{key:'onboarding',complete:cfg.onboardingEnabled},{key:'measuring',complete:cfg.enabled&&Boolean(activation)}],activationPreset:preset,activationWindowDays:cfg.activationWindowHours/24};
 }
 async home(s:Scope,now=new Date()):Promise<HomePresentation>{
  const w=this.windows(now),[current,previous,setup]=await Promise.all([this.analytics.canonical(s,...w.current,now),this.analytics.canonical(s,...w.previous,now),this.setup(s)]);
  const opportunities=diagnose(current,previous).map((d,i)=>toOpportunity(d,i,current));
  const ranked=[...opportunities].sort((a,b)=>(b.severity==='critical'?2:1)-(a.severity==='critical'?2:1));
  const keys=['new_members','activation_rate','direct_reply_connection_rate','d7_active_retention'] as const;
  return {generatedAt:now.toISOString(),kpis:keys.map(key=>toKpi(key,current[key],previous[key])),journey:toJourney(current),largestOpportunity:ranked[0]??null,suggestedAction:ranked[0]?.suggestedAction??null,dataHealth:aggregateHealth(keys.map(k=>current[k])),setup};
 }
 async opportunities(s:Scope,now=new Date()):Promise<OpportunitiesPresentation>{
  const w=this.windows(now),[current,previous]=await Promise.all([this.analytics.canonical(s,...w.current,now),this.analytics.canonical(s,...w.previous,now)]),items=diagnose(current,previous).map((d,i)=>toOpportunity(d,i,current));
  return {generatedAt:now.toISOString(),items,dataHealth:aggregateHealth(Object.values(current))};
 }
 private async trends(s:Scope,range:7|30|90,now:Date){
  const bucketDays=range===90?7:1,buckets=Math.ceil(range/bucketDays),starts=Array.from({length:buckets},(_,i)=>new Date(now.getTime()-(buckets-i)*bucketDays*DAY));
  const metrics=await Promise.all(starts.map(from=>this.analytics.canonical(s,from,new Date(Math.min(now.getTime(),from.getTime()+bucketDays*DAY)),now)));
  const points=(key:MetricKey):TrendPoint[]=>metrics.map((m,i)=>toTrendPoint(starts[i]!.toISOString().slice(0,10),m[key]));
  return {activation:points('activation_rate'),connection:points('direct_reply_connection_rate'),d7_retention:points('d7_active_retention')};
 }
 private async retention(s:Scope,range:7|30|90,now:Date):Promise<RetentionCohort[]>{
  const from=new Date(now.getTime()-range*DAY),cfg=await this.settings.get(s);
  const [aggregateResult,episodeResult,eventResult]=await Promise.all([
   sql<{cohort_day:Date|string;members:number;d30_active:number}>`SELECT cohort_day,members,d30_active FROM retention_cohorts WHERE ${tenant(s)} AND cohort_day>=${from}::date ORDER BY cohort_day`.execute(this.db),
   sql<{id:string;joined_at:Date}>`SELECT id,joined_at FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION' AND joined_at>=${from} ORDER BY joined_at`.execute(this.db),
   sql<{episode_id:string;kind:string;occurred_at:Date}>`SELECT episode_id,kind,occurred_at FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND occurred_at>=${from}`.execute(this.db)
  ]),aggregate=aggregateResult.rows,episodes=episodeResult.rows,events=eventResult.rows;
  const rawByDay=new Map<string,typeof episodes>();for(const e of episodes){const day=e.joined_at.toISOString().slice(0,10),list=rawByDay.get(day)??[];list.push(e);rawByDay.set(day,list);}
  const aggregateByDay=new Map(aggregate.map(r=>[new Date(r.cohort_day).toISOString().slice(0,10),r]));
  return [...new Set([...aggregateByDay.keys(),...rawByDay.keys()])].sort().map(cohort=>{
   const row=aggregateByDay.get(cohort),members=row?.members??rawByDay.get(cohort)?.length??0,joinedAt=Date.parse(`${cohort}T00:00:00Z`),raw=rawByDay.get(cohort)??[],withinRetention=joinedAt>=now.getTime()-cfg.detailedRetentionDays*DAY;
   const rate=(day:number)=>{if(now.getTime()<joinedAt+(day+1)*DAY||!withinRetention||!raw.length)return null;const yes=raw.filter(e=>events.some(f=>f.episode_id===e.id&&ACTIVE_KINDS.has(f.kind)&&f.occurred_at.getTime()>=e.joined_at.getTime()+day*DAY&&f.occurred_at.getTime()<e.joined_at.getTime()+(day+1)*DAY)).length;return yes/raw.length;};
   const d1=rate(1),d7=rate(7),d30=now.getTime()>=joinedAt+31*DAY&&row&&members?row.d30_active/members:null;
   return {cohort,members,d1,d7,d30,maturity:{d1:retentionMaturity(d1,joinedAt,1,now.getTime(),withinRetention),d7:retentionMaturity(d7,joinedAt,7,now.getTime(),withinRetention),d30:retentionMaturity(d30,joinedAt,30,now.getTime(),Boolean(row))},coverage:{status:withinRetention?'healthy':'unavailable',coverageRatio:withinRetention?1:null,label:withinRetention?'healthy':'unavailable',notes:withinRetention?[]:['Detailed observations for this cohort are outside the configured retention window.']}};
  });
 }
 private async replyDistribution(s:Scope,range:7|30|90,now:Date):Promise<ResponseDistribution[]>{
  const from=new Date(now.getTime()-range*DAY),rows=(await sql<{occurred_at:Date;data:Record<string,unknown>}>`SELECT occurred_at,data FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND kind='message.sent' AND occurred_at>=${from} AND occurred_at<=${new Date(now.getTime()-DAY)}`.execute(this.db)).rows;
  const counts=[0,0,0,0,0];for(const row of rows){const seconds=typeof row.data.firstReplyLatencySeconds==='number'?row.data.firstReplyLatencySeconds:Infinity;counts[seconds<300?0:seconds<3600?1:seconds<21600?2:seconds<=86400?3:4]!++;}
  const keys=['under_5m','5m_1h','1h_6h','6h_24h','unanswered_24h'] as const;return keys.map((bucket,i)=>({bucket,count:rows.length?counts[i]!:null,rate:rows.length?counts[i]!/rows.length:null}));
 }
 async journey(s:Scope,range:7|30|90=30,now=new Date()):Promise<JourneyPresentation>{
  const from=new Date(now.getTime()-range*DAY),[metrics,trends,retention,firstReplyDistribution]=await Promise.all([this.analytics.canonical(s,from,now,now),this.trends(s,range,now),this.retention(s,range,now),this.replyDistribution(s,range,now)]);
  return {generatedAt:now.toISOString(),range,funnel:toJourney(metrics),trends,retention,firstReplyDistribution,dataHealth:aggregateHealth(Object.values(metrics))};
 }
 async actions(s:Scope,now=new Date()):Promise<ActionsPresentation>{
  const rows=(await sql<{id:string;version:number;definition:unknown}>`SELECT r.id,r.version,r.definition FROM guild_config_heads h JOIN guild_config_revisions r ON r.organization_id=h.organization_id AND r.guild_id=h.guild_id AND r.id=h.revision_id WHERE h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId} AND h.domain='intervention'`.execute(this.db)).rows;
  const items=[];for(const row of rows){const states=(await sql<{state:string}>`SELECT state FROM intervention_runs WHERE ${tenant(s)} AND revision_id=${row.id}::uuid ORDER BY created_at DESC LIMIT 500`.execute(this.db)).rows.map(r=>r.state);items.push(toAction({id:row.id,version:row.version,definition:interventionSchema.parse(row.definition) as InterventionDefinition},states));}
  return {generatedAt:now.toISOString(),templates:actionTemplates,items};
 }
 async results(s:Scope,now=new Date()):Promise<ResultsPresentation>{
  const rows=(await sql<{id:string;definition:unknown;published_at:Date|null}>`SELECT id,definition,published_at FROM guild_config_revisions WHERE ${tenant(s)} AND domain='experiment' AND state='published' ORDER BY published_at DESC LIMIT 20`.execute(this.db)).rows;
  const items=[];for(const row of rows){const result=await new ExperimentService(this.db).result(s,row.id,now);items.push(toExperiment({id:row.id,definition:experimentSchema.parse(row.definition) as ExperimentDefinition,publishedAt:row.published_at?.toISOString()??null},result));}
  return {generatedAt:now.toISOString(),items};
 }
}
