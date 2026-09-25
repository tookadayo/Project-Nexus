import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {Components,canAdmin} from '../../../packages/security/src/index.js';
import {SettingsService,templates,type Actor} from '../../../packages/settings/src/index.js';
import {OnboardingService,type Session} from '../../../packages/onboarding/src/index.js';
import {controlPanel,controlPages,settingsPanel,basicSettingsPanel,improvePanel,privacyPanel,questionPanel,confirmation,errorPanel,activationPanel,activationPreviewPanel,billingPanel,lifecyclePanel,diagnosticsPanel,interventionsPanel,interventionPreviewPanel,experimentsPanel,experimentMethodPanel,cohortsPanel,reportsPanel,overviewPanel,publishedPanel,successPanel,panelInstalledPanel,rolloutPreviewPanel,onboardingModePreviewPanel,onboardingNotConfiguredPanel,onboardingFlowPanel,editQuestionPanel,roleMappingPanel,sessionCompletePanel,activationReadinessPanel,guidedSetupPanel,resolveLocale,t,type Panel,type Issue,type ReadinessCheck,type UiLocale,type ControlPage} from '../../../packages/discord-panels/src/index.js';
import {enqueue} from '../../../packages/discord/src/outbox.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import {assert,DomainError,type Scope} from '../../../packages/shared/src/index.js';
import type {InteractionJob} from '../../interaction/src/server.js';
import {CapabilityService} from '../../../packages/lifecycle/src/capabilities.js';
import {AnalyticsService} from '../../../packages/analytics/src/index.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';
import {domainRevisions} from '../../../packages/settings/src/domain-config.js';
import {InterventionService,interventionSchema} from '../../../packages/lifecycle/src/interventions.js';
import {ExperimentService,experimentSchema} from '../../../packages/lifecycle/src/experiments.js';
import {diagnose} from '../../../packages/analytics/src/diagnoses.js';
import {PresentationService,compileActionTemplate} from '../../../packages/presentation/src/index.js';
import {CommunityService} from '../../../packages/presentation/src/community.js';
import type {InteractionHealthSnapshot} from '../../interaction/src/health.js';
type DeleteData=(s:Scope,userId:string,actor:Actor,guild:boolean)=>Promise<void>;
export class InteractionWorker {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly tokens:Components,private readonly discord:DiscordPort,
 private readonly settings:SettingsService,private readonly onboarding:OnboardingService,private readonly deletion:DeleteData,
 private readonly runtime?:()=>{gatewayConnected:boolean;interaction:InteractionHealthSnapshot;commandHash:string}){}
 async tick(s:Scope){
  const job=await this.db.transaction().execute(async tx=>{
   const row=(await sql<{id:string,encrypted_payload:string}>`SELECT id,encrypted_payload FROM interaction_jobs WHERE ${tenant(s)}
    AND created_at>now()-interval '14 minutes' AND attempts<5 AND (state='PENDING' OR state='RUNNING' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`.execute(tx)).rows[0];
   if(row)await sql`UPDATE interaction_jobs SET state='RUNNING',lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE ${tenant(s)} AND id=${row.id}`.execute(tx);
   return row;
  });if(!job)return false;
  const input=JSON.parse(this.vault.open(s,job.encrypted_payload)) as InteractionJob;
  let body:Panel;
  try{body=await this.dispatch(s,input);}catch(error){
   const kind=error instanceof DomainError?error.code==='REVISION_CONFLICT'?'revision':error.code==='ADMIN_REQUIRED'?'permission':error.code==='ENTITLEMENT_REQUIRED'?'entitlement':'generic':'generic';
   const actorHash=this.vault.hash(s,input.userId),issue:Issue=(data,publicEntry=false)=>this.tokens.issue(this.db,s,data,publicEntry?null:actorHash,publicEntry?31536000:900);
   let language:'auto'|'ja'|'en'|'bilingual'='auto';try{language=(await this.settings.get(s)).uiLanguage;}catch{/* Error response still has interaction locale. */}
   const locale=resolveLocale(language,{interactionLocale:input.locale,guildLocale:input.guildLocale}),internal=!(error instanceof DomainError||error instanceof z.ZodError),reference=internal?`NXS-${randomBytes(3).toString('hex').toUpperCase()}`:undefined;
   if(reference)process.stderr.write(`[${reference}] ${error instanceof Error?error.name:'UNKNOWN_ERROR'}\n`);
   body=await errorPanel(issue,kind,locale,reference,error instanceof DomainError?error.code:undefined);
  }
  await this.db.transaction().execute(async tx=>{
   const interactionHash=this.vault.hash(s,input.id);
   await enqueue(tx,s,`reply:${input.id}`,'REPLY_EDIT',{applicationId:input.applicationId,encryptedToken:this.vault.seal(s,input.token),body,interactionHash});
   await sql`UPDATE interaction_diagnostics SET result='queued' WHERE ${tenant(s)} AND interaction_hash=${interactionHash}`.execute(tx);
   await sql`UPDATE interaction_jobs SET state='SUCCEEDED',lease_until=NULL WHERE ${tenant(s)} AND id=${input.id}`.execute(tx);
  });return true;
 }
 async dispatch(s:Scope,input:InteractionJob):Promise<Panel>{
  const member=await this.discord.member(s.guildId,input.userId);const actorHash=this.vault.hash(s,input.userId);
  const actor:Actor={key:actorHash,permissions:member.permissions,roles:member.roles,source:'DISCORD_PANEL',requestId:input.id,encryptedUserId:this.vault.seal(s,input.userId)};
  const current=await this.settings.get(s);const admin=canAdmin(member.permissions,member.roles,current.adminRoleId);
  const locale=resolveLocale(current.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale});
  const publicLocale=resolveLocale(current.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale,publicPanel:true});
  const intent=input.customId?await this.tokens.read(this.db,s,input.customId,actorHash):{action:input.command};
  const action=String(intent.action??'');
  const issue:Issue=(data,publicEntry=false)=>this.tokens.issue(this.db,s,data,publicEntry?null:actorHash,publicEntry?31536000:900);
  const adminActions=['panel','panelRefresh','setup','recommendedSetup','rolloutPreview','rolloutConfirm','modePreview','modeConfirm','lifecycle','activation','activationDraft','activationPublish','cohorts','diagnose','improve','interventions','interventionDraft','interventionApprove','experiments','experimentMethod','experimentDraft','configPublish','reports','billing','advanced','settings','status','flows','template','startChannel','adminNotificationChannel','helperChannel','helperEnabled','uiLanguage','enabled','onboardingEnabled','mapOption','mapRole','editNode','editNodeOpen','editNodeSave','rollback','preview','deleteGuildConfirm','deleteGuild','overview','dashboard'];
  if(adminActions.includes(action))assert(admin,'ADMIN_REQUIRED',403);
  if(action==='setup'){
   if(!current.enabled)await this.settings.update(s,actor,current.revision,{enabled:true});
   try{await new CapabilityService(this.db,this.discord).refresh(s,current.onboardingMode);}catch{/* Guided setup explains the unavailable connection state. */}
   return guidedSetupPanel(issue,(await new PresentationService(this.db).home(s)).setup,locale);
  }
  if(action==='recommendedSetup'){
   const capability=await new CapabilityService(this.db,this.discord).latest(s);assert(capability,'CAPABILITY_CHECK_REQUIRED');assert(capability.recommendedMode==='native'?capability.nativeOnboardingEnabled:Boolean(current.startChannelId&&current.flowVersionId),'RECOMMENDED_SETUP_REQUIRES_CONFIGURATION');const revisions=domainRevisions(this.db),id=await revisions.draft(s,actor,'onboarding',{onboardingMode:capability.recommendedMode,hybrid:current.hybrid}),preview=await revisions.preview(s,id);return onboardingModePreviewPanel(issue,{from:current.onboardingMode,to:capability.recommendedMode,publishData:{id,hash:preview.confirmationHash,expectedHead:preview.before?.id??null}},locale);
  }
  if(action==='rolloutPreview')return rolloutPreviewPanel(issue,current.revision,locale);
  if(action==='rolloutConfirm'){
   await this.settings.update(s,actor,z.number().parse(intent.revision),{flags:{...current.flags,native_capability_v2:true,native_snapshot_v2:true,activation_dsl_v2:true,interventions_v2:true,experiments_v2:true}});
   return successPanel(issue,t(locale,'success.rollout'),t(locale,'success.rolloutDetail'),{label:t(locale,'common.activation'),action:'activation'},locale);
  }
  if(action==='modePreview'){
   const mode=z.enum(['auto','native','fallback','hybrid']).parse(input.values?.[0]);
   const revisions=domainRevisions(this.db),id=await revisions.draft(s,actor,'onboarding',{onboardingMode:mode,hybrid:current.hybrid}),preview=await revisions.preview(s,id);
   return onboardingModePreviewPanel(issue,{from:current.onboardingMode,to:mode,publishData:{id,hash:preview.confirmationHash,expectedHead:preview.before?.id??null}},locale);
  }
  if(action==='activation')return activationPanel(issue,locale);
  if(action==='activationDraft'){
   const signal=z.enum(['reply.received','scheduled_event.subscribed','message.sent']).parse(input.values?.[0]),revisions=domainRevisions(this.db);
   assert(await new EntitlementService(this.db).canDefineActivation(s,{windowSeconds:604800,rule:{op:'event',event:signal,withinSeconds:604800}}),'ENTITLEMENT_REQUIRED');
   const id=await revisions.draft(s,actor,'activation',{name:`${signal} within 7d`,windowSeconds:604800,rule:{op:'event',event:signal,withinSeconds:604800}}),preview=await revisions.preview(s,id);
   return activationPreviewPanel(issue,{signal,publishData:{id,hash:preview.confirmationHash,expectedHead:preview.before?.id??null}},locale);
  }
  if(action==='configPublish'){
   const revisions=domainRevisions(this.db),revision=await revisions.get(s,z.uuid().parse(intent.id));
   const feature=revision.domain==='activation'?'custom_activation':revision.domain==='intervention'?'interventions':revision.domain==='experiment'?'experiments':null;
   if(feature)assert(feature==='custom_activation'?await new EntitlementService(this.db).canDefineActivation(s,revision.definition):await new EntitlementService(this.db).can(s,feature),'ENTITLEMENT_REQUIRED');
   if(revision.domain==='intervention')for(const step of interventionSchema.parse(revision.definition).actions){
    if('channelId' in step)await this.discord.checkChannel(s.guildId,step.channelId);
    if(step.type==='recommend_channels')for(const id of step.channels)await this.discord.checkChannel(s.guildId,id);
    if(step.type==='recommend_event'){assert(this.discord.options,'DISCORD_UNAVAILABLE');const choices=await this.discord.options(s.guildId);assert(choices.events.some(event=>event.id===step.eventId),'EVENT_NOT_AVAILABLE');}
    if('roleId' in step)await this.discord.validateRole(s.guildId,step.roleId);
   }
   await revisions.publish(s,actor,revision.id,z.uuid().nullable().parse(intent.expectedHead),z.string().parse(intent.hash));
   if(revision.domain==='activation')return guidedSetupPanel(issue,(await new PresentationService(this.db).home(s)).setup,locale);
   if(revision.domain==='intervention')return successPanel(issue,locale==='ja'?'改善策を有効にしました':'Improvement enabled',locale==='ja'?'返信を待つ新規メンバーがいれば、送信前にスタッフに確認します。':'NEXUS will ask staff to confirm before sending when a newcomer is waiting for a reply.',{label:locale==='ja'?'効果を確認':'Check the result',action:'experimentDraft'},locale);
   const names={activation:t(locale,'common.activation'),intervention:t(locale,'common.interventions'),experiment:t(locale,'common.experiments'),onboarding:t(locale,'settings.onboarding'),privacy:t(locale,'common.privacy'),cohort:t(locale,'root.cohorts')};return publishedPanel(issue,{name:names[revision.domain],version:revision.version},locale);
  }
  if(action==='billing'){const usage=await new EntitlementService(this.db).usage(s);return billingPanel(issue,usage,locale);}
  if(action==='lifecycle'){const metrics=await new AnalyticsService(this.db,this.settings).canonical(s);return lifecyclePanel(issue,metrics,locale);}
  if(action==='improve'){const home=await new PresentationService(this.db).home(s);return improvePanel(issue,home.communityOpportunity,locale);}
  if(action==='diagnose'){
   const analytics=new AnalyticsService(this.db,this.settings),now=Date.now(),day=86400000;
   const findings=diagnose(await analytics.canonical(s,new Date(now-15*day)),await analytics.canonical(s,new Date(now-30*day),new Date(now-15*day)));
   return diagnosticsPanel(issue,findings,locale);
  }
  if(action==='interventions'){
   const runs=(await sql<{id:string,state:string}>`SELECT id,state FROM intervention_runs WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 10`.execute(this.db)).rows;
   return interventionsPanel(issue,runs,locale);
  }
  if(action==='interventionDraft'){
   assert(await new EntitlementService(this.db).can(s,'interventions'),'ENTITLEMENT_REQUIRED');const channelId=z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]);await this.discord.checkChannel(s.guildId,channelId);
   const revisions=domainRevisions(this.db),id=await revisions.draft(s,actor,'intervention',compileActionTemplate('reply_rescue',{channelId,safetyMode:'approval'})),p=await revisions.preview(s,id);
   return interventionPreviewPanel(issue,{id,hash:p.confirmationHash,expectedHead:p.before?.id??null},locale);
  }
  if(action==='interventionApprove'){await new InterventionService(this.db).approve(s,actor,z.uuid().parse(input.values?.[0]));return successPanel(issue,t(locale,'success.intervention'),t(locale,'success.interventionDetail'),{label:t(locale,'common.interventions'),action:'interventions'},locale);}
  if(action==='experiments'){
   const revisions=domainRevisions(this.db),active=await revisions.current(s,'experiment');
   if(!active)return experimentsPanel(issue,null,locale);
   const definition=experimentSchema.parse(active.definition),result=await new ExperimentService(this.db).result(s,active.id);
   return experimentsPanel(issue,{name:definition.name,primaryMetric:definition.primaryMetric,minimumSample:definition.minimumSample,windowSeconds:definition.windowSeconds,result},locale);
  }
  if(action==='experimentMethod'){
   const active=await domainRevisions(this.db).current(s,'experiment');assert(active,'EXPERIMENT_NOT_FOUND');
   const definition=experimentSchema.parse(active.definition),result=await new ExperimentService(this.db).result(s,active.id);
   return experimentMethodPanel(issue,{name:definition.name,primaryMetric:definition.primaryMetric,minimumSample:definition.minimumSample,windowSeconds:definition.windowSeconds,result},locale);
  }
  if(action==='experimentDraft'){
   assert(await new EntitlementService(this.db).can(s,'experiments'),'ENTITLEMENT_REQUIRED');const revisions=domainRevisions(this.db),intervention=await revisions.current(s,'intervention');assert(intervention,'PUBLISH_INTERVENTION_FIRST');
   const primaryMetric=interventionSchema.parse(intervention.definition).name==='Reply Rescue'?'connection':'activation';
   const id=await revisions.draft(s,actor,'experiment',{name:'Improvement result check',eligibility:[],randomization:'time_block',blockSeconds:86400,variants:[{key:'control',weight:50,interventionRevisionId:null},{key:'treatment',weight:50,interventionRevisionId:intervention.id}],primaryMetric,windowSeconds:604800,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}}),p=await revisions.preview(s,id);
   await revisions.publish(s,actor,id,p.before?.id??null,p.confirmationHash);
   return successPanel(issue,locale==='ja'?'効果の確認を開始しました':'Result check started',locale==='ja'?'通常運用と改善ありを比較します。判断できるまでデータを集めます。':'NEXUS will compare usual operation with the improvement enabled. Results appear when enough data is ready.',{label:locale==='ja'?'結果を見る':'View Results',action:'experiments'},locale);
  }
  if(action==='cohorts')return cohortsPanel(issue,locale);
  if(action==='reports')return reportsPanel(issue,locale);
  if(action==='advanced')return settingsPanel(issue,current,locale);
  if(action==='panel'){
   assert(input.channelId,'CHANNEL_REQUIRED');
   const installed=(await sql<{channel_id:string}>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];
   const targetChannel=installed?.channel_id??input.channelId;
   await this.discord.checkChannel(s.guildId,targetChannel);
   if(!current.enabled)await this.settings.update(s,actor,current.revision,{enabled:true});
   const root=await this.communityPanel(issue,s,publicLocale);await enqueue(this.db,s,`panel:${input.id}`,'PANEL_UPSERT',{channelId:targetChannel,body:root});
   return panelInstalledPanel(issue,locale);
  }
  if(action==='panelRefresh'){
   const saved=(await sql<{channel_id:string}>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(saved,'PANEL_NOT_CONFIGURED');const root=await this.communityPanel(issue,s,publicLocale);await enqueue(this.db,s,`panel-refresh:${input.id}`,'PANEL_UPSERT',{channelId:saved.channel_id,body:root});return successPanel(issue,t(locale,'success.panelRefreshed'),t(locale,'success.panelRefreshedDetail'),{label:t(locale,'common.settings'),action:'advanced'},locale);
  }
  if(action==='controlNavigate'||action==='controlRefresh'){
   const saved=(await sql<{channel_id:string;message_id:string}>`SELECT channel_id,message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(saved,'PANEL_NOT_CONFIGURED');
   assert(!input.messageId||input.messageId===saved.message_id,'COMPONENT_EXPIRED');
   const page=z.enum(controlPages).parse(action==='controlNavigate'?input.values?.[0]:intent.page);
   const body=await this.communityPanel(issue,s,publicLocale,page);await enqueue(this.db,s,`control:${input.id}`,'PANEL_UPSERT',{channelId:saved.channel_id,body});
   return successPanel(issue,t(publicLocale,`control.${page}`),t(publicLocale,'control.updated',{time:`<t:${Math.floor(Date.now()/1000)}:R>`}),undefined,locale);
  }
  if(action==='settings')return basicSettingsPanel(issue,current,locale);
  if(action==='template')await this.onboarding.chooseTemplate(s,actor,z.number().parse(intent.revision),z.enum(templates).parse(input.values?.[0]));
  else if(action==='startChannel'){
   const channel=z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]);await this.discord.checkChannel(s.guildId,channel);
   await this.settings.update(s,actor,z.number().parse(intent.revision),{startChannelId:channel});
  }else if(action==='uiLanguage')await this.settings.update(s,actor,z.number().parse(intent.revision),{uiLanguage:z.enum(['auto','ja','en','bilingual']).parse(input.values?.[0])});
  else if(action==='adminNotificationChannel'){
   const channel=z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]);await this.discord.checkChannel(s.guildId,channel);
   await this.settings.update(s,actor,z.number().parse(intent.revision),{adminNotificationChannelId:channel});
  }
  else if(action==='helperChannel'){
   const channel=z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]);await this.discord.checkChannel(s.guildId,channel);
   await this.settings.update(s,actor,z.number().parse(intent.revision),{helperChannelId:channel});
  }
  else if(action==='helperEnabled'){
   const value=z.boolean().parse(intent.value);assert(!value||current.helperChannelId,'HELPER_CHANNEL_REQUIRED');
   await this.settings.update(s,actor,z.number().parse(intent.revision),{helperEnabled:value});
  }
  else if(action==='enabled'||action==='onboardingEnabled')await this.settings.update(s,actor,z.number().parse(intent.revision),{[action]:z.boolean().parse(intent.value)});
  else if(action==='flows'){
   if(!current.flowVersionId)return onboardingNotConfiguredPanel(issue,locale);
   const flow=await this.onboarding.flow(s,current.flowVersionId);
   const versions=(await sql<{id:string,version:number}>`SELECT id,version FROM flow_versions WHERE ${tenant(s)} ORDER BY version DESC LIMIT 25`.execute(this.db)).rows;
   return onboardingFlowPanel(issue,{revision:current.revision,nodes:flow.nodes,versions},locale);
  }else if(action==='editNode'){
   assert(current.flowVersionId,'FLOW_NOT_CONFIGURED');assert(intent.revision===current.revision,'REVISION_CONFLICT',409);
   const flow=await this.onboarding.flow(s,current.flowVersionId);const node=flow.nodes.find(n=>n.id===input.values?.[0]);assert(node,'INVALID_NODE');
   return editQuestionPanel(issue,{revision:current.revision,nodeId:node.id,question:node.question,options:node.options.map(o=>`${o.id} | ${o.label} | ${o.next??'end'}`).join('\n')},locale);
  }else if(action==='editNodeSave'){
   assert(current.flowVersionId,'FLOW_NOT_CONFIGURED');const flow=await this.onboarding.flow(s,current.flowVersionId);const node=flow.nodes.find(n=>n.id===intent.nodeId);assert(node,'INVALID_NODE');
   node.question=z.string().min(1).max(500).parse(input.fields?.question);
   node.options=z.string().parse(input.fields?.options).split('\n').filter(Boolean).map(line=>{
    const parts=line.split('|').map(v=>v.trim());assert(parts.length===3,'INVALID_OPTION_FORMAT');
    const [id,label,next]=parts;return {...node.options.find(o=>o.id===id),id:id!,label:label!,next:next==='end'?null:next!};
   });await this.onboarding.publish(s,actor,z.number().parse(intent.revision),flow);
  }else if(action==='mapOption'){
   const option=z.string().parse(input.values?.[0]);assert(intent.revision===current.revision,'REVISION_CONFLICT',409);
   return roleMappingPanel(issue,{revision:current.revision,option},locale);
  }else if(action==='mapRole'){
   assert(current.flowVersionId,'FLOW_NOT_CONFIGURED');const flow=await this.onboarding.flow(s,current.flowVersionId);
   const [nodeId,optionId]=String(intent.option).split(':');const option=flow.nodes.find(n=>n.id===nodeId)?.options.find(o=>o.id===optionId);assert(option,'INVALID_OPTION');
   const roleId=input.values?.[0];if(roleId){await this.discord.validateRole(s.guildId,roleId);option.roleId=roleId;}else delete option.roleId;
   await this.onboarding.publish(s,actor,z.number().parse(intent.revision),flow);
  }else if(action==='rollback')await this.onboarding.rollback(s,actor,z.number().parse(intent.revision),z.uuid().parse(input.values?.[0]));
  else if(action==='personalize'||action==='restart'||action==='preview'){
   const session=await this.onboarding.start(s,input.userId,new Date(member.joinedAt),action==='preview'?'PREVIEW':'PRODUCTION',action==='restart'||action==='preview');
   return this.sessionPanel(issue,session,locale);
  }else if(action==='answer'){
   const session=await this.onboarding.answer(s,input.userId,z.uuid().parse(intent.sessionId),z.number().parse(intent.revision),z.string().parse(intent.nodeId),z.array(z.string()).min(1).parse(input.values));
   return this.sessionPanel(issue,session,locale);
  }else if(action==='privacy')return privacyPanel(issue,admin,locale);
  else if(action==='deleteMemberConfirm'||action==='deleteGuildConfirm')return confirmation(issue,action==='deleteGuildConfirm'?'deleteGuild':'deleteMember',locale);
  else if(action==='deleteMember'||action==='deleteGuild'){
   assert(input.customId,'CONFIRMATION_REQUIRED');await this.deletion(s,input.userId,actor,action==='deleteGuild');return successPanel(issue,t(locale,'success.deletion'),t(locale,'success.deletionDetail'),{label:t(locale,'common.privacy'),action:'privacy'},locale);
  }else if(action==='overview'||action==='dashboard'){
   const analytics=new AnalyticsService(this.db,this.settings),metrics=await analytics.canonical(s),now=Date.now(),day=86400000;
   const findings=diagnose(await analytics.canonical(s,new Date(now-15*day)),await analytics.canonical(s,new Date(now-30*day),new Date(now-15*day)));
   const diagnosis=findings.filter(f=>f.type!=='DATA_COVERAGE_DROP').sort((a,b)=>(a.severity==='critical'?0:1)-(b.severity==='critical'?0:1))[0];
   const summary=await analytics.overview(s);return overviewPanel(issue,metrics,locale,{diagnosis,unansweredAfter24h:summary.unansweredAfter24h?.value??null});
  }
  else if(action==='status'){
   const capability=await new CapabilityService(this.db,this.discord).latest(s),home=await new PresentationService(this.db).home(s),activation=await domainRevisions(this.db).current(s,'activation'),cursor=(await sql<{last_seen:Date}>`SELECT last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db)).rows[0],gap=(await sql`SELECT id FROM telemetry_health WHERE ${tenant(s)} AND ended_at IS NULL LIMIT 1`.execute(this.db)).rows.length>0,ingestion=Boolean(cursor&&cursor.last_seen.getTime()>Date.now()-10*60*1000&&!gap),validWeb=(()=>{try{return Boolean(process.env.NEXUS_WEB_URL&&/^https?:\/\//.test(new URL(process.env.NEXUS_WEB_URL).href));}catch{return false;}})(),permissions=Boolean(capability?.sendMessages&&(capability.manageRoles||!current.flowVersionId)),onboarding=home.setup.steps.find(step=>step.key==='onboarding')?.complete??false;
   const checks:ReadinessCheck[]=[
    {label:t(locale,'health.discordConnection'),status:capability?'Ready':'Needs attention',detail:capability?undefined:t(locale,'health.fixConnection')},
    {label:t(locale,'health.permissions'),status:permissions?'Ready':'Needs attention',detail:permissions?undefined:t(locale,'health.fixPermissions')},
    {label:t(locale,'health.dataIngestion'),status:ingestion?'Ready':'Needs attention',detail:ingestion?undefined:t(locale,'health.fixIngestion')},
    {label:t(locale,'health.activationDefinition'),status:activation?'Ready':'Not configured',detail:activation?undefined:t(locale,'health.fixActivation')},
    {label:t(locale,'health.onboarding'),status:onboarding?'Ready':'Not configured',detail:onboarding?undefined:t(locale,'health.fixOnboarding')},
    {label:t(locale,'health.actionEngine'),status:current.flags.interventions_v2?'Ready':'Not configured',detail:current.flags.interventions_v2?undefined:t(locale,'health.fixActionEngine')},
    {label:t(locale,'health.experimentEngine'),status:current.flags.experiments_v2?'Ready':'Not configured',detail:current.flags.experiments_v2?undefined:t(locale,'health.fixExperimentEngine')},
    {label:t(locale,'health.webDashboard'),status:validWeb?'Ready':'Not configured',detail:validWeb?undefined:t(locale,'health.fixWebDashboard')}
   ];return activationReadinessPanel(issue,checks,locale);
  }else throw new DomainError('UNKNOWN_ACTION');
  const updated=await this.settings.get(s),updatedLocale=resolveLocale(updated.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale});return ['uiLanguage','adminNotificationChannel','helperChannel','helperEnabled'].includes(action)?basicSettingsPanel(issue,updated,updatedLocale):settingsPanel(issue,updated,updatedLocale);
 }
 private async communityPanel(issue:Issue,s:Scope,locale:UiLocale,page:ControlPage='overview'){
  const data:Parameters<typeof controlPanel>[2]={dashboardUrl:process.env.NEXUS_WEB_URL,updatedAt:new Date()};
  if(['overview','newMembers','community','channels','improve'].includes(page))data.community=await new CommunityService(this.db,this.settings).overview(s,30);
  if(page==='settings'){const current=await this.settings.get(s);data.settings={analysisScope:current.analysisScope,weeklySummaryEnabled:current.weeklySummaryEnabled,helperEnabled:current.helperEnabled,goalPreset:current.goalPreset,uiLanguage:current.uiLanguage};}
  if(page==='results'){const active=await domainRevisions(this.db).current(s,'experiment');if(active){const result=await new ExperimentService(this.db).result(s,active.id);data.results={controlRate:result.controlRate,treatmentRate:result.treatmentRate,controlN:result.controlN,treatmentN:result.treatmentN,state:result.state};}}
  if(page==='diagnostics'){const command=(await sql<{definition_hash:string}>`SELECT definition_hash FROM guild_command_sync WHERE ${tenant(s)}`.execute(this.db)).rows[0],last=(await sql<{received_at:Date;result:string}>`SELECT received_at,result FROM interaction_diagnostics WHERE ${tenant(s)} ORDER BY received_at DESC LIMIT 1`.execute(this.db)).rows[0],runtime=this.runtime?.();data.diagnostics={gatewayConnected:runtime?.gatewayConnected??false,transport:runtime?.interaction.transport??'gateway',commandsRegistered:Boolean(command&&runtime&&command.definition_hash===runtime.commandHash),lastReceivedAt:runtime?.interaction.lastReceivedAt??last?.received_at.toISOString()??null,lastResult:runtime?.interaction.lastResult??last?.result??null};}
  return controlPanel(issue,page,data,locale);
 }
 private async sessionPanel(issue:Issue,session:Session,locale:ReturnType<typeof resolveLocale>){
  if(session.state.complete)return sessionCompletePanel(issue,locale);
  const node=session.definition.nodes.find(n=>n.id===session.state.nodeId)!;
  return questionPanel(issue,{sessionId:session.id,revision:session.revision,nodeId:node.id,question:node.question,options:node.options,context:session.context,type:node.type},locale);
 }
}

