import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {PermissionFlagsBits} from 'discord-api-types/v10';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {Components,canOperatePanel} from '../../../packages/security/src/index.js';
import {SettingsService,templates,type Actor} from '../../../packages/settings/src/index.js';
import {OnboardingService,type Session} from '../../../packages/onboarding/src/index.js';
import {controlPanel,controlPages,settingsSections,analysisViews,panelPlacementWarning,settingsPanel,basicSettingsPanel,improvePanel,privacyPanel,questionPanel,confirmation,errorPanel,activationPanel,activationPreviewPanel,billingPanel,lifecyclePanel,diagnosticsPanel,interventionsPanel,interventionPreviewPanel,experimentsPanel,experimentMethodPanel,cohortsPanel,reportsPanel,overviewPanel,publishedPanel,successPanel,panelInstalledPanel,rolloutPreviewPanel,onboardingModePreviewPanel,onboardingNotConfiguredPanel,onboardingFlowPanel,editQuestionPanel,roleMappingPanel,sessionCompletePanel,activationReadinessPanel,guidedSetupPanel,resolveLocale,t,nexusPanel,callout,divider,actionRow,type Panel,type Issue,type ReadinessCheck,type UiLocale,type ControlPage,type SettingsSection,type AnalysisView} from '../../../packages/discord-panels/src/index.js';
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
import {releaseInfo} from '../../../packages/shared/src/runtime-info.js';
import {recordProductEvent} from '../../../packages/shared/src/product-telemetry.js';
type DeleteData=(s:Scope,userId:string,actor:Actor,guild:boolean)=>Promise<void>;
export class InteractionWorker {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly tokens:Components,private readonly discord:DiscordPort,
 private readonly settings:SettingsService,private readonly onboarding:OnboardingService,private readonly deletion:DeleteData,
 private readonly runtime?:()=>{gatewayConnected:boolean;redisConnected:boolean;interaction:InteractionHealthSnapshot;commandHash:string}){}
 async tick(s:Scope){
  const started=Date.now();
  const job=await this.db.transaction().execute(async tx=>{
   const row=(await sql<{id:string,encrypted_payload:string}>`SELECT id,encrypted_payload FROM interaction_jobs WHERE ${tenant(s)}
    AND created_at>now()-interval '14 minutes' AND attempts<5 AND (state='PENDING' OR state='RUNNING' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`.execute(tx)).rows[0];
   if(row)await sql`UPDATE interaction_jobs SET state='RUNNING',lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE ${tenant(s)} AND id=${row.id}`.execute(tx);
   return row;
  });if(!job)return false;
  const input=JSON.parse(this.vault.open(s,job.encrypted_payload)) as InteractionJob;
  let body:Panel,privateError=false;
  try{
   body=await this.dispatch(s,input);
   void recordProductEvent(this.db,s,'interaction_latency',Date.now()-started).catch(()=>{});
   if(input.messageId&&input.customId){
    const installed=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];
    if(installed?.message_id===input.messageId){
     const intent=await this.tokens.read(this.db,s,input.customId,this.vault.hash(s,input.userId));
     privateError=intent.action==='advanced'||intent.action==='privacy';
    }
   }
  }catch(error){
   void recordProductEvent(this.db,s,'interaction_failed').catch(()=>{});
   const kind=error instanceof DomainError?error.code==='REVISION_CONFLICT'?'revision':error.code==='ADMIN_REQUIRED'?'permission':error.code==='ENTITLEMENT_REQUIRED'?'entitlement':'generic':'generic';
   const actorHash=this.vault.hash(s,input.userId),issue:Issue=(data,publicEntry=false)=>this.tokens.issue(this.db,s,data,publicEntry?null:actorHash,publicEntry?31536000:900);
   let language:'auto'|'ja'|'en'|'bilingual'='auto';try{language=(await this.settings.get(s)).uiLanguage;}catch{/* Error response still has interaction locale. */}
   const locale=resolveLocale(language,{interactionLocale:input.locale,guildLocale:input.guildLocale}),internal=!(error instanceof DomainError||error instanceof z.ZodError),reference=internal?`NXS-${randomBytes(3).toString('hex').toUpperCase()}`:undefined;
   if(reference)process.stderr.write(`[${reference}] ${error instanceof Error?error.name:'UNKNOWN_ERROR'}\n`);
   privateError=Boolean(input.messageId);body=await errorPanel(issue,kind,locale,reference,error instanceof DomainError?error.code:undefined);
  }
  await this.db.transaction().execute(async tx=>{
   const interactionHash=this.vault.hash(s,input.id);
   await enqueue(tx,s,`reply:${input.id}`,privateError?'REPLY_FOLLOWUP':'REPLY_EDIT',{applicationId:input.applicationId,encryptedToken:this.vault.seal(s,input.token),body,interactionHash});
   await sql`UPDATE interaction_diagnostics SET result='queued' WHERE ${tenant(s)} AND interaction_hash=${interactionHash}`.execute(tx);
   await sql`UPDATE interaction_jobs SET state='SUCCEEDED',lease_until=NULL WHERE ${tenant(s)} AND id=${input.id}`.execute(tx);
  });return true;
 }
 async dispatch(s:Scope,input:InteractionJob):Promise<Panel>{
  const member=await this.discord.member(s.guildId,input.userId);const actorHash=this.vault.hash(s,input.userId);
  const actor:Actor={key:actorHash,permissions:member.permissions,roles:member.roles,source:'DISCORD_PANEL',requestId:input.id,encryptedUserId:this.vault.seal(s,input.userId)};
  const current=await this.settings.get(s);const admin=canOperatePanel(member.permissions,member.roles,[current.adminRoleId,...current.managerRoleIds]);
  const locale=resolveLocale(current.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale});
  const publicLocale=resolveLocale(current.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale,publicPanel:true});
  const intent=input.customId?await this.tokens.read(this.db,s,input.customId,actorHash):{action:input.command};
  const action=String(intent.action??'');
  if(action==='panel'||action==='controlNavigate'){
   const page=action==='panel'?'overview':String(input.values?.[0]??'');
   const event=page==='attention'?'attention_opened':page==='analysis'?'analysis_opened':page==='settings'?'settings_opened':'panel_opened';
   void recordProductEvent(this.db,s,event).catch(()=>{});
  }
  const issue:Issue=(data,publicEntry=false)=>this.tokens.issue(this.db,s,data,publicEntry?null:actorHash,publicEntry?31536000:900);
  const adminActions=['panel','panelConfirm','panelChoose','panelRefresh','panelMoveConfirm','controlNavigate','controlRefresh','controlAnalysis','controlChannelPage','controlSettings','controlSummaryField','controlGoalPurpose','controlScope','controlScopeChannels','controlManagers','controlManagersConfirm','controlClearManagers','controlClearHelpers','controlSkipTeam','controlSkipNotifications','controlSkipGoals','controlScopeDefault','controlKeepSettings','controlReviewSetup','controlMovePanel','controlOpenAttention','controlOpenDiagnostics','controlResolve','controlAcknowledge','controlSnoozeMenu','controlSnooze','controlApplyImprove','controlCancelImprove','controlHelpers','controlHelperChannel','controlAlertDelay','controlHelperToggle','controlGoal','controlGoalPreset','controlGoalChannel','controlWeeklyChannel','controlWeeklyDay','controlWeeklyHour','controlTimezone','controlWeeklyToggle','controlTryImprove','controlTestAlert','controlTestSummary','setup','recommendedSetup','rolloutPreview','rolloutConfirm','modePreview','modeConfirm','lifecycle','activation','activationDraft','activationPublish','cohorts','diagnose','improve','interventions','interventionDraft','interventionApprove','experiments','experimentMethod','experimentDraft','configPublish','reports','billing','advanced','settings','status','flows','template','startChannel','adminNotificationChannel','helperChannel','helperEnabled','uiLanguage','enabled','onboardingEnabled','mapOption','mapRole','editNode','editNodeOpen','editNodeSave','rollback','preview','deleteGuildConfirm','deleteGuild','overview','dashboard'];
  if(adminActions.includes(action))assert(admin,'ADMIN_REQUIRED',403);
  const followupControlActions=new Set(['controlManagersConfirm','controlApplyImprove','controlSnooze','controlCancelImprove']);
  if(action.startsWith('control')&&input.messageId&&!followupControlActions.has(action)){
   const active=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];
   assert(active?.message_id===input.messageId,'COMPONENT_EXPIRED');
  }
  if(action==='setup'){
   void recordProductEvent(this.db,s,'setup_started').catch(()=>{});
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
   if(revision.domain==='intervention')return successPanel(issue,t(locale,'improvement.enabledTitle'),t(locale,'improvement.enabledDetail'),{label:t(locale,'improvement.checkResult'),action:'experimentDraft'},locale);
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
   return successPanel(issue,t(locale,'improvement.resultStartedTitle'),t(locale,'improvement.resultStartedDetail'),{label:t(locale,'improvement.viewResults'),action:'experiments'},locale);
  }
  if(action==='cohorts')return cohortsPanel(issue,locale);
  if(action==='reports')return reportsPanel(issue,locale);
  if(action==='advanced')return settingsPanel(issue,current,locale);
  if(action==='panel'||action==='panelConfirm'||action==='panelMoveConfirm'||action==='controlMovePanel'){
   assert(input.channelId,'CHANNEL_REQUIRED');
   const installed=(await sql<{channel_id:string}>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];
   const targetChannel=action==='panelConfirm'||action==='panelMoveConfirm'?z.string().regex(/^\d{17,20}$/).parse(intent.channelId):action==='controlMovePanel'?z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]):input.channelId;
   await this.discord.checkChannel(s.guildId,targetChannel);
   if(action==='controlMovePanel'&&installed?.channel_id===targetChannel)return this.communityPanel(issue,s,publicLocale,'settings','panel');
   if(action==='panel'&&installed&&installed.channel_id!==targetChannel||action==='controlMovePanel')return nexusPanel({title:t(locale,'control.panel'),children:[divider(),callout(t(locale,'control.moveHere'),`<#${targetChannel}>`)],rows:[await actionRow(issue,[{label:t(locale,'control.moveHere'),action:'panelMoveConfirm',data:{channelId:targetChannel},style:1},{label:t(locale,'control.cancel'),action:'panelChoose'}])]});
   if((action==='panel'||action==='panelMoveConfirm')&&await this.discord.publicChannel?.(s.guildId,targetChannel))return panelPlacementWarning(issue,targetChannel,locale);
   if(!current.enabled)await this.settings.update(s,actor,current.revision,{enabled:true});
   const root=await this.communityPanel(issue,s,publicLocale);await enqueue(this.db,s,`panel:${input.id}`,'PANEL_UPSERT',{channelId:targetChannel,body:root});
   return panelInstalledPanel(issue,locale);
  }
  if(action==='panelChoose')return successPanel(issue,t(locale,'control.chooseAnother'),t(locale,'control.chooseAnotherDetail'),undefined,locale);
  if(action==='panelRefresh'){
   const saved=(await sql<{channel_id:string}>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(saved,'PANEL_NOT_CONFIGURED');const root=await this.communityPanel(issue,s,publicLocale);await enqueue(this.db,s,`panel-refresh:${input.id}`,'PANEL_UPSERT',{channelId:saved.channel_id,body:root});return successPanel(issue,t(locale,'success.panelRefreshed'),t(locale,'success.panelRefreshedDetail'),{label:t(locale,'common.settings'),action:'advanced'},locale);
  }
  if(action==='controlNavigate'||action==='controlRefresh'||action==='controlAnalysis'||action==='controlChannelPage'||action==='controlSettings'||action==='controlSummaryField'||action==='controlGoalPurpose'){
   const saved=(await sql<{channel_id:string;message_id:string}>`SELECT channel_id,message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(saved,'PANEL_NOT_CONFIGURED');
   assert(!input.messageId||input.messageId===saved.message_id,'COMPONENT_EXPIRED');
   const page=z.enum(controlPages).parse(action==='controlNavigate'?input.values?.[0]:action==='controlSettings'||action==='controlSummaryField'||action==='controlGoalPurpose'?'settings':action==='controlChannelPage'||action==='controlAnalysis'?'analysis':intent.page);
   const section=action==='controlSettings'?z.enum(settingsSections).parse(input.values?.[0]):action==='controlSummaryField'?'summary':action==='controlGoalPurpose'?'goals':intent.section?z.enum(settingsSections).parse(intent.section):'scope';
   const channelPage=action==='controlChannelPage'?z.number().int().min(0).parse(intent.index):intent.channelPage?z.number().int().min(0).parse(intent.channelPage):0;
   const summaryField=action==='controlSummaryField'?z.enum(['channel','day','hour','timezone']).parse(input.values?.[0]):'none';
   const goalPurpose=action==='controlGoalPurpose'?z.enum(['lfg','feedback','bug','playtest']).parse(input.values?.[0]):'none';
   const analysisView:AnalysisView=action==='controlAnalysis'?z.enum(analysisViews).parse(input.values?.[0]):action==='controlChannelPage'?'channels':intent.analysisView?z.enum(analysisViews).parse(intent.analysisView):'overall';
   return this.communityPanel(issue,s,publicLocale,page,section,channelPage,summaryField,goalPurpose,analysisView);
  }
  if(action==='controlTryImprove'){
   if(!current.helperChannelId)return this.communityPanel(issue,s,publicLocale,'settings','notifications');
   return nexusPanel({title:t(locale,'control.improve'),children:[divider(),callout(t(locale,'control.replyAlert'),t(locale,'control.improvementPreview'))],rows:[await actionRow(issue,[{label:t(locale,'control.applyImprovement'),action:'controlApplyImprove',data:{revision:current.revision,panelMessageId:input.messageId},style:1},{label:t(locale,'control.cancel'),action:'controlCancelImprove'}])]});
  }
  if(action==='controlCancelImprove')return this.communityPanel(issue,s,publicLocale,'analysis');
  if(action==='controlApplyImprove'){assert(input.customId,'CONFIRMATION_REQUIRED');if(intent.panelMessageId){const active=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(active?.message_id===intent.panelMessageId,'COMPONENT_EXPIRED');}await this.settings.update(s,actor,z.number().parse(intent.revision),{helperEnabled:true,firstResponseMinutes:20});return this.communityPanel(issue,s,publicLocale,'settings','notifications');}
  if(action==='controlManagers'||action==='controlClearManagers'){
   const ids=action==='controlClearManagers'?[]:z.array(z.string().regex(/^\d{17,20}$/)).max(20).parse(input.values??[]),roles=await this.discord.roles(s.guildId);
   assert(ids.every(id=>{const role=roles.find(item=>item.id===id);return role&&role.id!==s.guildId&&!role.managed&&(BigInt(role.permissions)&PermissionFlagsBits.Administrator)===0n;}),'INVALID_ROLE');
   return nexusPanel({title:t(locale,'control.managers'),children:[divider(),callout(ids.map(id=>`<@&${id}>`).join(' ')||t(locale,'control.ownerAdmins'),t(locale,'control.roleConfirm'))],rows:[await actionRow(issue,[{label:t(locale,'control.confirmRoles'),action:'controlManagersConfirm',data:{ids,revision:current.revision,panelMessageId:input.messageId},style:1},{label:t(locale,'control.cancel'),action:'controlCancelImprove'}])]});
  }
  if(action==='controlManagersConfirm'){
   if(intent.panelMessageId){const active=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(active?.message_id===intent.panelMessageId,'COMPONENT_EXPIRED');}
   assert(input.customId,'CONFIRMATION_REQUIRED');const ids=z.array(z.string().regex(/^\d{17,20}$/)).max(20).parse(intent.ids),roles=await this.discord.roles(s.guildId);
   assert(ids.every(id=>{const role=roles.find(item=>item.id===id);return role&&role.id!==s.guildId&&!role.managed&&(BigInt(role.permissions)&PermissionFlagsBits.Administrator)===0n;}),'INVALID_ROLE');
   await this.settings.update(s,actor,z.number().parse(intent.revision),{managerRoleIds:ids,setupSteps:{...current.setupSteps,team:true}});
   void recordProductEvent(this.db,s,'setup_team_completed').catch(()=>{});
   if(Object.values({...current.setupSteps,team:true}).every(Boolean)&&!Object.values(current.setupSteps).every(Boolean))void recordProductEvent(this.db,s,'setup_completed').catch(()=>{});
   return this.communityPanel(issue,s,publicLocale,'settings','team');
  }
  if(action==='controlSnoozeMenu'){
   const channelId=z.string().regex(/^\d{17,20}$/).parse(intent.channelId),messageId=z.string().regex(/^\d{17,20}$/).parse(intent.messageId);
   return nexusPanel({title:t(locale,'control.snooze'),children:[divider(),callout(t(locale,'control.queueTitle',{channel:channelId}),t(locale,'control.queueUnconfirmed'))],rows:[await actionRow(issue,[{label:t(locale,'control.snooze30'),action:'controlSnooze',data:{channelId,messageId,minutes:30,panelMessageId:input.messageId}},{label:t(locale,'control.snooze60'),action:'controlSnooze',data:{channelId,messageId,minutes:60,panelMessageId:input.messageId}},{label:t(locale,'control.snoozeToday'),action:'controlSnooze',data:{channelId,messageId,until:'today',panelMessageId:input.messageId}}])]});
  }
  if(action==='controlResolve'||action==='controlAcknowledge'||action==='controlSnooze'){
   if(intent.panelMessageId){const active=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(active?.message_id===intent.panelMessageId,'COMPONENT_EXPIRED');}
   const channelId=z.string().regex(/^\d{17,20}$/).parse(intent.channelId),messageId=z.string().regex(/^\d{17,20}$/).parse(intent.messageId);
   const source=(await sql<{occurred_at:Date}>`SELECT occurred_at FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND kind='message.sent' AND data->>'messageId'=${messageId} AND data->>'channelId'=${channelId} LIMIT 1`.execute(this.db)).rows[0];assert(source,'ATTENTION_NOT_FOUND');
   const status=action==='controlResolve'?'RESOLVED':action==='controlAcknowledge'?'ACKNOWLEDGED':'SNOOZED';
   let snoozeUntil:Date|null=null;if(status==='SNOOZED'){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:current.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
    const minutes=intent.until==='today'?Math.max(1,1440-Number(parts.hour)*60-Number(parts.minute)):z.number().int().min(1).max(1440).parse(intent.minutes);
    snoozeUntil=new Date(Date.now()+minutes*60000);
   }
   await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,snooze_until,resolved_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channelId},${messageId},${source.occurred_at},${status},${snoozeUntil},${status==='RESOLVED'?new Date():null}) ON CONFLICT(organization_id,guild_id,message_id) DO UPDATE SET status=EXCLUDED.status,snooze_until=EXCLUDED.snooze_until,resolved_at=EXCLUDED.resolved_at`.execute(this.db);
   return this.communityPanel(issue,s,publicLocale,'attention');
  }
  if(action==='controlOpenDiagnostics')return this.communityPanel(issue,s,publicLocale,'diagnostics');
  if(action==='controlOpenAttention')return this.communityPanel(issue,s,publicLocale,'attention');
  if(action==='controlReviewSetup')return this.communityPanel(issue,s,publicLocale,'settings','scope');
  if(action.startsWith('control')){
   const saved=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];assert(saved&&input.messageId===saved.message_id,'COMPONENT_EXPIRED');
   const revision=intent.revision===undefined?current.revision:z.number().parse(intent.revision),value=input.values?.[0];
   if(action==='controlScopeDefault')await this.settings.update(s,actor,revision,{analysisScope:{mode:'all',channelIds:[]},setupSteps:{...current.setupSteps,scope:true}});
   else if(action==='controlSkipTeam')await this.settings.update(s,actor,revision,{managerRoleIds:[],setupSteps:{...current.setupSteps,team:true}});
   else if(action==='controlSkipNotifications')await this.settings.update(s,actor,revision,{helperEnabled:false,setupSteps:{...current.setupSteps,notifications:true}});
   else if(action==='controlSkipGoals')await this.settings.update(s,actor,revision,{newMemberGoals:[],setupSteps:{...current.setupSteps,goals:true}});
   else if(action==='controlKeepSettings')await this.settings.update(s,actor,revision,{setupVersion:2});
   else if(action==='controlClearHelpers')await this.settings.update(s,actor,revision,{helperRoleIds:[]});
   else if(action==='controlScope')await this.settings.update(s,actor,revision,{analysisScope:{...current.analysisScope,mode:z.enum(['all','include','exclude']).parse(value)},setupSteps:{...current.setupSteps,scope:true}});
   else if(action==='controlScopeChannels')await this.settings.update(s,actor,revision,{analysisScope:{...current.analysisScope,channelIds:z.array(z.string().regex(/^\d{17,20}$/)).min(1).max(25).parse(input.values)},setupSteps:{...current.setupSteps,scope:true}});
   else if(action==='controlHelpers'){
    const ids=z.array(z.string().regex(/^\d{17,20}$/)).max(20).parse(input.values??[]),roles=await this.discord.roles(s.guildId);
    assert(ids.every(id=>{const role=roles.find(item=>item.id===id);return role&&role.id!==s.guildId&&!role.managed&&(BigInt(role.permissions)&PermissionFlagsBits.Administrator)===0n;}),'INVALID_ROLE');
    await this.settings.update(s,actor,revision,{helperRoleIds:ids});
   }
   else if(action==='controlHelperChannel'){const channel=z.string().regex(/^\d{17,20}$/).parse(value);await this.discord.checkChannel(s.guildId,channel);await this.settings.update(s,actor,revision,{helperChannelId:channel,setupSteps:{...current.setupSteps,notifications:true}});}
   else if(action==='controlAlertDelay')await this.settings.update(s,actor,revision,{firstResponseMinutes:z.coerce.number().int().min(1).max(1440).parse(value)});
   else if(action==='controlHelperToggle'){const enabled=z.boolean().parse(intent.value);assert(!enabled||current.helperChannelId,'HELPER_CHANNEL_REQUIRED');await this.settings.update(s,actor,revision,{helperEnabled:enabled});}
   else if(action==='controlGoal')await this.settings.update(s,actor,revision,{newMemberGoals:z.array(z.enum(['reply','lfg','voice','event','feedback','bug','playtest'])).max(7).parse(input.values??[]),setupSteps:{...current.setupSteps,goals:true}});
   else if(action==='controlGoalPreset')await this.settings.update(s,actor,revision,{goalPreset:z.enum(['multiplayer','early_access','live_service']).parse(value)});
   else if(action==='controlGoalChannel'){const channel=z.string().regex(/^\d{17,20}$/).parse(value),purpose=z.enum(['lfg','feedback','bug','playtest']).parse(intent.purpose);await this.discord.checkChannel(s.guildId,channel);const channels=[...current.importantChannels.filter(item=>item.purpose!==purpose),{channelId:channel,purpose}];await this.settings.update(s,actor,revision,{importantChannels:channels});}
   else if(action==='controlWeeklyChannel'){const channel=z.string().regex(/^\d{17,20}$/).parse(value);await this.discord.checkChannel(s.guildId,channel);await this.settings.update(s,actor,revision,{weeklySummaryChannelId:channel});}
   else if(action==='controlWeeklyDay')await this.settings.update(s,actor,revision,{weeklySummaryDay:z.coerce.number().int().min(0).max(6).parse(value)});
   else if(action==='controlWeeklyHour')await this.settings.update(s,actor,revision,{weeklySummaryHour:z.coerce.number().int().min(0).max(23).parse(value)});
   else if(action==='controlTimezone')await this.settings.update(s,actor,revision,{timezone:z.enum(['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','Europe/London','Europe/Paris','Europe/Berlin','Asia/Tokyo','Asia/Seoul','Asia/Singapore','Asia/Kolkata','Australia/Sydney']).parse(value)});
   else if(action==='controlWeeklyToggle'){const enabled=z.boolean().parse(intent.value);assert(!enabled||current.weeklySummaryChannelId,'CHANNEL_REQUIRED');await this.settings.update(s,actor,revision,{weeklySummaryEnabled:enabled});}
   else if(action==='controlTestAlert'||action==='controlTestSummary'){
    const channel=action==='controlTestAlert'?current.helperChannelId:current.weeklySummaryChannelId;assert(channel,'CHANNEL_REQUIRED');await this.discord.checkChannel(s.guildId,channel);
    await enqueue(this.db,s,`test:${input.id}`,'TEST_MESSAGE',{channelId:channel,body:{content:t(publicLocale,action==='controlTestAlert'?'control.testAlertMessage':'control.testSummaryMessage'),allowed_mentions:{parse:[]}}});
    if(action==='controlTestAlert')void recordProductEvent(this.db,s,'test_notification_sent').catch(()=>{});
   }else throw new DomainError('UNKNOWN_ACTION');
   const setupEvent=action==='controlScope'||action==='controlScopeDefault'||action==='controlScopeChannels'?'setup_scope_completed':action==='controlSkipTeam'?'setup_team_completed':action==='controlSkipNotifications'||action==='controlHelperChannel'?'setup_notification_completed':action==='controlSkipGoals'||action==='controlGoal'?'setup_goal_completed':null;
   if(setupEvent)void recordProductEvent(this.db,s,setupEvent).catch(()=>{});
   if(action!=='controlTestAlert'&&action!=='controlTestSummary')void recordProductEvent(this.db,s,'setting_saved').catch(()=>{});
   const updated=await this.settings.get(s);if(Object.values(updated.setupSteps).every(Boolean)&&!Object.values(current.setupSteps).every(Boolean))void recordProductEvent(this.db,s,'setup_completed').catch(()=>{});
   const section:SettingsSection=action==='controlScope'||action==='controlScopeDefault'||action==='controlScopeChannels'||action==='controlKeepSettings'?'scope':action==='controlHelpers'||action==='controlClearHelpers'||action==='controlSkipTeam'?'team':action.startsWith('controlGoal')||action==='controlSkipGoals'?'goals':action.startsWith('controlWeekly')||action==='controlTimezone'||action==='controlTestSummary'?'summary':'notifications';
   return this.communityPanel(issue,s,publicLocale,'settings',section);
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
   ];return activationReadinessPanel(issue,checks,locale,releaseInfo());
  }else throw new DomainError('UNKNOWN_ACTION');
  const updated=await this.settings.get(s),updatedLocale=resolveLocale(updated.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale});return ['uiLanguage','adminNotificationChannel','helperChannel','helperEnabled'].includes(action)?basicSettingsPanel(issue,updated,updatedLocale):settingsPanel(issue,updated,updatedLocale);
 }
 private async communityPanel(issue:Issue,s:Scope,locale:UiLocale,page:ControlPage='overview',section:SettingsSection='scope',channelPage=0,summaryField:'none'|'channel'|'day'|'hour'|'timezone'='none',goalPurpose:'none'|'lfg'|'feedback'|'bug'|'playtest'='none',analysisView:AnalysisView='overall'){
  const data:Parameters<typeof controlPanel>[2]={dashboardUrl:process.env.NEXUS_WEB_URL,updatedAt:new Date()};
  if(['overview','newMembers','attention','analysis','community','channels','improve'].includes(page))data.community=await new CommunityService(this.db,this.settings).overview(s,30);
  if(page==='settings'||page==='overview'){const current=await this.settings.get(s),installed=(await sql<{channel_id:string}>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(this.db)).rows[0];data.settings={analysisScope:current.analysisScope,managerRoleIds:current.managerRoleIds,helperRoleIds:current.helperRoleIds,weeklySummaryEnabled:current.weeklySummaryEnabled,weeklySummaryChannelId:current.weeklySummaryChannelId,weeklySummaryDay:current.weeklySummaryDay,weeklySummaryHour:current.weeklySummaryHour,timezone:current.timezone,helperEnabled:current.helperEnabled,helperChannelId:current.helperChannelId,firstResponseMinutes:current.firstResponseMinutes,goalPreset:current.goalPreset,newMemberGoals:current.newMemberGoals,importantChannels:current.importantChannels,uiLanguage:current.uiLanguage,detailedRetentionDays:current.detailedRetentionDays,revision:current.revision,setupVersion:current.setupVersion,panelChannelId:installed?.channel_id??null,setupSteps:current.setupSteps};}
  if(page==='results'){const active=await domainRevisions(this.db).current(s,'experiment');if(active){const result=await new ExperimentService(this.db).result(s,active.id);data.results={controlRate:result.controlRate,treatmentRate:result.treatmentRate,controlN:result.controlN,treatmentN:result.treatmentN,state:result.state};}}
  if(page==='diagnostics'){const command=(await sql<{definition_hash:string}>`SELECT definition_hash FROM guild_command_sync WHERE ${tenant(s)}`.execute(this.db)).rows[0],last=(await sql<{received_at:Date;acknowledged_at:Date;completed_at:Date|null;result:string}>`SELECT received_at,acknowledged_at,completed_at,result FROM interaction_diagnostics WHERE ${tenant(s)} ORDER BY received_at DESC LIMIT 1`.execute(this.db)).rows[0],activity=(await sql<{last_seen:Date}>`SELECT last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(this.db)).rows[0],runtime=this.runtime?.();data.diagnostics={...releaseInfo(),gatewayConnected:runtime?.gatewayConnected??false,transport:runtime?.interaction.transport??'gateway',commandsRegistered:Boolean(command&&runtime&&command.definition_hash===runtime.commandHash),lastReceivedAt:runtime?.interaction.lastReceivedAt??last?.received_at.toISOString()??null,lastAcknowledgedAt:runtime?.interaction.lastAcknowledgedAt??last?.acknowledged_at.toISOString()??null,lastCompletedAt:runtime?.interaction.lastCompletedAt??last?.completed_at?.toISOString()??null,lastResult:runtime?.interaction.lastResult??last?.result??null,lastActivityAt:activity?.last_seen.toISOString()??null,databaseConnected:true,redisConnected:runtime?.redisConnected??false};}
  return controlPanel(issue,page,data,locale,section,channelPage,summaryField,goalPurpose,analysisView);
 }
 private async sessionPanel(issue:Issue,session:Session,locale:ReturnType<typeof resolveLocale>){
  if(session.state.complete)return sessionCompletePanel(issue,locale);
  const node=session.definition.nodes.find(n=>n.id===session.state.nodeId)!;
  return questionPanel(issue,{sessionId:session.id,revision:session.revision,nodeId:node.id,question:node.question,options:node.options,context:session.context,type:node.type},locale);
 }
}

