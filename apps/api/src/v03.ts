import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Database} from '../../../packages/db/src/index.js';
import {assert,scopeSchema} from '../../../packages/shared/src/index.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import {PresentationService} from '../../../packages/presentation/src/index.js';
import {compileActionTemplate,type ActionTemplateKey} from '../../../packages/presentation/src/index.js';
import {domainRevisions} from '../../../packages/settings/src/domain-config.js';
import type {Actor} from '../../../packages/settings/src/index.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';

export function registerV03(app:FastifyInstance,db:Database,key:string){
 const base='/v3/organizations/:organizationId/guilds/:guildId',presentation=new PresentationService(db);
 const auth=(params:unknown,header:unknown)=>{const scope=scopeSchema.parse(params);assert(validApiToken(key,scope,String(header??'').replace(/^Bearer /,'')),'FORBIDDEN',403);return scope;};
 const getScope=(req:{params:unknown;headers:{authorization?:unknown}},reply:{header:(name:string,value:string)=>unknown})=>{const scope=auth(req.params,req.headers.authorization);reply.header('Cache-Control','no-store');return scope;};
 app.get(base+'/home',async(req,reply)=>presentation.home(getScope(req,reply)));
 app.get(base+'/journey',async(req,reply)=>{const s=getScope(req,reply),range=z.coerce.number().pipe(z.union([z.literal(7),z.literal(30),z.literal(90)])).catch(30).parse((req.query as {range?:unknown}).range);return presentation.journey(s,range);});
 app.get(base+'/opportunities',async(req,reply)=>presentation.opportunities(getScope(req,reply)));
 app.get(base+'/actions',async(req,reply)=>presentation.actions(getScope(req,reply)));
 app.get(base+'/results',async(req,reply)=>presentation.results(getScope(req,reply)));
 app.post(base+'/setup/activation',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({preset:z.enum(['reply','event','message'])}).strict().parse(req.body),event={reply:'reply.received',event:'scheduled_event.subscribed',message:'message.sent'}[input.preset],definition={name:`${event} within 7d`,windowSeconds:604800,rule:{op:'event',event,withinSeconds:604800}},actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  assert(await new EntitlementService(db).canDefineActivation(s,definition),'ENTITLEMENT_REQUIRED',403);const revisions=domainRevisions(db),id=await revisions.draft(s,actor,'activation',definition);return revisions.preview(s,id);
 });
 app.post(base+'/actions/draft',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({templateKey:z.enum(['reply_rescue','welcome_helper','inactive_follow_up','channel_recommendation','event_recommendation']),channelId:z.string().optional(),eventId:z.string().optional(),recommendedChannelIds:z.array(z.string()).optional(),safetyMode:z.enum(['suggest','approval','auto']).optional()}).strict().parse(req.body),actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  assert(await new EntitlementService(db).can(s,'interventions'),'ENTITLEMENT_REQUIRED',403);const definition=compileActionTemplate(input.templateKey as ActionTemplateKey,input),revisions=domainRevisions(db),id=await revisions.draft(s,actor,'intervention',definition);return revisions.preview(s,id);
 });
}
