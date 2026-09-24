import Fastify from 'fastify';
import {scopeSchema} from '../../../packages/shared/src/index.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import type {AnalyticsService} from '../../../packages/analytics/src/index.js';
import type {Database} from '../../../packages/db/src/index.js';
import {registerV02} from './v02.js';
import {registerV03} from './v03.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
export function createApi(analytics:AnalyticsService,key:string,db?:Database,discord?:DiscordPort){
 const app=Fastify({logger:false});app.get('/health',()=>({status:'ok'}));
 app.get<{Params:{organizationId:string,guildId:string}}>('/v1/organizations/:organizationId/guilds/:guildId/overview',async(req,reply)=>{
  const scope=scopeSchema.safeParse(req.params);if(!scope.success)return reply.code(400).send({error:'invalid scope'});
  const token=String(req.headers.authorization??'').replace(/^Bearer /,'');if(!validApiToken(key,scope.data,token))return reply.code(403).send({error:'forbidden'});
  reply.header('Cache-Control','no-store');return {metrics:await analytics.overview(scope.data),generatedAt:new Date().toISOString()};
 });if(db){registerV02(app,db,key,discord);registerV03(app,db,key,discord);}return app;
}
