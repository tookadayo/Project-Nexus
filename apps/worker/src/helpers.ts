import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {Scope} from '../../../packages/shared/src/index.js';
import {SettingsService} from '../../../packages/settings/src/index.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';

const DAY=86400000;
type Candidate={message_id:string;channel_id:string;occurred_at:Date};
export class HelperWorker{
 constructor(private readonly db:Database,private readonly discord:DiscordPort,private readonly settings=new SettingsService(db)){}
 async tick(s:Scope,now=new Date()){
  const cfg=await this.settings.get(s);if(!cfg.enabled||!cfg.helperEnabled||!cfg.helperChannelId)return false;
  const cursor=(await sql<{last_seen:Date}>`SELECT last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db)).rows[0];
  if(!cursor||cursor.last_seen.getTime()<now.getTime()-10*60000)return false;
  if((await sql`SELECT 1 FROM telemetry_health WHERE ${tenant(s)} AND ended_at IS NULL LIMIT 1`.execute(this.db)).rows.length)return false;
  await sql`UPDATE helper_alerts SET state='unknown' WHERE ${tenant(s)} AND state='sending' AND created_at<${new Date(now.getTime()-15*60000)}`.execute(this.db);
  await this.discord.checkChannel(s.guildId,cfg.helperChannelId);
  const target=await this.db.transaction().execute(async tx=>{
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'helper:'+s.organizationId+':'+s.guildId},0))`.execute(tx);
   const usage=(await sql<{recent:Date|null;today:number}>`SELECT max(created_at) AS recent,count(*) FILTER(WHERE created_at>=${new Date(now.getTime()-DAY)})::integer AS today FROM helper_alerts WHERE ${tenant(s)} AND state IN ('sending','sent','unknown')`.execute(tx)).rows[0];
   if((usage?.today??0)>=6||usage?.recent&&usage.recent.getTime()>now.getTime()-cfg.helperAlertCooldownMinutes*60000)return null;
   const row=(await sql<Candidate>`SELECT f.data->>'messageId' AS message_id,f.data->>'channelId' AS channel_id,f.occurred_at FROM lifecycle_events f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id LEFT JOIN member_observable_state state ON state.organization_id=e.organization_id AND state.guild_id=e.guild_id AND state.episode_id=e.id WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.context='PRODUCTION' AND f.kind='message.sent' AND e.context='PRODUCTION' AND e.left_at IS NULL AND e.joined_at>=${new Date(now.getTime()-3*DAY)} AND f.occurred_at>=${new Date(now.getTime()-DAY)} AND f.occurred_at<=${new Date(now.getTime()-cfg.firstResponseMinutes*60000)} AND f.data->>'messageId' ~ '^\\d{17,20}$' AND f.data->>'channelId' ~ '^\\d{17,20}$' AND f.data->>'receivedExplicitReply' IS DISTINCT FROM 'true' AND NOT(COALESCE(state.roles,'{}'::text[]) && ${cfg.staffRoleIds}::text[]) AND (${cfg.analysisScope.mode}='all' OR (${cfg.analysisScope.mode}='include')=(f.data->>'channelId'=ANY(${cfg.analysisScope.channelIds}::text[]))) AND NOT EXISTS(SELECT 1 FROM helper_alerts a WHERE a.organization_id=f.organization_id AND a.guild_id=f.guild_id AND a.message_id=f.data->>'messageId') ORDER BY f.occurred_at LIMIT 1`.execute(tx)).rows[0];
   if(!row)return null;
   const inserted=(await sql`INSERT INTO helper_alerts(organization_id,guild_id,message_id,channel_id,state,created_at) VALUES(${s.organizationId}::uuid,${s.guildId},${row.message_id},${row.channel_id},'sending',${now}) ON CONFLICT DO NOTHING RETURNING message_id`.execute(tx)).rows.length>0;
   return inserted?row:null;
  });
  if(!target)return false;
  const stillWaiting=(await sql`SELECT 1 FROM lifecycle_events WHERE ${tenant(s)} AND kind='message.sent' AND data->>'messageId'=${target.message_id} AND data->>'receivedExplicitReply' IS DISTINCT FROM 'true'`.execute(this.db)).rows.length>0;
  if(!stillWaiting){await sql`DELETE FROM helper_alerts WHERE ${tenant(s)} AND message_id=${target.message_id} AND state='sending'`.execute(this.db);return false;}
  const ja=cfg.uiLanguage==='ja',url=`https://discord.com/channels/${s.guildId}/${target.channel_id}/${target.message_id}`;
  const content=`${cfg.helperRoleId?`<@&${cfg.helperRoleId}> `:''}${ja?'新しいメンバーの投稿に返信がありません。':'A new member’s post is waiting for a reply.'}\n<#${target.channel_id}> · ${Math.max(0,Math.floor((now.getTime()-target.occurred_at.getTime())/60000))} ${ja?'分':'min'}\n${url}`;
  try{
   const messageId=await this.discord.sendPanel(cfg.helperChannelId,{content,allowed_mentions:{parse:[],roles:cfg.helperRoleId?[cfg.helperRoleId]:[]}},target.message_id);
   await sql`UPDATE helper_alerts SET state='sent',sent_at=${now},discord_message_id=${messageId} WHERE ${tenant(s)} AND message_id=${target.message_id}`.execute(this.db);
   return true;
  }catch{
   await sql`UPDATE helper_alerts SET state='unknown' WHERE ${tenant(s)} AND message_id=${target.message_id}`.execute(this.db);
   return false;
  }
 }
}
