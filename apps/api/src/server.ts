import Fastify from 'fastify';
import {scopeSchema} from '../../../packages/shared/src/index.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import type {AnalyticsService} from '../../../packages/analytics/src/index.js';
import type {Database} from '../../../packages/db/src/index.js';
import {registerV02} from './v02.js';
import {registerV03} from './v03.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
export function createApi(analytics:AnalyticsService,key:string,db?:Database,discord?:DiscordPort,runtime?:()=>{discordConnected:boolean}){
 const app=Fastify({logger:false});app.get('/health',async()=>{
  if(!runtime)return {status:'ok'};
  let recent:Date|null=null,scope='all';
  if(db)try{const {sql}=await import('../../../packages/db/src/index.js');recent=(await sql<{last_seen:Date|null}>`SELECT max(last_seen) AS last_seen FROM telemetry_cursor`.execute(db)).rows[0]?.last_seen??null;scope=(await sql<{mode:string|null}>`SELECT settings->'analysisScope'->>'mode' AS mode FROM guild_settings WHERE guild_id=${process.env.DISCORD_GUILD_ID??''} LIMIT 1`.execute(db)).rows[0]?.mode??'all';}catch{/* Health remains readable during database recovery. */}
  return {status:'ok',...runtime(),recentEventAt:recent?.toISOString()??null,analysisScope:scope};
 });
 app.get<{Params:{organizationId:string,guildId:string}}>('/v1/organizations/:organizationId/guilds/:guildId/overview',async(req,reply)=>{
  const scope=scopeSchema.safeParse(req.params);if(!scope.success)return reply.code(400).send({error:'invalid scope'});
  const token=String(req.headers.authorization??'').replace(/^Bearer /,'');if(!validApiToken(key,scope.data,token))return reply.code(403).send({error:'forbidden'});
  reply.header('Cache-Control','no-store');return {metrics:await analytics.overview(scope.data),generatedAt:new Date().toISOString()};
 });if(db){registerV02(app,db,key,discord);registerV03(app,db,key,discord);}return app;
}
