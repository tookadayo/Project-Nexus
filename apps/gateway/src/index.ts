import {betaAccess,requestBetaDeletion} from '../../../packages/security/src/hosted-beta';
import {hostedBetaEnabled} from '../../../packages/config/src/hosted-beta';
import {traceStep} from '../../../packages/shared/src/observability.js';
import {Client,GatewayIntentBits,Events,type Interaction} from 'discord.js';
import {Redis} from 'ioredis';
import {randomUUID} from 'node:crypto';
import {normalizeMany,eventSchema,dedupeKey,type Envelope,type Dispatch} from '../../../packages/events/src/index.js';
import {scopeForGuild} from '../../../packages/security/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {sql,tenant,json,ensureGuild,privacyReadLock,type Database,type Tx} from '../../../packages/db/src/index.js';
export const gatewayIntents=[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.GuildMessageReactions,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildScheduledEvents,GatewayIntentBits.GuildMessagePolls,GatewayIntentBits.AutoModerationExecution];
export const STREAM='nexus:events';
export class GatewayPublisher {
 private lost=new Map<string,Envelope>();
 constructor(private readonly redis:Redis,private readonly db?:Database,private readonly vault?:IdentityVault){}
 async publish(event:Envelope){return traceStep('event.persist',{'signal.kind':event.kind},()=>this.persist(event));}
 private async persist(event:Envelope){
  event=eventSchema.parse(event);
  if(!this.db){if(hostedBetaEnabled())throw new Error('BETA_STATE_REQUIRED');return this.publishOnce(event);}
  let streamUnavailable=false;
  await this.db.transaction().execute(async tx=>{
   const s={organizationId:event.organizationId,guildId:event.guildId};
   await privacyReadLock(tx,s);
   try{const beta=await betaAccess(tx,s,'work',event.betaGeneration);if(beta)event={...event,betaGeneration:beta.generation};}
   catch(error){if(error instanceof Error&&error.message==='BETA_UNAVAILABLE')return;throw error;}
   try{await this.publishOnce(event,tx);}catch(error){if(error instanceof Error&&error.message==='Gateway stream unavailable')streamUnavailable=true;else throw error;}
  });
  if(streamUnavailable)throw new Error('Gateway stream unavailable');
 }

