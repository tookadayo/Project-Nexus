import {randomUUID} from 'node:crypto';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {Scope} from '../../../packages/shared/src/index.js';
import {SettingsService} from '../../../packages/settings/src/index.js';
import {AnalyticsService} from '../../../packages/analytics/src/index.js';
import {diagnose} from '../../../packages/analytics/src/diagnoses.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';

const DAY=86400000;
export function previousCompleteWeek(now:Date){const utc=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),weekday=(now.getUTCDay()+6)%7,monday=utc-weekday*DAY;return {from:new Date(monday-7*DAY),to:new Date(monday)};}
export class WeeklySummaryWorker {
 constructor(private readonly db:Database,private readonly discord:DiscordPort,private readonly settings=new SettingsService(db),private readonly analytics=new AnalyticsService(db,settings)){}
 async tick(s:Scope,now=new Date()){
  const cfg=await this.settings.get(s);if(!cfg.weeklySummaryEnabled||!cfg.weeklySummaryChannelId)return false;
  const {from,to}=previousCompleteWeek(now),week=from.toISOString().slice(0,10);
  await sql`UPDATE weekly_summary_deliveries SET state='unknown',status_note='送信結果を確認できませんでした',lease_until=NULL WHERE ${tenant(s)} AND state='sending' AND COALESCE(lease_until,attempted_at+interval '15 minutes')<${now}`.execute(this.db);
  const reserved=(await sql`INSERT INTO weekly_summary_deliveries(organization_id,guild_id,week_start,channel_id,state,lease_until) VALUES(${s.organizationId}::uuid,${s.guildId},${week}::date,${cfg.weeklySummaryChannelId},'sending',${new Date(now.getTime()+15*60000)}) ON CONFLICT DO NOTHING RETURNING week_start`.execute(this.db)).rows.length>0;
  if(!reserved)return false;
  try{
   await this.discord.checkChannel(s.guildId,cfg.weeklySummaryChannelId);
   const [current,previous]=await Promise.all([this.analytics.canonical(s,from,to,now),this.analytics.canonical(s,new Date(from.getTime()-7*DAY),from,now)]);
   const ja=cfg.uiLanguage==='ja',count=(metric:typeof current.new_members)=>metric.numerator??metric.sampleSize,rate=(metric:typeof current.new_members)=>metric.value===null?ja?'収集中':'collecting':`${Math.round(metric.value*100)}%`,change=(a:number,b:number)=>`${a-b>=0?'+':''}${a-b}`;
   const issue=diagnose(current,previous).find(item=>item.type!=='DATA_COVERAGE_DROP');
   const replyIssue=issue?.type==='CONNECTION_DROP'||issue?.type==='REPLY_LATENCY_SPIKE';
   const dashboardUrl=process.env.NEXUS_WEB_URL?.trim();
   const improvementLink=dashboardUrl||'/nexus panel → Improve';
   const content=ja?[
    `NEXUS · 週間成長サマリー (${week})`,
    `新規メンバー: ${count(current.new_members)} (${change(count(current.new_members),count(previous.new_members))} 前週比)`,
    `成功した新規メンバー: ${count(current.activation_rate)} / ${current.activation_rate.denominator??0} · ${rate(current.activation_rate)}`,
    `返信を受けた: ${count(current.direct_reply_connection_rate)} / ${current.direct_reply_connection_rate.denominator??0} · ${rate(current.direct_reply_connection_rate)}`,
    `7日後も活動: ${count(current.d7_active_retention)} / ${current.d7_active_retention.denominator??0} · ${rate(current.d7_active_retention)}`,
    `今見るべきこと: ${issue?replyIssue?'返信が遅い、または届いていません':'最初の成功に届く人が減っています':'大きな問題は検出されていません'}`,
    `おすすめ: ${replyIssue?'返信がない人をスタッフに知らせる':'参加後に困っている人をスタッフに知らせる'}`,
    `改善を見る: ${dashboardUrl||'/nexus panel → 改善'}`
   ].join('\n'):[
    `NEXUS · Weekly growth summary (${week})`,
    `New members: ${count(current.new_members)} (${change(count(current.new_members),count(previous.new_members))} vs last week)`,
    `Successful newcomers: ${count(current.activation_rate)} / ${current.activation_rate.denominator??0} · ${rate(current.activation_rate)}`,
    `Received a reply: ${count(current.direct_reply_connection_rate)} / ${current.direct_reply_connection_rate.denominator??0} · ${rate(current.direct_reply_connection_rate)}`,
    `Active after 7 days: ${count(current.d7_active_retention)} / ${current.d7_active_retention.denominator??0} · ${rate(current.d7_active_retention)}`,
    `Needs attention: ${issue?replyIssue?'First replies are taking longer or missing':'Fewer newcomers are reaching first success':'No major issue detected'}`,
    `Recommended improvement: ${replyIssue?'Notify staff when someone has no reply':'Notify staff when a newcomer may need help'}`,
    `View improvement: ${improvementLink}`
   ].join('\n');
   const messageId=await this.discord.sendPanel(cfg.weeklySummaryChannelId,{content,allowed_mentions:{parse:[]}},randomUUID());
   await sql`UPDATE weekly_summary_deliveries SET state='sent',message_id=${messageId},lease_until=NULL,status_note=NULL WHERE ${tenant(s)} AND week_start=${week}::date`.execute(this.db);
   return true;
  }catch{
   // Unknown delivery is never retried automatically: no duplicate staff posts.
   await sql`UPDATE weekly_summary_deliveries SET state='unknown',lease_until=NULL,status_note='送信結果を確認できませんでした' WHERE ${tenant(s)} AND week_start=${week}::date`.execute(this.db);
   return false;
  }
 }
}
