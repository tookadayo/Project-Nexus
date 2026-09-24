import {randomUUID} from 'node:crypto';
import {sql,tenant,json,privacyReadLock,type Database,type Tx} from '../../db/src/index.js';
import {eventSchema,dedupeKey,type Envelope} from '../../events/src/index.js';
import {IdentityVault} from '../../identity/src/index.js';
import {SettingsService} from '../../settings/src/index.js';
import type {DiscordPort} from '../../discord/src/rest.js';
import type {Scope} from '../../shared/src/index.js';
import {scheduleNativeSnapshots,requestNativeRefresh} from './native.js';
import {validateSignal} from '../../events/src/registry.js';
import {projectActivation} from './activation.js';
import {recordUsage} from '../../settings/src/entitlements.js';
export class AwaitingReference extends Error{}
export class LifecycleService {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly settings:SettingsService,private readonly discord:DiscordPort){}
 async deliveryHealth(event:Envelope,pending:boolean){
  const s={organizationId:event.organizationId,guildId:event.guildId};const reason=`pending:${dedupeKey(event)}`;
  if(pending)await sql`INSERT INTO telemetry_health(organization_id,guild_id,id,started_at,reason)
   SELECT ${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${new Date(event.at)},${reason}
   WHERE EXISTS(SELECT 1 FROM guilds WHERE ${tenant(s)}) AND NOT EXISTS(SELECT 1 FROM telemetry_health WHERE ${tenant(s)} AND reason=${reason})`.execute(this.db);
  else await sql`DELETE FROM telemetry_health WHERE ${tenant(s)} AND reason=${reason}`.execute(this.db);
 }
 async streamReset(s:Scope){
  const now=new Date();await sql`INSERT INTO telemetry_health(organization_id,guild_id,id,started_at,ended_at,reason)
   SELECT organization_id,guild_id,${randomUUID()}::uuid,last_seen,${now},'Redis stream reset' FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db);
 }
 async process(input:Envelope){
  const event=eventSchema.parse(input);const s:Scope={organizationId:event.organizationId,guildId:event.guildId};const at=new Date(event.at);
  let observedMember:Awaited<ReturnType<DiscordPort['member']>>|undefined;
  const requiresBotCheck=['reaction.added','voice.started','voice.ended','scheduled_event.subscribed','scheduled_event.unsubscribed'].includes(event.kind);
  if(event.encryptedUserId&&event.kind!=='member.left'&&(await this.settings.get(s)).enabled){
   const userId=this.vault.open(s,event.encryptedUserId),hash=this.vault.hash(s,userId);
   const suppressed=(await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${hash})`.execute(this.db)).rows.length;
   if(!suppressed){const existing=event.joinedAt?true:(await sql`SELECT e.id FROM membership_episodes e JOIN member_identity_map m ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.identity_id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND m.lookup_hash=${hash} AND e.joined_at<=${at} AND (e.left_at IS NULL OR e.left_at>${at}) AND e.context='PRODUCTION' LIMIT 1`.execute(this.db)).rows.length>0;
    if(requiresBotCheck||!existing)observedMember=await this.discord.member(s.guildId,userId);
   }
  }
  return this.db.transaction().execute(async tx=>{
   await privacyReadLock(tx,s);
   const guild=(await sql`SELECT guild_id FROM guilds WHERE ${tenant(s)}`.execute(tx)).rows[0];if(!guild)return;
   if((await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(tx)).rows.length)return;
   await sql`UPDATE gateway_ingest SET projected_at=now() WHERE ${tenant(s)} AND dedupe_key=${dedupeKey(event)}`.execute(tx);
   const inserted=await sql`INSERT INTO event_inbox(organization_id,guild_id,dedupe_key) VALUES(${s.organizationId}::uuid,${s.guildId},${dedupeKey(event)}) ON CONFLICT DO NOTHING RETURNING dedupe_key`.execute(tx);if(!inserted.rows.length)return;
   if(event.kind.startsWith('telemetry.')){await this.health(tx,s,event);return;}
   const settings=await this.settings.get(s,tx);if(!settings.enabled||!event.encryptedUserId)return;
   const userId=this.vault.open(s,event.encryptedUserId);const hash=this.vault.hash(s,userId);
   if(requiresBotCheck&&observedMember?.bot)return;
   if((await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash=${hash}`.execute(tx)).rows.length)return;
   const identityId=await this.vault.resolve(tx,s,userId);
   await recordUsage(tx,s,hash,at);
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+identityId+'PRODUCTION'},0))`.execute(tx);
   if(event.kind==='member.left'){
    await sql`INSERT INTO membership_departures VALUES(${s.organizationId}::uuid,${s.guildId},${identityId}::uuid,${at}) ON CONFLICT DO NOTHING`.execute(tx);
    const prior=(await sql<{id:string}>`SELECT id FROM membership_episodes WHERE ${tenant(s)} AND identity_id=${identityId}::uuid AND context='PRODUCTION' AND joined_at<=${at} ORDER BY joined_at DESC LIMIT 1`.execute(tx)).rows[0];
    if(prior){await sql`UPDATE membership_episodes SET left_at=LEAST(COALESCE(left_at,${at}),${at}) WHERE ${tenant(s)} AND id=${prior.id}::uuid`.execute(tx);await this.record(tx,s,prior.id,'member.left',at,{});}
    return;
   }
   let episode=(await sql<{id:string,joined_at:Date}>`SELECT id,joined_at FROM membership_episodes WHERE ${tenant(s)} AND identity_id=${identityId}::uuid AND context='PRODUCTION'
    AND joined_at<=${at} AND (left_at IS NULL OR left_at>${at}) ORDER BY joined_at DESC LIMIT 1`.execute(tx)).rows[0];
   if(event.kind==='member.joined'||!episode){
    if(!event.joinedAt&&!observedMember)throw new AwaitingReference('Membership changed during observation; retry required');
    const joinedAt=new Date(event.joinedAt??observedMember!.joinedAt);
    if(joinedAt>at){await this.gap(tx,s,at,at,'unattributed historical event');return;}
    const departure=(await sql<{departed_at:Date}>`SELECT departed_at FROM membership_departures WHERE ${tenant(s)} AND identity_id=${identityId}::uuid AND departed_at>=${joinedAt} ORDER BY departed_at LIMIT 1`.execute(tx)).rows[0];
    await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,left_at,context)
     VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${identityId}::uuid,${joinedAt},${departure?.departed_at??null},'PRODUCTION') ON CONFLICT DO NOTHING`.execute(tx);
    episode=(await sql<{id:string,joined_at:Date}>`SELECT id,joined_at FROM membership_episodes WHERE ${tenant(s)} AND identity_id=${identityId}::uuid AND joined_at=${joinedAt} AND context='PRODUCTION'`.execute(tx)).rows[0]!;
    if(event.kind==='member.joined'){
     const joinedExists=(await sql`SELECT id FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND context='PRODUCTION' AND kind IN ('member.joined','member.rejoined')`.execute(tx)).rows.length;
     if(!joinedExists)await this.record(tx,s,episode.id,'member.joined',joinedAt,{});
     if(departure)await this.record(tx,s,episode.id,'member.left',departure.departed_at,{});
     await sql`UPDATE lifecycle_events e SET kind=CASE WHEN EXISTS(SELECT 1 FROM membership_episodes prior WHERE prior.organization_id=e.organization_id AND prior.guild_id=e.guild_id AND prior.identity_id=${identityId}::uuid AND prior.joined_at<m.joined_at AND prior.context='PRODUCTION') THEN 'member.rejoined' ELSE 'member.joined' END
      FROM membership_episodes m WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.episode_id AND m.identity_id=${identityId}::uuid AND e.kind IN ('member.joined','member.rejoined')`.execute(tx);
    }
   }
   if(event.roles){
    const previous=(await sql<{roles:string[]}>`SELECT roles FROM member_observable_state WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid`.execute(tx)).rows[0];
    if(previous){for(const roleId of event.roles.filter(r=>!previous.roles.includes(r)))await this.record(tx,s,episode.id,'role.added',at,{roleId});for(const roleId of previous.roles.filter(r=>!event.roles!.includes(r)))await this.record(tx,s,episode.id,'role.removed',at,{roleId});}
    await sql`INSERT INTO member_observable_state(organization_id,guild_id,episode_id,roles,roles_observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episode.id}::uuid,${event.roles}::text[],${at}) ON CONFLICT(organization_id,guild_id,episode_id) DO UPDATE SET roles=EXCLUDED.roles,roles_observed_at=EXCLUDED.roles_observed_at WHERE member_observable_state.roles_observed_at IS NULL OR member_observable_state.roles_observed_at<=EXCLUDED.roles_observed_at`.execute(tx);
   }
   if(!event.roles&&observedMember?.roles?.length){
    await sql`INSERT INTO member_observable_state(organization_id,guild_id,episode_id,roles,roles_observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episode.id}::uuid,${observedMember.roles}::text[],${at}) ON CONFLICT DO NOTHING`.execute(tx);
   }
   if(settings.flags.activation_dsl_v2)await projectActivation(tx,s,episode.id,at);
   if(settings.flags.native_snapshot_v2&&event.kind!=='member.joined')await requestNativeRefresh(tx,s,episode.id,at);
   if(event.kind==='member.roles_updated'&&event.roles){
    await sql`UPDATE nexus_role_grants SET revoked_at=now() WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND revoked_at IS NULL AND role_id<>ALL(${event.roles}::text[])`.execute(tx);return;
   }
   if(settings.flags.native_snapshot_v2&&event.kind==='member.joined')await scheduleNativeSnapshots(tx,s,episode.id,episode.joined_at);
   if(event.kind==='member.joined')return;
   const channelAllowed=(channelId:string|null|undefined)=>!channelId||settings.analysisScope.mode==='all'||(settings.analysisScope.mode==='include')===settings.analysisScope.channelIds.includes(channelId);
   if(event.kind==='reaction.added'&&channelAllowed(event.channelId))await this.record(tx,s,episode.id,event.kind,at,{channelId:event.channelId,messageId:event.messageId});
   if(event.kind==='scheduled_event.subscribed'||event.kind==='scheduled_event.unsubscribed')await this.record(tx,s,episode.id,event.kind,at,{eventId:event.eventId});
   if((event.kind==='voice.started'||event.kind==='voice.ended')&&channelAllowed(event.channelId)){
    const previous=(await sql<{voice_channel_id:string|null,voice_started_at:Date|null}>`SELECT voice_channel_id,voice_started_at FROM member_observable_state WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
    if(!previous?.voice_started_at||at>=previous.voice_started_at){
     if(previous?.voice_started_at&&previous.voice_channel_id!==event.channelId){
      const seconds=(at.getTime()-previous.voice_started_at.getTime())/1000;
      const gaps=(await sql`SELECT id FROM telemetry_health WHERE ${tenant(s)} AND started_at<${at} AND (ended_at IS NULL OR ended_at>${previous.voice_started_at})`.execute(tx)).rows;
      if(!gaps.length&&seconds<=86400)await this.record(tx,s,episode.id,'voice.duration',at,{channelId:previous.voice_channel_id,seconds});
     }
     if(previous?.voice_channel_id!==event.channelId)await sql`INSERT INTO member_observable_state(organization_id,guild_id,episode_id,voice_channel_id,voice_started_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episode.id}::uuid,${event.channelId??null},${event.channelId?at:null}) ON CONFLICT(organization_id,guild_id,episode_id) DO UPDATE SET voice_channel_id=EXCLUDED.voice_channel_id,voice_started_at=EXCLUDED.voice_started_at`.execute(tx);
     await this.record(tx,s,episode.id,event.kind,at,{channelId:event.channelId});
     if(event.kind==='voice.started'&&event.channelId){
      const peers=(await sql<{episode_id:string}>`SELECT episode_id FROM member_observable_state WHERE ${tenant(s)} AND episode_id<>${episode.id}::uuid AND voice_channel_id=${event.channelId} AND voice_started_at IS NOT NULL AND voice_started_at<=${at} LIMIT 100`.execute(tx)).rows;
      if(peers.length){await this.record(tx,s,episode.id,'voice.connected',at,{channelId:event.channelId});for(const peer of peers)await this.record(tx,s,peer.episode_id,'voice.connected',at,{channelId:event.channelId});}
     }
    }
   }
   if(event.kind==='message.sent'){
    if(!channelAllowed(event.channelId))return;
    if((await sql`SELECT id FROM lifecycle_events WHERE ${tenant(s)} AND kind='message.sent' AND context='PRODUCTION' AND data->>'messageId'=${event.messageId??''}`.execute(tx)).rows.length)return;
    if(event.referenceId){
     const reciprocal=(await sql`SELECT reply_message_id FROM reply_receipts WHERE ${tenant(s)} AND reply_message_id=${event.referenceId} AND episode_id=${episode.id}::uuid AND expires_at>${at}`.execute(tx)).rows.length;
     if(reciprocal)await this.record(tx,s,episode.id,'reply.established',at,{});
     const target=(await sql<{id:string,episode_id:string,occurred_at:Date,data:Record<string,unknown>,identity_id:string,joined_at:Date}>`SELECT e.id,e.episode_id,e.occurred_at,e.data,m.identity_id,m.joined_at FROM lifecycle_events e JOIN membership_episodes m
      ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.episode_id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.context='PRODUCTION' AND e.kind='message.sent' AND e.data->>'messageId'=${event.referenceId}`.execute(tx)).rows[0];
     if(!target&&Date.now()-at.getTime()<86400000)throw new AwaitingReference('Referenced metadata has not arrived');
     if(target&&target.identity_id!==identityId&&at>=target.occurred_at){
      const latency=(at.getTime()-target.occurred_at.getTime())/1000;
      await this.record(tx,s,target.episode_id,'reply.received',at,{latencySeconds:latency,channelId:target.data.channelId});
      await sql`INSERT INTO reply_receipts VALUES(${s.organizationId}::uuid,${s.guildId},${event.messageId!},${target.episode_id}::uuid,${new Date(at.getTime()+86400000)}) ON CONFLICT DO NOTHING`.execute(tx);
      if(settings.flags.activation_dsl_v2)await projectActivation(tx,s,target.episode_id,at);
      await sql`UPDATE lifecycle_events SET data=jsonb_set(jsonb_set(data,'{receivedExplicitReply}','true'::jsonb),'{firstReplyLatencySeconds}',to_jsonb(LEAST(COALESCE((data->>'firstReplyLatencySeconds')::double precision,${latency}),${latency}))) WHERE ${tenant(s)} AND id=${target.id}::uuid`.execute(tx);
     }
    }
    await this.record(tx,s,episode.id,'message.sent',at,{messageId:event.messageId,channelId:event.channelId,messageType:event.messageType});
    const first=(await sql<{at:Date|null}>`SELECT min(occurred_at) AS at FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND context='PRODUCTION' AND kind='message.sent'
     AND data->>'channelId'=${settings.startChannelId} AND occurred_at>=${episode.joined_at} AND occurred_at<=${new Date(episode.joined_at.getTime()+settings.activationWindowHours*3600000)}`.execute(tx)).rows[0]?.at;
    if(first&&!settings.flags.activation_dsl_v2){
     await sql`INSERT INTO member_lifecycle_state VALUES(${s.organizationId}::uuid,${s.guildId},${episode.id}::uuid,'PRODUCTION',${first})
      ON CONFLICT(organization_id,guild_id,episode_id) DO UPDATE SET activated_at=LEAST(member_lifecycle_state.activated_at,EXCLUDED.activated_at)`.execute(tx);
     await this.record(tx,s,episode.id,'activation.completed',first,{});
     await sql`UPDATE lifecycle_events SET occurred_at=LEAST(occurred_at,${first}) WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND kind='activation.completed' AND context='PRODUCTION'`.execute(tx);
    }
   }
   if(settings.flags.activation_dsl_v2)await projectActivation(tx,s,episode.id,at);
  });
 }
 private async record(tx:Tx,s:Scope,episodeId:string,kind:string,at:Date,data:Record<string,unknown>){
  validateSignal(kind,data);
  await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES
   (${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episodeId}::uuid,${kind},${at},'PRODUCTION',${json(data)}) ON CONFLICT DO NOTHING`.execute(tx);
 }
 private async gap(tx:Tx,s:Scope,start:Date,end:Date|null,reason:string){await sql`INSERT INTO telemetry_health VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${start},${end},${reason})`.execute(tx);}
 private async health(tx:Tx,s:Scope,e:Envelope){
  const at=new Date(e.at);const cursor=(await sql<{last_seen:Date}>`SELECT last_seen FROM telemetry_cursor WHERE ${tenant(s)} FOR UPDATE`.execute(tx)).rows[0];
  if(e.kind==='telemetry.disconnected'){await this.gap(tx,s,at,null,'gateway disconnected');return;}
  if(e.kind==='telemetry.gap'){await this.gap(tx,s,new Date(e.gapStart??e.at),at,'Redis publication lost');return;}
  if(cursor&&at.getTime()-cursor.last_seen.getTime()>90000)await this.gap(tx,s,cursor.last_seen,at,'heartbeat missing');
  await sql`UPDATE telemetry_health SET ended_at=${at} WHERE ${tenant(s)} AND ended_at IS NULL AND started_at<=${at} AND reason='gateway disconnected'`.execute(tx);
  await sql`INSERT INTO telemetry_cursor VALUES(${s.organizationId}::uuid,${s.guildId},${at},${at}) ON CONFLICT(organization_id,guild_id)
   DO UPDATE SET last_seen=GREATEST(telemetry_cursor.last_seen,EXCLUDED.last_seen),first_seen=LEAST(telemetry_cursor.first_seen,EXCLUDED.first_seen)`.execute(tx);
 }
}
