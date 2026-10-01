import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import {assert,scopeSchema,DomainError} from '../../../packages/shared/src/index.js';
import {userFailure} from '../../../packages/shared/src/errors.js';
import {validApiToken} from '../../../packages/security/src/index.js';
import {PresentationService,compileActionTemplate,type ActionTemplateKey} from '../../../packages/presentation/src/index.js';
import {domainRevisions} from '../../../packages/settings/src/domain-config.js';
import {SettingsService,settingsSchema,type Actor} from '../../../packages/settings/src/index.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import {randomUUID} from 'node:crypto';
import {CommunityService} from '../../../packages/presentation/src/community.js';
import {PermissionFlagsBits} from 'discord-api-types/v10';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {resolveLocale,t} from '../../../packages/discord-panels/src/i18n/index.js';
import {recordProductEvent} from '../../../packages/shared/src/product-telemetry.js';
import {nextZonedDayStart} from '../../../packages/shared/src/timezones.js';
import {latestCapability,requestCapabilityRefresh} from '../../../packages/lifecycle/src/discovery.js';

export function registerV03(app:FastifyInstance,db:Database,key:string,discord?:DiscordPort,vault?:IdentityVault){
 const base='/v3/organizations/:organizationId/guilds/:guildId',presentation=new PresentationService(db);
 const optionsCache=new Map<string,{at:number;value:Awaited<ReturnType<NonNullable<DiscordPort['options']>>>}>();
 const roleCache=new Map<string,{at:number;ids:string[]}>();
 const automaticStaffRoles=async(guildId:string)=>{const cached=roleCache.get(guildId);if(cached&&Date.now()-cached.at<1800000)return cached.ids;if(!discord)return [];try{const roles=await discord.roles(guildId),flags=PermissionFlagsBits.Administrator|PermissionFlagsBits.ManageGuild|PermissionFlagsBits.ManageMessages|PermissionFlagsBits.ModerateMembers,ids=roles.filter(role=>(BigInt(role.permissions)&flags)!==0n).map(role=>role.id);roleCache.set(guildId,{at:Date.now(),ids});return ids;}catch{return cached?.ids??[];}};
 const auth=(params:unknown,header:unknown)=>{const scope=scopeSchema.parse(params);assert(validApiToken(key,scope,String(header??'').replace(/^Bearer /,'')),'FORBIDDEN',403);return scope;};
 const getScope=(req:{params:unknown;headers:{authorization?:unknown}},reply:{header:(name:string,value:string)=>unknown})=>{const scope=auth(req.params,req.headers.authorization);reply.header('Cache-Control','no-store');return scope;};
 app.get(base+'/community-model',async(req,reply)=>{const s=getScope(req,reply),current=await new SettingsService(db).get(s);return {profile:current.communityModel,revision:current.revision,capabilities:await latestCapability(db,s)};});
 app.post(base+'/community-model/refresh',async(req,reply)=>{const s=getScope(req,reply);await requestCapabilityRefresh(db,s,'manual');return {state:'PENDING'};});
 app.post(base+'/settings/community-model',async(req,reply)=>{const s=getScope(req,reply),input=z.object({profile:settingsSchema.shape.communityModel,revision:z.number().int().nonnegative()}).strict().parse(req.body);return new SettingsService(db).update(s,{key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id},input.revision,{communityModel:input.profile});});
 const actionInput=z.object({templateKey:z.enum(['reply_rescue','welcome_helper','inactive_follow_up','channel_recommendation','event_recommendation']),channelId:z.string().optional(),eventId:z.string().optional(),recommendedChannelIds:z.array(z.string()).optional(),safetyMode:z.enum(['suggest','approval','auto']).optional()}).strict();
 app.post(base+'/product-event',async(req,reply)=>{const s=getScope(req,reply),input=z.object({event:z.enum(['web_dashboard_opened','attention_opened','analysis_opened','settings_opened','page_render_latency']),durationMs:z.number().int().min(0).max(600000).optional()}).strict().parse(req.body);await recordProductEvent(db,s,input.event,input.durationMs);return {ok:true};});
 const preflight=async(guildId:string,input:z.infer<typeof actionInput>)=>{
  let definition;try{definition=compileActionTemplate(input.templateKey,input);}catch{return {status:'unavailable' as const,fix:'Choose every required destination and try again.'};}
  if(!discord)return {status:'unavailable' as const,fix:'Connect the Discord bot and try again.'};
  try{for(const action of definition.actions){
   if('channelId' in action)await discord.checkChannel(guildId,action.channelId);
   if(action.type==='recommend_channels')for(const id of action.channels)await discord.checkChannel(guildId,id);
   if(action.type==='recommend_event'){
    assert(discord.options,'DISCORD_UNAVAILABLE',503);
    const options=await discord.options(guildId);assert(options.events.some(event=>event.id===action.eventId),'EVENT_NOT_AVAILABLE');
   }
  }}catch(error){const failure=userFailure(error,'NOT_STARTED',{action:'preflight',stage:'discord-check'});return {status:failure.category==='CHANNEL_PERMISSION'?'permission_needed' as const:'unavailable' as const,fix:null,failure,code:error instanceof DomainError?error.code:'DISCORD_UNAVAILABLE'};}
  return {status:'ready' as const,fix:null};
 };
 app.get(base+'/home',async(req,reply)=>presentation.home(getScope(req,reply)));
 app.get(base+'/community',async(req,reply)=>{const s=getScope(req,reply),query=req.query as {range?:unknown;limit?:unknown},range=z.coerce.number().pipe(z.union([z.literal(7),z.literal(30),z.literal(90)])).catch(30).parse(query.range),limit=z.coerce.number().int().min(1).max(50).catch(1).parse(query.limit);return new CommunityService(db).overview(s,range,new Date(),await automaticStaffRoles(s.guildId),0,limit);});
 app.post(base+'/attention/action',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({channelId:z.string().regex(/^\d{17,20}$/),messageId:z.string().regex(/^\d{17,20}$/),status:z.enum(['ACKNOWLEDGED','SNOOZED','RESOLVED']),minutes:z.union([z.literal(30),z.literal(60)]).optional(),untilToday:z.boolean().optional()}).strict().parse(req.body);
  const queue=await new CommunityService(db).overview(s,30,new Date(),await automaticStaffRoles(s.guildId),0,50);
  assert(queue.attention.some(item=>item.messageId===input.messageId&&item.channelId===input.channelId),'ATTENTION_NOT_ACTIVE',409);
  const source=(await sql<{occurred_at:Date}>`SELECT occurred_at FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND kind='message.sent' AND data->>'messageId'=${input.messageId} AND data->>'channelId'=${input.channelId} LIMIT 1`.execute(db)).rows[0];assert(source,'ATTENTION_NOT_FOUND',404);
  const prior=(await sql<{status:string}>`SELECT status FROM attention_items WHERE ${tenant(s)} AND message_id=${input.messageId}`.execute(db)).rows[0];assert(prior?.status!=='RESOLVED','ATTENTION_NOT_ACTIVE',409);
  const settings=await new SettingsService(db).get(s),snoozeUntil=input.status!=='SNOOZED'?null:input.untilToday?nextZonedDayStart(new Date(),settings.timezone):new Date(Date.now()+(input.minutes??30)*60000);
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,snooze_until,resolved_at) VALUES(${s.organizationId}::uuid,${s.guildId},${input.channelId},${input.messageId},${source.occurred_at},${input.status},${snoozeUntil},${input.status==='RESOLVED'?new Date():null}) ON CONFLICT(organization_id,guild_id,message_id) DO UPDATE SET status=EXCLUDED.status,snooze_until=EXCLUDED.snooze_until,resolved_at=EXCLUDED.resolved_at`.execute(db);
  return {status:input.status};
 });
 app.get(base+'/weekly-summary/status',async(req,reply)=>{const s=getScope(req,reply);return (await sql<{state:string;status_note:string|null;attempted_at:Date}>`SELECT state,status_note,attempted_at FROM weekly_summary_deliveries WHERE ${tenant(s)} ORDER BY week_start DESC LIMIT 1`.execute(db)).rows[0]??null;});
 app.get(base+'/audit',async(req,reply)=>{
  const s=getScope(req,reply),rows=(await sql<{action:string;source:string;actor_identity_ciphertext:string|null;before_value:Record<string,unknown>|null;after_value:Record<string,unknown>|null;occurred_at:Date}>`SELECT action,source,actor_identity_ciphertext,before_value,after_value,occurred_at FROM audit_logs WHERE ${tenant(s)} AND action IN ('settings.updated','config.published') ORDER BY occurred_at DESC LIMIT 30`.execute(db)).rows;
  return rows.map(row=>{let actorId:string|null=null;try{if(vault&&row.actor_identity_ciphertext)actorId=vault.open(s,row.actor_identity_ciphertext);}catch{/* Historical or deleted identity remains unnamed. */}
   const before=row.before_value??{},after=row.after_value??{},changed=Object.keys(after).filter(field=>JSON.stringify(before[field])!==JSON.stringify(after[field]));
   return {at:row.occurred_at.toISOString(),action:row.action,source:row.source,actorId,changed};
  });
 });
 app.get(base+'/journey',async(req,reply)=>{const s=getScope(req,reply),range=z.coerce.number().pipe(z.union([z.literal(7),z.literal(30),z.literal(90)])).catch(30).parse((req.query as {range?:unknown}).range);return presentation.journey(s,range);});
 app.get(base+'/opportunities',async(req,reply)=>presentation.opportunities(getScope(req,reply)));
 app.post(base+'/opportunities/dismiss',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({suggestionType:z.enum(['ACTIVATION_DROP','TTFV_SPIKE','CONNECTION_DROP','REPLY_LATENCY_SPIKE','ONBOARDING_DROP','HOME_ACTION_DROP','RETENTION_DROP']),reason:z.enum(['not_relevant','already_handled','later']).nullable().default(null)}).strict().parse(req.body);
  await sql`INSERT INTO suggestion_feedback(organization_id,guild_id,suggestion_type,week_start,reason) VALUES(${s.organizationId}::uuid,${s.guildId},${input.suggestionType},date_trunc('week',now())::date,${input.reason}) ON CONFLICT(organization_id,guild_id,suggestion_type,week_start) DO UPDATE SET reason=EXCLUDED.reason,dismissed_at=now()`.execute(db);
  return {status:'dismissed'};
 });
 app.get(base+'/actions',async(req,reply)=>presentation.actions(getScope(req,reply)));
 app.get(base+'/results',async(req,reply)=>presentation.results(getScope(req,reply)));
 app.get(base+'/options',async(req,reply)=>{const s=getScope(req,reply);if(!discord?.options)return {channels:[],roles:[],events:[],available:false};try{const cached=optionsCache.get(s.guildId);if(cached&&Date.now()-cached.at<300000)return {...cached.value,available:true};const value=await discord.options(s.guildId);optionsCache.set(s.guildId,{at:Date.now(),value});return {...value,available:true};}catch{return {channels:[],roles:[],events:[],available:false};}});
 app.post(base+'/setup/activation',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({preset:z.enum(['reply','event','message'])}).strict().parse(req.body),event={reply:'reply.received',event:'scheduled_event.subscribed',message:'message.sent'}[input.preset],definition={name:`${event} within 7d`,windowSeconds:604800,rule:{op:'event',event,withinSeconds:604800}},actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  assert(await new EntitlementService(db).canDefineActivation(s,definition),'ENTITLEMENT_REQUIRED',403);
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
 app.post(base+'/settings/weekly-summary',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({enabled:z.boolean(),channelId:z.string().regex(/^\d{17,20}$/).nullable(),day:z.number().int().min(0).max(6).optional(),hour:z.number().int().min(0).max(23).optional(),timezone:settingsSchema.shape.timezone.optional(),revision:z.number().int().nonnegative()}).strict().parse(req.body);
  assert(!input.enabled||input.channelId,'CHANNEL_REQUIRED');
  if(input.enabled){assert(discord,'DISCORD_UNAVAILABLE',503);await discord.checkChannel(s.guildId,input.channelId!);}
  const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  return new SettingsService(db).update(s,actor,input.revision,{weeklySummaryEnabled:input.enabled,weeklySummaryChannelId:input.channelId,...(input.day===undefined?{}:{weeklySummaryDay:input.day}),...(input.hour===undefined?{}:{weeklySummaryHour:input.hour}),...(input.timezone===undefined?{}:{timezone:input.timezone})});
 });
 app.post(base+'/settings/helper',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({enabled:z.boolean(),channelId:z.string().regex(/^\d{17,20}$/).nullable(),roleId:z.string().regex(/^\d{17,20}$/).nullable(),responseMinutes:z.number().int().min(1).max(1440),cooldownMinutes:z.number().int().min(15).max(1440),revision:z.number().int().nonnegative()}).strict().parse(req.body);
  assert(!input.enabled||input.channelId,'HELPER_CHANNEL_REQUIRED');
  if(input.channelId){assert(discord,'DISCORD_UNAVAILABLE',503);await discord.checkChannel(s.guildId,input.channelId);}
  if(input.roleId){assert(discord,'DISCORD_UNAVAILABLE',503);assert((await discord.roles(s.guildId)).some(role=>role.id===input.roleId),'HELPER_ROLE_NOT_FOUND');}
  const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  return new SettingsService(db).update(s,actor,input.revision,{helperEnabled:input.enabled,helperChannelId:input.channelId,helperRoleId:input.roleId,firstResponseMinutes:input.responseMinutes,helperAlertCooldownMinutes:input.cooldownMinutes});
 });
 app.post(base+'/settings/goals',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({preset:z.enum(['multiplayer','early_access','live_service']).nullable(),goals:settingsSchema.shape.newMemberGoals.optional(),channels:z.array(z.object({channelId:z.string().regex(/^\d{17,20}$/),purpose:z.enum(['lfg','feedback','bug','playtest','discussion'])})).max(20),revision:z.number().int().nonnegative()}).strict().parse(req.body);
  assert(new Set(input.channels.map(item=>item.channelId)).size===input.channels.length,'DUPLICATE_CHANNEL');
  if(discord?.options){const available=await discord.options(s.guildId);assert(input.channels.every(item=>available.channels.some(channel=>channel.id===item.channelId)),'CHANNEL_NOT_FOUND');}
  const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  const current=await new SettingsService(db).get(s);return new SettingsService(db).update(s,actor,input.revision,{goalPreset:input.preset,importantChannels:input.channels,...(input.goals===undefined?{}:{newMemberGoals:input.goals,setupSteps:{...current.setupSteps,goals:input.goals.length>0}})});
 });
 app.post(base+'/settings/analysis-scope',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({revision:z.number().int().nonnegative(),mode:z.enum(['all','include','exclude']),channelIds:z.array(z.string().regex(/^\d{17,20}$/)).max(100),staffRoleIds:z.array(z.string().regex(/^\d{17,20}$/)).max(30)}).strict().parse(req.body);
  assert(input.mode!=='include'||input.channelIds.length>0,'CHANNEL_REQUIRED');
  const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  return new SettingsService(db).update(s,actor,input.revision,{analysisScope:{mode:input.mode,channelIds:[...new Set(input.channelIds)]},staffRoleIds:[...new Set(input.staffRoleIds)]});
 });
 app.post(base+'/actions/draft',async(req,reply)=>{
  const s=getScope(req,reply),input=actionInput.parse(req.body),actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  assert(await new EntitlementService(db).can(s,'interventions'),'ENTITLEMENT_REQUIRED',403);
  if(input.safetyMode==='auto')assert(await new EntitlementService(db).can(s,'automation_auto'),'ENTITLEMENT_REQUIRED',403);
  const definition=compileActionTemplate(input.templateKey as ActionTemplateKey,input);
  const check=await preflight(s.guildId,input);assert(check.status==='ready','code' in check?String(check.code):'INVALID_CONFIGURATION');
  const revisions=domainRevisions(db),id=await revisions.draft(s,actor,'intervention',definition);return revisions.preview(s,id);
 });
 app.post(base+'/actions/preflight',async(req,reply)=>{const s=getScope(req,reply);return preflight(s.guildId,actionInput.parse(req.body));});
 app.post(base+'/actions/test',async(req,reply)=>{
  const s=getScope(req,reply),input=actionInput.parse(req.body);
  assert(input.templateKey!=='inactive_follow_up','TEST_UNAVAILABLE');
  const check=await preflight(s.guildId,input);assert(check.status==='ready','code' in check?String(check.code):'INVALID_CONFIGURATION');
  assert(discord&&input.channelId,'CHANNEL_REQUIRED');
  // This direct bot message is explicitly a TEST. It creates no member episode,
  // intervention run, outbox entry, assignment, exposure, or metric record.
  const locale=resolveLocale((await new SettingsService(db).get(s)).uiLanguage),names={reply_rescue:'testAction.reply_rescue',welcome_helper:'testAction.welcome_helper',channel_recommendation:'testAction.channel_recommendation',event_recommendation:'testAction.event_recommendation',inactive_follow_up:'testAction.inactive_follow_up'} as const;
  await discord.sendPanel(input.channelId,{content:`[TEST] NEXUS · ${t(locale,names[input.templateKey])}\n${t(locale,'testAction.notice')}`,allowed_mentions:{parse:[]}},randomUUID());
  return {status:'sent',context:'TEST'};
 });
 app.post(base+'/setup/onboarding/recommended',async(req,reply)=>{
  const s=getScope(req,reply),actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id},cfg=await new SettingsService(db).get(s),capability=(await sql<{profile:{recommendedMode:'native'|'fallback';nativeOnboardingEnabled:boolean}}>`SELECT profile FROM guild_capabilities WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(db)).rows[0];assert(capability,'CAPABILITY_CHECK_REQUIRED');assert(capability.profile.recommendedMode==='native'?capability.profile.nativeOnboardingEnabled:Boolean(cfg.startChannelId&&cfg.flowVersionId),'RECOMMENDED_SETUP_REQUIRES_CONFIGURATION');
  const revisions=domainRevisions(db),id=await revisions.draft(s,actor,'onboarding',{onboardingMode:capability.profile.recommendedMode,hybrid:cfg.hybrid});return revisions.preview(s,id);
 });
 app.post(base+'/results/draft',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({actionId:z.uuid(),primaryMetric:z.enum(['activation','connection','retention']).default('activation')}).strict().parse(req.body),actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};assert(await new EntitlementService(db).can(s,'experiments'),'ENTITLEMENT_REQUIRED',403);
  const activity=(await sql<{count:number}>`SELECT count(*)::integer AS count FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION' AND joined_at>=${new Date(Date.now()-30*86400000)}`.execute(db)).rows[0]?.count??0;assert(activity>=40,'MORE_ACTIVITY_NEEDED');
  const readiness=await new PresentationService(db).home(s);assert(readiness.dataHealth.status==='healthy','DATA_COLLECTION_INCOMPLETE');
  const action=(await sql<{id:string;definition:{name:string}}>`SELECT r.id,r.definition FROM guild_config_revisions r JOIN guild_config_heads h ON h.organization_id=r.organization_id AND h.guild_id=r.guild_id AND h.revision_id=r.id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.id=${input.actionId}::uuid AND h.domain='intervention' AND r.state='published'`.execute(db)).rows[0];assert(action,'PUBLISHED_INTERVENTION_REQUIRED');
  const definition={name:`${action.definition.name} Test`,eligibility:[],randomization:'time_block',blockSeconds:86400,variants:[{key:'control',weight:50,interventionRevisionId:null},{key:'treatment',weight:50,interventionRevisionId:action.id}],primaryMetric:input.primaryMetric,windowSeconds:604800,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}},revisions=domainRevisions(db),id=await revisions.draft(s,actor,'experiment',definition);return revisions.preview(s,id);
 });
}
