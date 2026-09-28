import {randomUUID} from 'node:crypto';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {Scope} from '../../../packages/shared/src/index.js';
import {SettingsService} from '../../../packages/settings/src/index.js';
import {AnalyticsService} from '../../../packages/analytics/src/index.js';
import {diagnose} from '../../../packages/analytics/src/diagnoses.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import {resolveLocale,t} from '../../../packages/discord-panels/src/i18n/index.js';

const DAY=86400000;
function zoned(now:Date,timeZone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',hourCycle:'h23',minute:'numeric'}).formatToParts(now);const value=(kind:string)=>Number(parts.find(part=>part.type===kind)?.value);return {year:value('year'),month:value('month'),day:value('day'),hour:value('hour'),minute:value('minute')};}
function localMidnight(utcDate:number,timeZone:string){const target=new Date(utcDate),targetTime=Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),target.getUTCDate());let guess=targetTime;for(let i=0;i<3;i++){const local=zoned(new Date(guess),timeZone),apparent=Date.UTC(local.year,local.month-1,local.day,local.hour,local.minute);guess+=targetTime-apparent;}return new Date(guess);}
export function previousCompleteWeek(now:Date,timeZone='UTC'){const local=zoned(now,timeZone),day=Date.UTC(local.year,local.month-1,local.day),weekday=(new Date(day).getUTCDay()+6)%7,monday=day-weekday*DAY;return {from:localMidnight(monday-7*DAY,timeZone),to:localMidnight(monday,timeZone)};}
export class WeeklySummaryWorker {
 constructor(private readonly db:Database,private readonly discord:DiscordPort,private readonly settings=new SettingsService(db),private readonly analytics=new AnalyticsService(db,settings)){}
 async tick(s:Scope,now=new Date()){
  const cfg=await this.settings.get(s);if(!cfg.weeklySummaryEnabled||!cfg.weeklySummaryChannelId)return false;
  const local=zoned(now,cfg.timezone),weekday=(new Date(Date.UTC(local.year,local.month-1,local.day)).getUTCDay()+6)%7,sendDay=(cfg.weeklySummaryDay+6)%7;
  if(weekday<sendDay||weekday===sendDay&&local.hour<cfg.weeklySummaryHour)return false;
  const {from,to}=previousCompleteWeek(now,cfg.timezone),weekDate=zoned(from,cfg.timezone),week=`${weekDate.year}-${String(weekDate.month).padStart(2,'0')}-${String(weekDate.day).padStart(2,'0')}`;
  await sql`UPDATE weekly_summary_deliveries SET state='unknown',status_note='weekly.deliveryUnknown',lease_until=NULL WHERE ${tenant(s)} AND state='sending' AND COALESCE(lease_until,attempted_at+interval '15 minutes')<${now}`.execute(this.db);
  await sql`UPDATE weekly_summary_deliveries SET state='ready',lease_until=NULL WHERE ${tenant(s)} AND state='preparing' AND lease_until<${now}`.execute(this.db);
  const reserved=(await sql`INSERT INTO weekly_summary_deliveries(organization_id,guild_id,week_start,channel_id,state,lease_until,attempted_at) VALUES(${s.organizationId}::uuid,${s.guildId},${week}::date,${cfg.weeklySummaryChannelId},'preparing',${new Date(now.getTime()+15*60000)},NULL) ON CONFLICT(organization_id,guild_id,week_start) DO UPDATE SET state='preparing',channel_id=EXCLUDED.channel_id,lease_until=EXCLUDED.lease_until,status_note=NULL WHERE weekly_summary_deliveries.state='ready' RETURNING week_start`.execute(this.db)).rows.length>0;
  if(!reserved)return false;
  let sendStarted=false;
  try{
   await this.discord.checkChannel(s.guildId,cfg.weeklySummaryChannelId);
   const priorFrom=previousCompleteWeek(from,cfg.timezone).from;
   const [current,previous]=await Promise.all([this.analytics.canonical(s,from,to,now),this.analytics.canonical(s,priorFrom,from,now)]);
   const locale=resolveLocale(cfg.uiLanguage),count=(metric:typeof current.new_members)=>metric.numerator??metric.sampleSize,rate=(metric:typeof current.new_members)=>metric.value===null?t(locale,'weekly.collecting'):`${Math.round(metric.value*100)}%`,change=(a:number,b:number)=>`${a-b>=0?'+':''}${a-b}`;
   const issue=diagnose(current,previous).find(item=>item.type!=='DATA_COVERAGE_DROP');
   const replyIssue=issue?.type==='CONNECTION_DROP'||issue?.type==='REPLY_LATENCY_SPIKE';
   const dashboardUrl=process.env.NEXUS_WEB_URL?.trim();
   const improvementLink=dashboardUrl||t(locale,'weekly.panelLink');
   const content=[
    t(locale,'weekly.title',{week}),
    t(locale,'weekly.newMembers',{count:count(current.new_members),change:change(count(current.new_members),count(previous.new_members))}),
    t(locale,'weekly.success',{count:count(current.activation_rate),total:current.activation_rate.denominator??0,rate:rate(current.activation_rate)}),
    t(locale,'weekly.reply',{count:count(current.direct_reply_connection_rate),total:current.direct_reply_connection_rate.denominator??0,rate:rate(current.direct_reply_connection_rate)}),
    t(locale,'weekly.active',{count:count(current.d7_active_retention),total:current.d7_active_retention.denominator??0,rate:rate(current.d7_active_retention)}),
    t(locale,'weekly.attention',{detail:t(locale,issue?replyIssue?'weekly.replyIssue':'weekly.goalIssue':'weekly.noIssue')}),
    t(locale,'weekly.recommendation',{detail:t(locale,replyIssue?'weekly.replyRecommendation':'weekly.goalRecommendation')}),
    t(locale,'weekly.view',{link:improvementLink})
   ].join('\n');
   await sql`UPDATE weekly_summary_deliveries SET state='ready' WHERE ${tenant(s)} AND week_start=${week}::date AND state='preparing'`.execute(this.db);
   await sql`UPDATE weekly_summary_deliveries SET state='sending',attempted_at=${now} WHERE ${tenant(s)} AND week_start=${week}::date AND state='ready'`.execute(this.db);
   sendStarted=true;
   const messageId=await this.discord.sendPanel(cfg.weeklySummaryChannelId,{content,allowed_mentions:{parse:[]}},randomUUID());
   await sql`UPDATE weekly_summary_deliveries SET state='sent',message_id=${messageId},lease_until=NULL,status_note=NULL WHERE ${tenant(s)} AND week_start=${week}::date`.execute(this.db);
   return true;
  }catch{
   // Once Discord send starts, an unknown result must not be retried automatically.
   await sql`UPDATE weekly_summary_deliveries SET state=${sendStarted?'unknown':'ready'},lease_until=NULL,status_note=${sendStarted?'weekly.deliveryUnknown':'weekly.prepareFailed'} WHERE ${tenant(s)} AND week_start=${week}::date`.execute(this.db);
   return false;
  }
 }
}
