import Fastify from 'fastify';
import {scopeSchema,isDomainError} from '../../../packages/shared/src/index.js';
import {userFailure} from '../../../packages/shared/src/errors.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import type {AnalyticsService} from '../../../packages/analytics/src/index.js';
import type {Database} from '../../../packages/db/src/index.js';
import {registerV02} from './v02.js';
import {registerV03} from './v03.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import type {InteractionHealthSnapshot} from '../../interaction/src/health.js';
import {runtimeInfo} from '../../../packages/shared/src/runtime-info.js';
export function createApi(analytics:AnalyticsService,key:string,db?:Database,discord?:DiscordPort,runtime?:()=>{discordConnected:boolean;redisConnected?:boolean;interaction?:InteractionHealthSnapshot;commandHash?:string},vault?:IdentityVault){
 const app=Fastify({logger:false});
 app.setErrorHandler((error,req,reply)=>{
  const failure=userFailure(error,req.method==='GET'?'NOT_STARTED':'UNKNOWN',{action:'api',stage:req.routeOptions.url??'route'});
  const status=isDomainError(error)?error.status:failure.category==='VALIDATION'?400:failure.category==='PERMISSION'?403:failure.category==='DISCORD_RATE_LIMIT'?429:failure.category.startsWith('DISCORD_')?503:500;
  return reply.code(status).header('Cache-Control','no-store').send({error:isDomainError(error)?error.code:failure.category,failure});
 });
 app.get('/health',async()=>{
  if(!runtime)return {status:'ok'};
  const state=runtime();let recent:Date|null=null,scope='all',registeredHash:string|null=null,registeredAt:string|null=null,community:{timezone:string|null;setupSteps:unknown;panelChannelId:string|null}|null=null;
  let databaseConnected=true;let lastInteraction:{kind:string;action:string;receivedAt:string;acknowledgedAt:string|null;completedAt:string|null;result:string;errorCode:string|null}|null=null;
  if(db)try{const {sql}=await import('../../../packages/db/src/index.js');const guild=process.env.DISCORD_GUILD_ID??'';recent=(await sql<{last_seen:Date|null}>`SELECT max(last_seen) AS last_seen FROM telemetry_cursor`.execute(db)).rows[0]?.last_seen??null;const guildSettings=(await sql<{mode:string|null;timezone:string|null;setup_steps:unknown}>`SELECT settings->'analysisScope'->>'mode' AS mode,settings->>'timezone' AS timezone,settings->'setupSteps' AS setup_steps FROM guild_settings WHERE guild_id=${guild} LIMIT 1`.execute(db)).rows[0];scope=guildSettings?.mode??'all';const installed=(await sql<{channel_id:string}>`SELECT channel_id FROM settings_panels WHERE guild_id=${guild} LIMIT 1`.execute(db)).rows[0];community={timezone:guildSettings?.timezone??null,setupSteps:guildSettings?.setup_steps??null,panelChannelId:installed?.channel_id??null};
   const command=(await sql<{definition_hash:string;registered_at:Date}>`SELECT definition_hash,registered_at FROM guild_command_sync WHERE guild_id=${guild} LIMIT 1`.execute(db)).rows[0];registeredHash=command?.definition_hash??null;registeredAt=command?.registered_at.toISOString()??null;
   const interaction=(await sql<{kind:string;action:string;received_at:Date;acknowledged_at:Date|null;completed_at:Date|null;result:string;error_code:string|null}>`SELECT kind,action,received_at,acknowledged_at,completed_at,result,error_code FROM interaction_diagnostics WHERE guild_id=${guild} ORDER BY received_at DESC LIMIT 1`.execute(db)).rows[0];if(interaction)lastInteraction={kind:interaction.kind,action:interaction.action,receivedAt:interaction.received_at.toISOString(),acknowledgedAt:interaction.acknowledged_at?.toISOString()??null,completedAt:interaction.completed_at?.toISOString()??null,result:interaction.result,errorCode:interaction.error_code};
  }catch{databaseConnected=false;/* Health remains readable during database recovery. */}
  const received=state.interaction?.lastReceivedAt??lastInteraction?.receivedAt??null,ack=state.interaction?.lastAcknowledgedAt??lastInteraction?.acknowledgedAt??null;
  const shared=runtimeInfo({databaseConnected,redisConnected:state.redisConnected??false,gatewayConnected:state.discordConnected,interactionTransport:state.interaction?.transport??'gateway',commandsRegistered:Boolean(registeredHash&&registeredHash===state.commandHash),lastInteraction:received,lastAck:ack,ackLatencyMs:received&&ack?Math.max(0,new Date(ack).getTime()-new Date(received).getTime()):null,lastCompleted:state.interaction?.lastCompletedAt??lastInteraction?.completedAt??null,lastActivity:recent?.toISOString()??null});
  return {status:'ok',...shared,...state,runtimeInfo:shared,recentEventAt:recent?.toISOString()??null,analysisScope:scope,community,commands:{registered:shared.commandsRegistered,expectedHash:state.commandHash??null,registeredHash,registeredAt},lastInteraction};
 });
 app.get<{Params:{organizationId:string,guildId:string}}>('/v1/organizations/:organizationId/guilds/:guildId/overview',async(req,reply)=>{
  const scope=scopeSchema.safeParse(req.params);if(!scope.success)return reply.code(400).send({error:'invalid scope'});
  const token=String(req.headers.authorization??'').replace(/^Bearer /,'');if(!validApiToken(key,scope.data,token))return reply.code(403).send({error:'forbidden'});
  reply.header('Cache-Control','no-store');return {metrics:await analytics.overview(scope.data),generatedAt:new Date().toISOString()};
 });if(db){registerV02(app,db,key,discord);registerV03(app,db,key,discord,vault);}return app;
}
