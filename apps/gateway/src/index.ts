import {Client,GatewayIntentBits,Events,type Interaction} from 'discord.js';
import {Redis} from 'ioredis';
import {randomUUID} from 'node:crypto';
import {normalize,eventSchema,dedupeKey,type Envelope,type Dispatch} from '../../../packages/events/src/index.js';
import {scopeForGuild} from '../../../packages/security/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {sql,tenant,json,ensureGuild,type Database} from '../../../packages/db/src/index.js';
export const gatewayIntents=[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.GuildMessageReactions,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildScheduledEvents];
export const STREAM='nexus:events';
export class GatewayPublisher {
 private lost=new Map<string,Envelope>();
 constructor(private readonly redis:Redis,private readonly db?:Database,private readonly vault?:IdentityVault){}
 async publish(event:Envelope){
  event=eventSchema.parse(event);
  if(!this.db)return this.publishOnce(event);
  await this.db.connection().execute(async db=>{
   const lock='privacy:'+event.organizationId+':'+event.guildId;
   await sql`SELECT pg_advisory_lock_shared(hashtextextended(${lock},0))`.execute(db);
   try{await this.publishOnce(event,db);}finally{await sql`SELECT pg_advisory_unlock_shared(hashtextextended(${lock},0))`.execute(db);}
  });
 }
 private async publishOnce(event:Envelope,db?:Database){
  const s={organizationId:event.organizationId,guildId:event.guildId};
  if(db){
   const hash=event.encryptedUserId&&this.vault?this.vault.hash(s,this.vault.open(s,event.encryptedUserId)):null;
   await sql`INSERT INTO gateway_ingest(organization_id,guild_id,dedupe_key,subject_hash,payload) SELECT ${event.organizationId}::uuid,${event.guildId},${dedupeKey(event)},${hash},${json(event)} WHERE EXISTS(SELECT 1 FROM guilds WHERE ${tenant(s)}) AND NOT EXISTS(SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND completed_at IS NOT NULL AND (lookup_hash IS NULL OR lookup_hash=${hash})) ON CONFLICT DO NOTHING`.execute(db);
   if(!(await sql`SELECT dedupe_key FROM gateway_ingest WHERE ${tenant(s)} AND dedupe_key=${dedupeKey(event)}`.execute(db)).rows.length)return;
  }
  try{
   for(const [guildId,missing] of this.lost){await this.redis.xadd(STREAM,'*','event',JSON.stringify({organizationId:missing.organizationId,guildId,shardId:missing.shardId,gatewaySessionId:missing.gatewaySessionId,sequence:missing.sequence,kind:'telemetry.gap',context:'PRODUCTION',at:new Date().toISOString(),gapStart:missing.at}));this.lost.delete(guildId);}
   await this.redis.xadd(STREAM,'*','event',JSON.stringify(event));
   if(db)await sql`UPDATE gateway_ingest SET published_at=now() WHERE ${tenant(s)} AND dedupe_key=${dedupeKey(event)}`.execute(db);
  }catch{if(!db&&!this.lost.has(event.guildId))this.lost.set(event.guildId,event);throw new Error('Gateway stream unavailable');}
 }
 async recover(){
  if(!this.db)return 0;
  const rows=(await sql<{payload:Envelope}>`SELECT payload FROM gateway_ingest WHERE projected_at IS NULL AND (published_at IS NULL OR published_at<now()-interval '60 seconds') ORDER BY received_at LIMIT 100`.execute(this.db)).rows;
  for(const row of rows)await this.publish(row.payload);return rows.length;
 }
}
export function createGateway(redis:Redis,vault:IdentityVault,onError:()=>void=()=>{},db?:Database,onInteraction?:(interaction:Interaction)=>Promise<void>){
 const client=new Client({intents:gatewayIntents});const publisher=new GatewayPublisher(redis,db,vault);const sessions=new Map<number,string>();let healthSequence=0;
 const healthSession=randomUUID();const disconnected=new Set<number>();
 const registerGuild=async(guildId:string)=>{if(!db)return;const scope=scopeForGuild(guildId);await db.transaction().execute(tx=>ensureGuild(tx,scope));};
 const health=async(kind:Envelope['kind'],shardId?:number)=>{
  for(const guild of client.guilds.cache.values())if(shardId===undefined||guild.shardId===shardId){
   if(kind==='telemetry.heartbeat'&&disconnected.has(guild.shardId))continue;
   await registerGuild(guild.id);
   const event:Envelope={...scopeForGuild(guild.id),shardId:guild.shardId,gatewaySessionId:healthSession,sequence:healthSequence++,kind,at:new Date().toISOString(),context:'PRODUCTION'};
   await publisher.publish(event).catch(onError);
  }
 };
 client.on('raw',(packet:Dispatch,shardId:number)=>{
  if(packet.t==='READY'){const data=packet.d as {session_id:string};sessions.set(shardId,data.session_id);}
  const session=sessions.get(shardId);if(!session)return;
  try{const event=normalize(packet,shardId,session,vault);if(event)void registerGuild(event.guildId).then(()=>publisher.publish(event)).catch(onError);}catch{onError();}
 });
 client.on(Events.GuildCreate,guild=>{void registerGuild(guild.id).then(()=>health('telemetry.connected',guild.shardId)).catch(onError);});
 client.on(Events.ClientReady,()=>{void health('telemetry.connected');});
 client.on(Events.ShardReady,shardId=>{disconnected.delete(shardId);void health('telemetry.connected',shardId);});
 client.on(Events.ShardResume,shardId=>{disconnected.delete(shardId);void health('telemetry.connected',shardId);});
 client.on(Events.ShardDisconnect,(_close,shardId)=>{disconnected.add(shardId);void health('telemetry.disconnected',shardId);});
 if(onInteraction)client.on(Events.InteractionCreate,interaction=>{void onInteraction(interaction).catch(onError);});
 const heartbeat=setInterval(()=>{void health('telemetry.heartbeat');},30000);heartbeat.unref();
 return {client,publisher,stop:async()=>{clearInterval(heartbeat);await client.destroy();}};
}
