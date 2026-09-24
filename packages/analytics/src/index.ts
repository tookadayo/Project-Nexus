import {sql,tenant,json,type Database} from '../../db/src/index.js';
import type {Scope} from '../../shared/src/index.js';
import {SettingsService} from '../../settings/src/index.js';
import {canonicalMetrics,inputCoverage,type CoverageMetric} from './registry.js';
export type MetricValue={value:number|null,sampleSize:number,coverage:'COMPLETE'|'PARTIAL'|'UNAVAILABLE',coverageRatio:number};
export type MetricEpisode={id:string,joinedAt:number,context:string};
export type MetricEvent={episodeId:string,kind:string,at:number,context:string,data:Record<string,unknown>};
export type Overview=Record<string,MetricValue>;
const day=86400000;
function quantile(values:number[],p:number){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);const i=(sorted.length-1)*p;return sorted[Math.floor(i)]!+(sorted[Math.ceil(i)]!-sorted[Math.floor(i)]!)*(i%1);}
export function computeOverview(episodes:MetricEpisode[],events:MetricEvent[],from:number,to:number,asOf:number,coverageRatio:number,activationHours=168):Overview {
 const cohort=[...new Map(episodes.filter(e=>e.context==='PRODUCTION'&&e.joinedAt>=from&&e.joinedAt<to&&e.joinedAt<=asOf).map(e=>[e.id,e])).values()];
 const activity=events.filter(e=>e.context==='PRODUCTION'&&e.at<=asOf);
 const byEpisode=new Map(cohort.map(e=>[e.id,activity.filter(a=>a.episodeId===e.id&&a.at>=e.joinedAt)]));
 const metric=(value:number|null,n:number):MetricValue=>({value:coverageRatio===0?null:value,sampleSize:n,coverage:coverageRatio===0?'UNAVAILABLE':coverageRatio<1?'PARTIAL':'COMPLETE',coverageRatio});
 const rate=(numerator:number,denominator:number)=>metric(denominator?numerator/denominator:null,denominator);
 const started=cohort.filter(e=>byEpisode.get(e.id)!.some(a=>a.kind==='nexus_onboarding.started'));
 const completed=started.filter(e=>byEpisode.get(e.id)!.some(a=>a.kind==='nexus_onboarding.completed'));
 const mature=cohort.filter(e=>e.joinedAt+activationHours*3600000<=asOf);
 const activated=(e:MetricEpisode)=>byEpisode.get(e.id)!.filter(a=>a.kind==='activation.completed'&&a.at<=e.joinedAt+activationHours*3600000);
 const ttfv=cohort.flatMap(e=>{const values=activated(e);return values.length?[(Math.min(...values.map(a=>a.at))-e.joinedAt)/1000]:[];});
 const firstMessages=cohort.flatMap(e=>{const m=byEpisode.get(e.id)!.filter(a=>a.kind==='message.sent'&&a.at<e.joinedAt+activationHours*3600000).sort((a,b)=>a.at-b.at)[0];return m?[m]:[];});
 const responseEligible=firstMessages.filter(m=>m.at+day<=asOf);
 const latency=(m:MetricEvent)=>typeof m.data.firstReplyLatencySeconds==='number'?m.data.firstReplyLatencySeconds:Infinity;
 const replyTimes=responseEligible.filter(m=>latency(m)<=86400).map(latency);
 const result:Overview={
  newMembers:metric(cohort.length,cohort.length),onboardingStartRate:rate(started.length,cohort.length),onboardingCompletionRate:rate(completed.length,started.length),
  activationRate:rate(mature.filter(e=>activated(e).length).length,mature.length),
  silentJoinerRate:rate(mature.filter(e=>!byEpisode.get(e.id)!.some(a=>a.kind==='message.sent'&&a.at<e.joinedAt+activationHours*3600000)).length,mature.length),
  medianTtfvSeconds:metric(quantile(ttfv,0.5),ttfv.length),p75TtfvSeconds:metric(quantile(ttfv,0.75),ttfv.length),
  firstResponseRate:rate(replyTimes.length,responseEligible.length),medianFirstResponseSeconds:metric(quantile(replyTimes,0.5),replyTimes.length)
 };
 for(const d of [1,7,30]){const eligible=cohort.filter(e=>e.joinedAt+(d+1)*day<=asOf);result[`d${d}ActiveRetention`]=rate(eligible.filter(e=>byEpisode.get(e.id)!.some(a=>a.kind==='message.sent'&&a.at>=e.joinedAt+d*day&&a.at<e.joinedAt+(d+1)*day)).length,eligible.length);}
 for(const h of [1,6,24]){const eligible=firstMessages.filter(m=>m.at+h*3600000<=asOf);result[`unansweredAfter${h}h`]=metric(eligible.filter(m=>latency(m)>h*3600).length,eligible.length);}
 return result;
}
export function coverage(from:number,to:number,firstSeen:number|null,lastSeen:number|null,gaps:{start:number,end:number|null}[],now:number){
 if(firstSeen===null||lastSeen===null||to<=from)return 0;
 const end=Math.min(to,now,lastSeen+90000);const start=Math.max(from,firstSeen);if(end<=start)return 0;
 const intervals=gaps.map(g=>[Math.max(start,g.start),Math.min(end,g.end??now)] as const).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 let missing=0,cursor=start;for(const [a,b] of intervals){missing+=Math.max(0,b-Math.max(a,cursor));cursor=Math.max(cursor,b);}
 return Math.max(0,Math.min(1,(end-start-missing)/(to-from)));
}
export class AnalyticsService {
 constructor(private readonly db:Database,private readonly settings:SettingsService){}
 async canonical(s:Scope,from?:Date,to=new Date(),asOf=new Date()){
  const defaultWindow=from===undefined;from??=new Date(asOf.getTime()-30*day);
  const cfg=await this.settings.get(s);
  const episodes=(await sql<{id:string,joined_at:Date,context:string}>`SELECT id,joined_at,context FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION' AND joined_at>=${from} AND joined_at<${to}`.execute(this.db)).rows;
  const events=(await sql<{episode_id:string,kind:string,occurred_at:Date,context:string,data:Record<string,unknown>}>`SELECT episode_id,kind,occurred_at,context,data FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND occurred_at>=${from} AND occurred_at<=${asOf}`.execute(this.db)).rows;
  const activationState=(await sql<{episode_id:string,activated_at:Date}>`SELECT episode_id,activated_at FROM activation_members WHERE ${tenant(s)} AND activated_at IS NOT NULL UNION ALL SELECT episode_id,activated_at FROM member_lifecycle_state WHERE ${tenant(s)} AND activated_at IS NOT NULL`.execute(this.db)).rows;
  for(const state of activationState)if(!events.some(e=>e.episode_id===state.episode_id&&e.kind==='activation.completed'))events.push({episode_id:state.episode_id,kind:'activation.completed',occurred_at:state.activated_at,context:'PRODUCTION',data:{}});
  const cursor=(await sql<{first_seen:Date,last_seen:Date}>`SELECT first_seen,last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db)).rows[0];
  const gaps=(await sql<{started_at:Date,ended_at:Date|null}>`SELECT started_at,ended_at FROM telemetry_health WHERE ${tenant(s)} AND started_at<${asOf} AND (ended_at IS NULL OR ended_at>${from})`.execute(this.db)).rows;
  const coverageEnd=Math.min(to.getTime(),asOf.getTime());
  const ratio=coverage(from.getTime(),coverageEnd,cursor?Math.max(cursor.first_seen.getTime(),Date.now()-cfg.detailedRetentionDays*day):null,cursor?.last_seen.getTime()??null,gaps.map(g=>({start:g.started_at.getTime(),end:g.ended_at?.getTime()??null})),asOf.getTime());
  const expected=coverageEnd-from.getTime(),observed=Math.floor(expected*ratio);
  const coverageMap:Record<string,CoverageMetric>={members:inputCoverage('members',cursor?expected:null,cursor?observed:null),messages:inputCoverage('messages',cursor?expected:null,cursor?observed:null),activity:inputCoverage('activity',cursor?expected:null,cursor?observed:null),activation:inputCoverage('activation',cursor?expected:null,cursor?observed:null)};
  const snapshots=(await sql<{expected:number,observed:number}>`SELECT count(*)::integer AS expected,count(*) FILTER(WHERE state='succeeded')::integer AS observed FROM native_snapshot_jobs WHERE ${tenant(s)} AND due_at>=${from} AND due_at<=${new Date(coverageEnd)}`.execute(this.db)).rows[0]!;
  coverageMap.native=inputCoverage('native',cfg.flags.native_snapshot_v2&&snapshots.expected?snapshots.expected:null,cfg.flags.native_snapshot_v2&&snapshots.expected?snapshots.observed:null);
  const capability=(await sql<{profile:{recommendedMode:string;nativeOnboardingEnabled?:boolean}}>`SELECT profile FROM guild_capabilities WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(this.db)).rows[0];
  const effectiveMode=cfg.onboardingMode==='auto'?capability?.profile.recommendedMode:cfg.onboardingMode;
  const onboardingUnavailable=inputCoverage('onboarding',null,null);
  coverageMap.onboarding=effectiveMode==='fallback'?(cfg.onboardingEnabled&&cfg.flowVersionId?coverageMap.members!:onboardingUnavailable):capability?.profile.nativeOnboardingEnabled?coverageMap.native:onboardingUnavailable;
  const pins=(await sql<{episode_id:string,revision_id:string,definition:{windowSeconds:number}}>`SELECT a.episode_id,a.revision_id,r.definition FROM activation_members a JOIN guild_config_revisions r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.id=a.revision_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId}`.execute(this.db)).rows;
  if(pins.some(p=>/native_onboarding\.|home_actions\.|screening\.passed/.test(JSON.stringify(p.definition)))){
   const native=coverageMap.native;coverageMap.activation=native.status==='unavailable'?inputCoverage('activation',null,null):inputCoverage('activation',expected,Math.min(observed,expected*(native.observed??0)/Math.max(1,native.expected??1)));
  }
  const metrics=canonicalMetrics(episodes.map(e=>({id:e.id,joinedAt:e.joined_at.getTime(),context:e.context})),events.map(e=>({episodeId:e.episode_id,kind:e.kind,at:e.occurred_at.getTime(),context:e.context,data:e.data})),from.getTime(),to.getTime(),asOf.getTime(),coverageMap,cfg.activationWindowHours*3600,Object.fromEntries(pins.map(p=>[p.episode_id,{id:p.revision_id,windowSeconds:p.definition.windowSeconds}])),true);
  if(defaultWindow)metrics.d30_active_retention=await this.matureD30(s,asOf);
  return metrics;
 }
 async matureD30(s:Scope,asOf=new Date()){
  // Thirty fully mature UTC join-day cohorts. Counters contain no member identifiers.
  const end=Date.parse(asOf.toISOString().slice(0,10))-31*day;
  const tracking=(await sql<{started_at:Date}>`SELECT started_at FROM retention_tracking WHERE ${tenant(s)}`.execute(this.db)).rows[0];
  const start=Math.min(end,Math.max(end-30*day,tracking?Math.ceil(tracking.started_at.getTime()/day)*day:end));
  const rows=(await sql<{cohort_day:Date|string,members:number,d30_active:number}>`SELECT * FROM retention_cohorts WHERE ${tenant(s)} AND cohort_day>=${new Date(start)}::date AND cohort_day<${new Date(end)}::date`.execute(this.db)).rows;
  const cursor=(await sql<{first_seen:Date,last_seen:Date}>`SELECT first_seen,last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db)).rows[0];
  const gaps=(await sql<{started_at:Date,ended_at:Date|null}>`SELECT started_at,ended_at FROM telemetry_health WHERE ${tenant(s)} AND started_at<${asOf} AND (ended_at IS NULL OR ended_at>${new Date(start)})`.execute(this.db)).rows.map(g=>({start:g.started_at.getTime(),end:g.ended_at?.getTime()??null}));
  let observed=0;for(let date=start;date<end;date+=day){if(!tracking||tracking.started_at.getTime()>date)continue;for(const [a,b] of [[date,date+day],[date+30*day,date+32*day]])observed+=(b!-a!)*coverage(a!,b!,cursor?.first_seen.getTime()??null,cursor?.last_seen.getTime()??null,gaps,asOf.getTime());}
  const expected=(end-start)*3,dataCoverage=inputCoverage('activity',cursor&&expected?expected:null,cursor&&expected?Math.floor(observed):null),denominator=rows.reduce((n,r)=>n+r.members,0),numerator=rows.reduce((n,r)=>n+r.d30_active,0);
  return {metricKey:'d30_active_retention' as const,metricVersion:2,value:denominator&&dataCoverage.status==='healthy'?numerator/denominator:null,numerator,denominator,sampleSize:denominator,window:{from:new Date(start).toISOString(),to:new Date(end).toISOString(),asOf:asOf.toISOString()},dataCoverage,provisional:false};
 }
 async materialize(s:Scope){
  const dayKey=new Date().toISOString().slice(0,10),metrics=await this.canonical(s);
  await sql`INSERT INTO daily_guild_metrics VALUES(${s.organizationId}::uuid,${s.guildId},${dayKey}::date,${json({kind:'rolling_30d_snapshot',generatedAt:new Date().toISOString(),metrics})}) ON CONFLICT(organization_id,guild_id,day) DO UPDATE SET metrics=EXCLUDED.metrics`.execute(this.db);
 }
 async overview(s:Scope,from=new Date(Date.now()-30*day),to=new Date(),asOf=new Date()):Promise<Overview>{
  if(to<=from||to.getTime()-from.getTime()>45*day)throw new Error('Overview window must be within 45 days');
  return this.db.transaction().setIsolationLevel('repeatable read').execute(async tx=>{
   const cfg=await this.settings.get(s,tx);
   const episodes=(await sql<{id:string,joined_at:Date,context:string}>`SELECT id,joined_at,context FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION' AND joined_at>=${from} AND joined_at<${to}`.execute(tx)).rows;
   const events=(await sql<{episode_id:string,kind:string,occurred_at:Date,context:string,data:Record<string,unknown>}>`SELECT episode_id,kind,occurred_at,context,data FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND occurred_at>=${from} AND occurred_at<=${asOf}`.execute(tx)).rows;
   const cursor=(await sql<{first_seen:Date,last_seen:Date}>`SELECT first_seen,last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(tx)).rows[0];
   const gaps=(await sql<{started_at:Date,ended_at:Date|null}>`SELECT started_at,ended_at FROM telemetry_health WHERE ${tenant(s)} AND started_at<${asOf} AND (ended_at IS NULL OR ended_at>${from})`.execute(tx)).rows;
   const ratio=coverage(from.getTime(),asOf.getTime(),cursor?.first_seen.getTime()??null,cursor?.last_seen.getTime()??null,gaps.map(g=>({start:g.started_at.getTime(),end:g.ended_at?.getTime()??null})),asOf.getTime());
   return computeOverview(episodes.map(e=>({id:e.id,joinedAt:e.joined_at.getTime(),context:e.context})),events.map(e=>({episodeId:e.episode_id,kind:e.kind,at:e.occurred_at.getTime(),context:e.context,data:e.data})),from.getTime(),to.getTime(),asOf.getTime(),ratio,cfg.activationWindowHours);
  });
 }
 async summary(s:Scope){const metrics=await this.overview(s);return Object.entries(metrics).map(([key,m])=>`${key}: ${m.value===null?'Unavailable':key.includes('Rate')||key.includes('Retention')?`${(m.value*100).toFixed(1)}%`:m.value.toFixed(1)} · n=${m.sampleSize} · ${m.coverage} (${Math.round(m.coverageRatio*100)}%)`).join('\n');}
}