 private async publishOnce(event:Envelope,db?:Tx){
  const s={organizationId:event.organizationId,guildId:event.guildId};
  if(db){
   const hash=event.encryptedUserId&&this.vault?this.vault.hash(s,this.vault.open(s,event.encryptedUserId)):null;
   const related=[hash,event.targetHash,event.ownerHash,...event.mentionHashes??[]].filter((value):value is string=>Boolean(value));
   if((await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND completed_at IS NOT NULL AND (lookup_hash IS NULL OR lookup_hash=ANY(${related}::text[]))`.execute(db)).rows.length)return;
   await sql`INSERT INTO gateway_ingest(organization_id,guild_id,dedupe_key,subject_hash,payload) SELECT ${event.organizationId}::uuid,${event.guildId},${dedupeKey(event)},${hash},${json(event)} WHERE EXISTS(SELECT 1 FROM guilds WHERE ${tenant(s)}) AND NOT EXISTS(SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND completed_at IS NOT NULL AND (lookup_hash IS NULL OR lookup_hash=${hash})) ON CONFLICT DO NOTHING`.execute(db);
   if(!(await sql`SELECT dedupe_key FROM gateway_ingest WHERE ${tenant(s)} AND dedupe_key=${dedupeKey(event)}`.execute(db)).rows.length)return;
  }
  try{
   for(const [scopeKey,missing] of this.lost){await this.redis.xadd(STREAM,'*','event',JSON.stringify({organizationId:missing.organizationId,guildId:missing.guildId,shardId:missing.shardId,gatewaySessionId:missing.gatewaySessionId,sequence:missing.sequence,kind:'telemetry.gap',context:'PRODUCTION',at:new Date().toISOString(),gapStart:missing.at}));this.lost.delete(scopeKey);}
   await this.redis.xadd(STREAM,'*','event',JSON.stringify(event));
  }catch{if(!db&&!this.lost.has(event.organizationId+':'+event.guildId))this.lost.set(event.organizationId+':'+event.guildId,event);throw new Error('Gateway stream unavailable');}
   if(db)await sql`UPDATE gateway_ingest SET published_at=now() WHERE ${tenant(s)} AND dedupe_key=${dedupeKey(event)}`.execute(db);
 }
 async recover(){
  if(!this.db)return 0;
  const gate=hostedBetaEnabled()?sql`AND EXISTS(SELECT 1 FROM beta_guild_invitations b WHERE b.organization_id=i.organization_id AND b.guild_id=i.guild_id AND b.status='ACTIVE' AND b.expires_at>clock_timestamp() AND i.payload->>'betaGeneration'=b.generation::text) AND NOT EXISTS(SELECT 1 FROM beta_deletion_jobs d WHERE d.organization_id=i.organization_id AND d.guild_id=i.guild_id)`:sql``;
  const rows=(await sql<{payload:Envelope}>`SELECT i.payload FROM gateway_ingest i WHERE i.projected_at IS NULL AND (i.published_at IS NULL OR i.published_at<now()-interval '60 seconds') ${gate} ORDER BY i.received_at LIMIT 100`.execute(this.db)).rows;
  for(const row of rows)await this.publish(row.payload);return rows.length;
 }
}
export function createGateway(redis:Redis,vault:IdentityVault,onError:()=>void=()=>{},db?:Database,onInteraction?:(interaction:Interaction)=>Promise<void>){
 const client=new Client({intents:gatewayIntents});const publisher=new GatewayPublisher(redis,db,vault);const sessions=new Map<number,string>(),pending=new Map<string,Promise<void>>();let healthSequence=0;
 const healthSession=randomUUID();const disconnected=new Set<number>(),intentDenied=new Set<number>();
 const registerGuild=async(guildId:string)=>{if(!db)return;const scope=scopeForGuild(guildId);await db.transaction().execute(async tx=>{if(hostedBetaEnabled()){try{await betaAccess(tx,scope);}catch(error){if(error instanceof Error&&error.message==='BETA_UNAVAILABLE')return;throw error;}}await ensureGuild(tx,scope);});};
 const health=async(kind:Envelope['kind'],shardId?:number,reason:Envelope['healthReason']='GATEWAY_CONNECTED')=>{
  for(const guild of client.guilds.cache.values())if(shardId===undefined||guild.shardId===shardId){
   if(kind==='telemetry.heartbeat'&&disconnected.has(guild.shardId))continue;
   await registerGuild(guild.id);
   const event:Envelope={...scopeForGuild(guild.id),shardId:guild.shardId,gatewaySessionId:healthSession,sequence:healthSequence++,kind,healthReason:reason,requestedIntents:intentDenied.has(guild.shardId)?['messages','reactions','polls','voice','scheduledEvents','autoMod']:['members','messages','reactions','polls','voice','scheduledEvents','autoMod'],at:new Date().toISOString(),context:'PRODUCTION'};
   await publisher.publish(event).catch(onError);
  }
 };
 client.on('raw',(packet:Dispatch,shardId:number)=>{
  if(packet.t==='READY'){const data=packet.d as {session_id:string};sessions.set(shardId,data.session_id);}
  const session=sessions.get(shardId);if(!session)return;
  try{const events=normalizeMany(packet,shardId,session,vault);for(const event of events)if((event.kind==='message.sent'||event.kind==='channel.post_observed')&&event.channelId){const channel=client.channels.cache.get(event.channelId);if(channel&&'guildId' in channel&&channel.guildId===event.guildId){event.channelType=channel.type;event.parentId='parentId' in channel?channel.parentId:null;}}if(events.length){const guildId=events[0]!.guildId,next=(pending.get(guildId)??Promise.resolve()).then(()=>registerGuild(guildId)).then(async()=>{for(const event of events)await publisher.publish(event);}).catch(onError);pending.set(guildId,next);void next.finally(()=>{if(pending.get(guildId)===next)pending.delete(guildId);});}}catch{onError();}
 });
 client.on(Events.GuildDelete,guild=>{if(db&&hostedBetaEnabled())void db.transaction().execute(tx=>requestBetaDeletion(tx,scopeForGuild(guild.id),'BOT_REMOVED')).catch(onError);});
 client.on(Events.GuildCreate,guild=>{void registerGuild(guild.id).then(()=>health('telemetry.connected',guild.shardId,'BOT_INSTALLED')).catch(onError);});
 client.on(Events.ClientReady,()=>{void health('telemetry.connected',undefined,'PROCESS_RESTART');});
 client.on(Events.ShardReady,shardId=>{disconnected.delete(shardId);const restored=intentDenied.delete(shardId);void health('telemetry.connected',shardId,restored?'INTENT_RESTORED':'GATEWAY_CONNECTED');});
 client.on(Events.ShardResume,shardId=>{disconnected.delete(shardId);void health('telemetry.connected',shardId,'GATEWAY_RESUMED');});
 client.on(Events.ShardDisconnect,(close,shardId)=>{disconnected.add(shardId);if(close.code===4014)intentDenied.add(shardId);void health('telemetry.disconnected',shardId,close.code===4014?'INTENT_UNAVAILABLE':'GATEWAY_CONNECTED');});
 if(onInteraction)client.on(Events.InteractionCreate,interaction=>{void onInteraction(interaction).catch(onError);});
 const heartbeat=setInterval(()=>{void health('telemetry.heartbeat');},30000);heartbeat.unref();
 return {client,publisher,stop:async()=>{clearInterval(heartbeat);await client.destroy();}};
}
