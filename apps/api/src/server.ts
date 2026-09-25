import Fastify from 'fastify';
import {scopeSchema} from '../../../packages/shared/src/index.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import type {AnalyticsService} from '../../../packages/analytics/src/index.js';
import type {Database} from '../../../packages/db/src/index.js';
import {registerV02} from './v02.js';
import {registerV03} from './v03.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import type {InteractionHealthSnapshot} from '../../interaction/src/health.js';
export function createApi(analytics:AnalyticsService,key:string,db?:Database,discord?:DiscordPort,runtime?:()=>{discordConnected:boolean;interaction?:InteractionHealthSnapshot;commandHash?:string},vault?:IdentityVault){
 const app=Fastify({logger:false});app.get('/health',async()=>{
  if(!runtime)return {status:'ok'};
  const state=runtime();let recent:Date|null=null,scope='all',registeredHash:string|null=null,registeredAt:string|null=null;
  let lastInteraction:{kind:string;action:string;receivedAt:string;acknowledgedAt:string|null;completedAt:string|null;result:string;errorCode:string|null}|null=null;
  if(db)try{const {sql}=await import('../../../packages/db/src/index.js');const guild=process.env.DISCORD_GUILD_ID??'';recent=(await sql<{last_seen:Date|null}>`SELECT max(last_seen) AS last_seen FROM telemetry_cursor`.execute(db)).rows[0]?.last_seen??null;scope=(await sql<{mode:string|null}>`SELECT settings->'analysisScope'->>'mode' AS mode FROM guild_settings WHERE guild_id=${guild} LIMIT 1`.execute(db)).rows[0]?.mode??'all';
   const command=(await sql<{definition_hash:string;registered_at:Date}>`SELECT definition_hash,registered_at FROM guild_command_sync WHERE guild_id=${guild} LIMIT 1`.execute(db)).rows[0];registeredHash=command?.definition_hash??null;registeredAt=command?.registered_at.toISOString()??null;
   const interaction=(await sql<{kind:string;action:string;received_at:Date;acknowledged_at:Date|null;completed_at:Date|null;result:string;error_code:string|null}>`SELECT kind,action,received_at,acknowledged_at,completed_at,result,error_code FROM interaction_diagnostics WHERE guild_id=${guild} ORDER BY received_at DESC LIMIT 1`.execute(db)).rows[0];if(interaction)lastInteraction={kind:interaction.kind,action:interaction.action,receivedAt:interaction.received_at.toISOString(),acknowledgedAt:interaction.acknowledged_at?.toISOString()??null,completedAt:interaction.completed_at?.toISOString()??null,result:interaction.result,errorCode:interaction.error_code};
  }catch{/* Health remains readable during database recovery. */}
  return {status:'ok',...state,recentEventAt:recent?.toISOString()??null,analysisScope:scope,commands:{registered:Boolean(registeredHash&&registeredHash===state.commandHash),expectedHash:state.commandHash??null,registeredHash,registeredAt},lastInteraction};
 });
 app.get<{Params:{organizationId:string,guildId:string}}>('/v1/organizations/:organizationId/guilds/:guildId/overview',async(req,reply)=>{
  const scope=scopeSchema.safeParse(req.params);if(!scope.success)return reply.code(400).send({error:'invalid scope'});
  const token=String(req.headers.authorization??'').replace(/^Bearer /,'');if(!validApiToken(key,scope.data,token))return reply.code(403).send({error:'forbidden'});
  reply.header('Cache-Control','no-store');return {metrics:await analytics.overview(scope.data),generatedAt:new Date().toISOString()};
 });if(db){registerV02(app,db,key,discord);registerV03(app,db,key,discord,vault);}return app;
}
