import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import {assert,scopeSchema} from '../../../packages/shared/src/index.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import {PresentationService,compileActionTemplate,type ActionTemplateKey} from '../../../packages/presentation/src/index.js';
import {domainRevisions} from '../../../packages/settings/src/domain-config.js';
import {SettingsService,type Actor} from '../../../packages/settings/src/index.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';

export function registerV03(app:FastifyInstance,db:Database,key:string,discord?:DiscordPort){
 const base='/v3/organizations/:organizationId/guilds/:guildId',presentation=new PresentationService(db);
 const auth=(params:unknown,header:unknown)=>{const scope=scopeSchema.parse(params);assert(validApiToken(key,scope,String(header??'').replace(/^Bearer /,'')),'FORBIDDEN',403);return scope;};
 const getScope=(req:{params:unknown;headers:{authorization?:unknown}},reply:{header:(name:string,value:string)=>unknown})=>{const scope=auth(req.params,req.headers.authorization);reply.header('Cache-Control','no-store');return scope;};
 app.get(base+'/home',async(req,reply)=>presentation.home(getScope(req,reply)));
 app.get(base+'/journey',async(req,reply)=>{const s=getScope(req,reply),range=z.coerce.number().pipe(z.union([z.literal(7),z.literal(30),z.literal(90)])).catch(30).parse((req.query as {range?:unknown}).range);return presentation.journey(s,range);});
 app.get(base+'/opportunities',async(req,reply)=>presentation.opportunities(getScope(req,reply)));
 app.get(base+'/actions',async(req,reply)=>presentation.actions(getScope(req,reply)));
 app.get(base+'/results',async(req,reply)=>presentation.results(getScope(req,reply)));
 app.get(base+'/options',async(req,reply)=>{const s=getScope(req,reply);if(!discord?.options)return {channels:[],roles:[],events:[],available:false};try{return {...await discord.options(s.guildId),available:true};}catch{return {channels:[],roles:[],events:[],available:false};}});
 app.post(base+'/setup/activation',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({preset:z.enum(['reply','event','message'])}).strict().parse(req.body),event={reply:'reply.received',event:'scheduled_event.subscribed',message:'message.sent'}[input.preset],definition={name:`${event} within 7d`,windowSeconds:604800,rule:{op:'event',event,withinSeconds:604800}},actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  assert(await new EntitlementService(db).canDefineActivation(s,definition),'ENTITLEMENT_REQUIRED',403);
  const settings=new SettingsService(db),cfg=await settings.get(s);if(!cfg.enabled)await settings.update(s,actor,cfg.revision,{enabled:true});
  const revisions=domainRevisions(db),id=await revisions.draft(s,actor,'activation',definition);return revisions.preview(s,id);
 });
 app.post(base+'/settings/notification',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({channelId:z.string().regex(/^\d{17,20}$/),revision:z.number().int().nonnegative()}).strict().parse(req.body);
  assert(discord,'DISCORD_UNAVAILABLE',503);await discord.checkChannel(s.guildId,input.channelId);
  const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  return new SettingsService(db).update(s,actor,input.revision,{adminNotificationChannelId:input.channelId});
 });
 app.post(base+'/settings/retention',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({days:z.union([z.literal(7),z.literal(14),z.literal(30)]),revision:z.number().int().nonnegative()}).strict().parse(req.body);
  const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  return new SettingsService(db).update(s,actor,input.revision,{detailedRetentionDays:input.days});
 });
 app.post(base+'/actions/draft',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({templateKey:z.enum(['reply_rescue','welcome_helper','inactive_follow_up','channel_recommendation','event_recommendation']),channelId:z.string().optional(),eventId:z.string().optional(),recommendedChannelIds:z.array(z.string()).optional(),safetyMode:z.enum(['suggest','approval','auto']).optional()}).strict().parse(req.body),actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  assert(await new EntitlementService(db).can(s,'interventions'),'ENTITLEMENT_REQUIRED',403);
  if(input.safetyMode==='auto')assert(await new EntitlementService(db).can(s,'automation_auto'),'ENTITLEMENT_REQUIRED',403);
  const definition=compileActionTemplate(input.templateKey as ActionTemplateKey,input);
  for(const action of definition.actions){
   if('channelId' in action){assert(discord,'DISCORD_UNAVAILABLE',503);await discord.checkChannel(s.guildId,action.channelId);}
   if(action.type==='recommend_channels')for(const id of action.channels){assert(discord,'DISCORD_UNAVAILABLE',503);await discord.checkChannel(s.guildId,id);}
   if(action.type==='recommend_event'){
    assert(discord?.options,'DISCORD_UNAVAILABLE',503);
    const options=await discord.options(s.guildId);assert(options.events.some(event=>event.id===action.eventId),'EVENT_NOT_AVAILABLE');
   }
  }
  const revisions=domainRevisions(db),id=await revisions.draft(s,actor,'intervention',definition);return revisions.preview(s,id);
 });
 app.post(base+'/setup/onboarding/recommended',async(req,reply)=>{
  const s=getScope(req,reply),actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id},cfg=await new SettingsService(db).get(s),capability=(await sql<{profile:{recommendedMode:'native'|'fallback';nativeOnboardingEnabled:boolean}}>`SELECT profile FROM guild_capabilities WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(db)).rows[0];assert(capability,'CAPABILITY_CHECK_REQUIRED');assert(capability.profile.recommendedMode==='native'?capability.profile.nativeOnboardingEnabled:Boolean(cfg.startChannelId&&cfg.flowVersionId),'RECOMMENDED_SETUP_REQUIRES_CONFIGURATION');
  const revisions=domainRevisions(db),id=await revisions.draft(s,actor,'onboarding',{onboardingMode:capability.profile.recommendedMode,hybrid:cfg.hybrid});return revisions.preview(s,id);
 });
 app.post(base+'/results/draft',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({actionId:z.uuid(),primaryMetric:z.enum(['activation','connection','retention']).default('activation')}).strict().parse(req.body),actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};assert(await new EntitlementService(db).can(s,'experiments'),'ENTITLEMENT_REQUIRED',403);
  const action=(await sql<{id:string;definition:{name:string}}>`SELECT r.id,r.definition FROM guild_config_revisions r JOIN guild_config_heads h ON h.organization_id=r.organization_id AND h.guild_id=r.guild_id AND h.revision_id=r.id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.id=${input.actionId}::uuid AND h.domain='intervention' AND r.state='published'`.execute(db)).rows[0];assert(action,'PUBLISHED_INTERVENTION_REQUIRED');
  const definition={name:`${action.definition.name} Test`,eligibility:[],randomization:'time_block',blockSeconds:86400,variants:[{key:'control',weight:50,interventionRevisionId:null},{key:'treatment',weight:50,interventionRevisionId:action.id}],primaryMetric:input.primaryMetric,windowSeconds:604800,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}},revisions=domainRevisions(db),id=await revisions.draft(s,actor,'experiment',definition);return revisions.preview(s,id);
 });
}
