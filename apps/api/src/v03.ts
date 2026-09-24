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
import {randomUUID} from 'node:crypto';
import {CommunityService} from '../../../packages/presentation/src/community.js';
import {PermissionFlagsBits} from 'discord-api-types/v10';

export function registerV03(app:FastifyInstance,db:Database,key:string,discord?:DiscordPort){
 const base='/v3/organizations/:organizationId/guilds/:guildId',presentation=new PresentationService(db);
 const roleCache=new Map<string,{at:number;ids:string[]}>();
 const automaticStaffRoles=async(guildId:string)=>{const cached=roleCache.get(guildId);if(cached&&Date.now()-cached.at<1800000)return cached.ids;if(!discord)return [];try{const roles=await discord.roles(guildId),flags=PermissionFlagsBits.Administrator|PermissionFlagsBits.ManageGuild|PermissionFlagsBits.ManageMessages|PermissionFlagsBits.ModerateMembers,ids=roles.filter(role=>(BigInt(role.permissions)&flags)!==0n).map(role=>role.id);roleCache.set(guildId,{at:Date.now(),ids});return ids;}catch{return cached?.ids??[];}};
 const auth=(params:unknown,header:unknown)=>{const scope=scopeSchema.parse(params);assert(validApiToken(key,scope,String(header??'').replace(/^Bearer /,'')),'FORBIDDEN',403);return scope;};
 const getScope=(req:{params:unknown;headers:{authorization?:unknown}},reply:{header:(name:string,value:string)=>unknown})=>{const scope=auth(req.params,req.headers.authorization);reply.header('Cache-Control','no-store');return scope;};
 const actionInput=z.object({templateKey:z.enum(['reply_rescue','welcome_helper','inactive_follow_up','channel_recommendation','event_recommendation']),channelId:z.string().optional(),eventId:z.string().optional(),recommendedChannelIds:z.array(z.string()).optional(),safetyMode:z.enum(['suggest','approval','auto']).optional()}).strict();
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
  }}catch(error){const code=error instanceof Error?error.message:'';return code.includes('EVENT_NOT_AVAILABLE')?{status:'unavailable' as const,fix:'Choose a scheduled event that still exists.'}:{status:'permission_needed' as const,fix:'Give NEXUS View Channel and Send Messages in each selected channel, then retry.'};}
  return {status:'ready' as const,fix:null};
 };
 app.get(base+'/home',async(req,reply)=>presentation.home(getScope(req,reply)));
 app.get(base+'/community',async(req,reply)=>{const s=getScope(req,reply),range=z.coerce.number().pipe(z.union([z.literal(7),z.literal(30),z.literal(90)])).catch(30).parse((req.query as {range?:unknown}).range);return new CommunityService(db).overview(s,range,new Date(),await automaticStaffRoles(s.guildId));});
 app.get(base+'/weekly-summary/status',async(req,reply)=>{const s=getScope(req,reply);return (await sql<{state:string;status_note:string|null;attempted_at:Date}>`SELECT state,status_note,attempted_at FROM weekly_summary_deliveries WHERE ${tenant(s)} ORDER BY week_start DESC LIMIT 1`.execute(db)).rows[0]??null;});
 app.get(base+'/journey',async(req,reply)=>{const s=getScope(req,reply),range=z.coerce.number().pipe(z.union([z.literal(7),z.literal(30),z.literal(90)])).catch(30).parse((req.query as {range?:unknown}).range);return presentation.journey(s,range);});
 app.get(base+'/opportunities',async(req,reply)=>presentation.opportunities(getScope(req,reply)));
 app.post(base+'/opportunities/dismiss',async(req,reply)=>{
  const s=getScope(req,reply),input=z.object({suggestionType:z.enum(['ACTIVATION_DROP','TTFV_SPIKE','CONNECTION_DROP','REPLY_LATENCY_SPIKE','ONBOARDING_DROP','HOME_ACTION_DROP','RETENTION_DROP']),reason:z.enum(['not_relevant','already_handled','later']).nullable().default(null)}).strict().parse(req.body);
  await sql`INSERT INTO suggestion_feedback(organization_id,guild_id,suggestion_type,week_start,reason) VALUES(${s.organizationId}::uuid,${s.guildId},${input.suggestionType},date_trunc('week',now())::date,${input.reason}) ON CONFLICT(organization_id,guild_id,suggestion_type,week_start) DO UPDATE SET reason=EXCLUDED.reason,dismissed_at=now()`.execute(db);
  return {status:'dismissed'};
 });
 app.get(base+'/actions',async(req,reply)=>presentation.actions(getScope(req,reply)));
 app.get(base+'/results',async(req,reply)=>presentation.results(getScope(req,reply)));
 app.get(base+'/options',async(req,reply)=>{const s=getScope(req,reply);if(!discord?.options)return {channels:[],roles:[],events:[],available:false};try{return {...await discord.options(s.guildId),available:true};}catch{return {channels:[],roles:[],events:[],available:false};}});
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
  const s=getScope(req,reply),input=z.object({enabled:z.boolean(),channelId:z.string().regex(/^\d{17,20}$/).nullable(),revision:z.number().int().nonnegative()}).strict().parse(req.body);
  assert(!input.enabled||input.channelId,'CHANNEL_REQUIRED');
  if(input.enabled){assert(discord,'DISCORD_UNAVAILABLE',503);await discord.checkChannel(s.guildId,input.channelId!);}
  const actor:Actor={key:'web-admin',permissions:'32',roles:[],source:'WEB_DASHBOARD',requestId:req.id};
  return new SettingsService(db).update(s,actor,input.revision,{weeklySummaryEnabled:input.enabled,weeklySummaryChannelId:input.channelId});
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
  const check=await preflight(s.guildId,input);assert(check.status==='ready',check.status==='permission_needed'?'CHANNEL_PERMISSION_MISSING':'EVENT_NOT_AVAILABLE');
  const revisions=domainRevisions(db),id=await revisions.draft(s,actor,'intervention',definition);return revisions.preview(s,id);
 });
 app.post(base+'/actions/preflight',async(req,reply)=>{const s=getScope(req,reply);return preflight(s.guildId,actionInput.parse(req.body));});
 app.post(base+'/actions/test',async(req,reply)=>{
  const s=getScope(req,reply),input=actionInput.parse(req.body);
  assert(input.templateKey!=='inactive_follow_up','TEST_UNAVAILABLE');
  const check=await preflight(s.guildId,input);assert(check.status==='ready',check.status==='permission_needed'?'CHANNEL_PERMISSION_MISSING':'EVENT_NOT_AVAILABLE');
  assert(discord&&input.channelId,'CHANNEL_REQUIRED');
  // This direct bot message is explicitly a TEST. It creates no member episode,
  // intervention run, outbox entry, assignment, exposure, or metric record.
  const ja=(await new SettingsService(db).get(s)).uiLanguage==='ja',names={reply_rescue:ja?'返信がない人をスタッフに知らせる':'Notify staff when someone has no reply',welcome_helper:ja?'参加後に困っている人をスタッフに知らせる':'Notify staff when a newcomer may need help',channel_recommendation:ja?'おすすめチャンネルを案内する':'Show recommended channels',event_recommendation:ja?'イベントを案内する':'Recommend an event',inactive_follow_up:''};
  await discord.sendPanel(input.channelId,{content:`[TEST] NEXUS · ${names[input.templateKey]}\n${ja?'設定確認です。新規メンバーには連絡していません。':'This is a setup check. No newcomer was contacted.'}`,allowed_mentions:{parse:[]}},randomUUID());
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
