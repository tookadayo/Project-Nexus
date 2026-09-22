import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {Components,canAdmin} from '../../../packages/security/src/index.js';
import {SettingsService,templates,type Actor} from '../../../packages/settings/src/index.js';
import {OnboardingService,type Session} from '../../../packages/onboarding/src/index.js';
import {rootPanel,settingsPanel,privacyPanel,questionPanel,confirmation,errorPanel,readinessPanel,activationPanel,activationPreviewPanel,billingPanel,lifecyclePanel,diagnosticsPanel,interventionsPanel,interventionPreviewPanel,experimentsPanel,experimentPreviewPanel,cohortsPanel,reportsPanel,overviewPanel,publishedPanel,successPanel,rolloutPreviewPanel,onboardingModePreviewPanel,onboardingNotConfiguredPanel,onboardingFlowPanel,editQuestionPanel,roleMappingPanel,sessionCompletePanel,activationReadinessPanel,resolveLocale,t,type Panel,type Issue,type ReadinessCheck} from '../../../packages/discord-panels/src/index.js';
import {enqueue} from '../../../packages/discord/src/outbox.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import {assert,DomainError,type Scope} from '../../../packages/shared/src/index.js';
import type {InteractionJob} from '../../interaction/src/server.js';
import {CapabilityService} from '../../../packages/lifecycle/src/capabilities.js';
import {AnalyticsService} from '../../../packages/analytics/src/index.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';
import {domainRevisions} from '../../../packages/settings/src/domain-config.js';
import {InterventionService} from '../../../packages/lifecycle/src/interventions.js';
import {ExperimentService,experimentSchema} from '../../../packages/lifecycle/src/experiments.js';
import {diagnose} from '../../../packages/analytics/src/diagnoses.js';
type DeleteData=(s:Scope,userId:string,actor:Actor,guild:boolean)=>Promise<void>;
export class InteractionWorker {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly tokens:Components,private readonly discord:DiscordPort,
 private readonly settings:SettingsService,private readonly onboarding:OnboardingService,private readonly deletion:DeleteData){}
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
   const locale=resolveLocale(language,{interactionLocale:input.locale,guildLocale:input.guildLocale}),reference=`NXS-${randomBytes(3).toString('hex').toUpperCase()}`;
   process.stderr.write(`[${reference}] ${error instanceof DomainError?error.code:error instanceof Error?error.name:'UNKNOWN_ERROR'}\n`);
   body=await errorPanel(issue,kind,locale,reference);
  }
  await this.db.transaction().execute(async tx=>{
   await enqueue(tx,s,`reply:${input.id}`,'REPLY_EDIT',{applicationId:input.applicationId,encryptedToken:this.vault.seal(s,input.token),body});
   await sql`UPDATE interaction_jobs SET state='SUCCEEDED',lease_until=NULL WHERE ${tenant(s)} AND id=${input.id}`.execute(tx);
  });return true;
 }
 async dispatch(s:Scope,input:InteractionJob):Promise<Panel>{
  const member=await this.discord.member(s.guildId,input.userId);const actorHash=this.vault.hash(s,input.userId);
  const actor:Actor={key:actorHash,permissions:member.permissions,roles:member.roles,source:'DISCORD_PANEL',requestId:input.id};
  const current=await this.settings.get(s);const admin=canAdmin(member.permissions,member.roles,current.adminRoleId);
  const locale=resolveLocale(current.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale});
  const publicLocale=resolveLocale(current.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale,publicPanel:true});
  const intent=input.customId?await this.tokens.read(this.db,s,input.customId,actorHash):{action:input.command};
  const action=String(intent.action??'');
  const issue:Issue=(data,publicEntry=false)=>this.tokens.issue(this.db,s,data,publicEntry?null:actorHash,publicEntry?31536000:900);
  const adminActions=['panel','setup','rolloutPreview','rolloutConfirm','modePreview','modeConfirm','lifecycle','activation','activationDraft','activationPublish','cohorts','diagnose','interventions','interventionDraft','interventionApprove','experiments','experimentDraft','configPublish','reports','billing','advanced','settings','status','flows','template','startChannel','uiLanguage','enabled','onboardingEnabled','mapOption','mapRole','editNode','editNodeOpen','editNodeSave','rollback','preview','deleteGuildConfirm','deleteGuild','overview','dashboard'];
  if(adminActions.includes(action))assert(admin,'ADMIN_REQUIRED',403);
  if(action==='setup'){
   const p=await new CapabilityService(this.db,this.discord).refresh(s,current.onboardingMode);
   return readinessPanel(issue,{communityEnabled:p.communityEnabled,nativeOnboardingAvailable:p.nativeOnboardingAvailable,nativeOnboardingEnabled:p.nativeOnboardingEnabled,membershipScreeningEnabled:p.membershipScreeningEnabled,recommendedMode:p.recommendedMode,configuredMode:current.onboardingMode},locale);
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
   await revisions.publish(s,actor,revision.id,z.uuid().nullable().parse(intent.expectedHead),z.string().parse(intent.hash));const names={activation:t(locale,'common.activation'),intervention:t(locale,'common.interventions'),experiment:t(locale,'common.experiments'),onboarding:t(locale,'settings.onboarding'),privacy:t(locale,'common.privacy'),cohort:t(locale,'root.cohorts')};return publishedPanel(issue,{name:names[revision.domain],version:revision.version},locale);
  }
  if(action==='billing'){const usage=await new EntitlementService(this.db).usage(s);return billingPanel(issue,usage,locale);}
  if(action==='lifecycle'){const metrics=await new AnalyticsService(this.db,this.settings).canonical(s);return lifecyclePanel(issue,metrics,locale);}
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
   const revisions=domainRevisions(this.db),id=await revisions.draft(s,actor,'intervention',{name:'Helper alert after 24h',trigger:'member.joined',delaySeconds:86400,conditions:[],actions:[{type:'staff_alert',channelId,text:'A newcomer may need help getting started.'}],cooldownSeconds:604800,safetyMode:'suggest',frequencyCaps:{dmPerDay:1,contactsPerWeek:3},massRoleOperation:false}),p=await revisions.preview(s,id);
   return interventionPreviewPanel(issue,{id,hash:p.confirmationHash,expectedHead:p.before?.id??null},locale);
  }
  if(action==='interventionApprove'){await new InterventionService(this.db).approve(s,actor,z.uuid().parse(input.values?.[0]));return successPanel(issue,t(locale,'success.intervention'),t(locale,'success.interventionDetail'),{label:t(locale,'common.interventions'),action:'interventions'},locale);}
  if(action==='experiments'){
   const revisions=domainRevisions(this.db),active=await revisions.current(s,'experiment');
   if(!active)return experimentsPanel(issue,null,locale);
   const definition=experimentSchema.parse(active.definition),result=await new ExperimentService(this.db).result(s,active.id);
   return experimentsPanel(issue,{name:definition.name,primaryMetric:definition.primaryMetric,minimumSample:definition.minimumSample,windowSeconds:definition.windowSeconds,result},locale);
  }
  if(action==='experimentDraft'){
   assert(await new EntitlementService(this.db).can(s,'experiments'),'ENTITLEMENT_REQUIRED');const revisions=domainRevisions(this.db),intervention=await revisions.current(s,'intervention');assert(intervention,'PUBLISH_INTERVENTION_FIRST');
   const id=await revisions.draft(s,actor,'experiment',{name:'Helper alert vs holdout',eligibility:[],randomization:'time_block',blockSeconds:86400,variants:[{key:'control',weight:50,interventionRevisionId:null},{key:'treatment',weight:50,interventionRevisionId:intervention.id}],primaryMetric:'activation',windowSeconds:604800,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}}),p=await revisions.preview(s,id);
   return experimentPreviewPanel(issue,{id,hash:p.confirmationHash,expectedHead:p.before?.id??null},locale);
  }
  if(action==='cohorts')return cohortsPanel(issue,locale);
  if(action==='reports')return reportsPanel(issue,locale);
  if(action==='advanced')return settingsPanel(issue,current,locale);
  if(action==='panel'){
   assert(input.channelId,'CHANNEL_REQUIRED');await this.discord.checkChannel(s.guildId,input.channelId);
   const analytics=new AnalyticsService(this.db,this.settings),now=Date.now(),day=86400000,metrics=await analytics.canonical(s),findings=diagnose(await analytics.canonical(s,new Date(now-15*day)),await analytics.canonical(s,new Date(now-30*day),new Date(now-15*day))),attention=findings.find(f=>f.type!=='DATA_COVERAGE_DROP')??findings[0];
   const diagnosisKeys:Record<string,Parameters<typeof t>[1]>={ACTIVATION_DROP:'diagnosis.activationDrop',TTFV_SPIKE:'diagnosis.ttfvSpike',CONNECTION_DROP:'diagnosis.connectionDrop',REPLY_LATENCY_SPIKE:'diagnosis.replyLatencySpike',ONBOARDING_DROP:'diagnosis.onboardingDrop',HOME_ACTION_DROP:'diagnosis.homeActionDrop',RETENTION_DROP:'diagnosis.retentionDrop',DATA_COVERAGE_DROP:'diagnosis.coverageDrop',ACTION_FAILURE_SPIKE:'diagnosis.actionFailureSpike'};
   const root=await rootPanel(issue,publicLocale,{activation:metrics.activation_rate,connection:metrics.direct_reply_connection_rate,retention:metrics.d7_active_retention,attention:attention?t(publicLocale,diagnosisKeys[attention.type]??'diagnosis.coverageDrop'):null,dashboardUrl:process.env.NEXUS_WEB_URL});await enqueue(this.db,s,`panel:${input.id}`,'PANEL_UPSERT',{channelId:input.channelId,body:root});
   return settingsPanel(issue,current,locale);
  }
  if(action==='settings')return settingsPanel(issue,current,locale);
  if(action==='template')await this.onboarding.chooseTemplate(s,actor,z.number().parse(intent.revision),z.enum(templates).parse(input.values?.[0]));
  else if(action==='startChannel'){
   const channel=z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]);await this.discord.checkChannel(s.guildId,channel);
   await this.settings.update(s,actor,z.number().parse(intent.revision),{startChannelId:channel});
  }else if(action==='uiLanguage')await this.settings.update(s,actor,z.number().parse(intent.revision),{uiLanguage:z.enum(['auto','ja','en','bilingual']).parse(input.values?.[0])});
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
   const checks:ReadinessCheck[]=[{label:t(locale,'health.startChannel'),status:current.startChannelId?'Ready':'Not configured'},{label:t(locale,'health.flow'),status:current.flowVersionId?'Ready':'Not configured'},{label:t(locale,'health.onboarding'),status:current.onboardingEnabled?'Ready':'Not configured'}];
   if(current.startChannelId){try{await this.discord.checkChannel(s.guildId,current.startChannelId);checks.push({label:t(locale,'health.botPermissions'),status:'Ready'});}catch{checks.push({label:t(locale,'health.botPermissions'),status:'Needs attention'});}}
   if(current.flowVersionId){const flow=await this.onboarding.flow(s,current.flowVersionId);checks.push({label:t(locale,'health.firstStep'),status:'Ready',detail:t(locale,'health.choices',{count:flow.nodes.find(n=>n.id===flow.start)!.options.length})});
    for(const role of new Set(flow.nodes.flatMap(n=>n.options.flatMap(o=>o.roleId?[o.roleId]:[])))){try{await this.discord.validateRole(s.guildId,role);checks.push({label:`${t(locale,'settings.roleMappings')} <@&${role}>`,status:'Ready'});}catch{checks.push({label:`${t(locale,'settings.roleMappings')} <@&${role}>`,status:'Needs attention'});}}
   }
   checks.push({label:t(locale,'health.activation'),status:current.startChannelId?'Ready':'Not configured',detail:t(locale,'health.activationDetail')});return activationReadinessPanel(issue,checks,locale);
  }else throw new DomainError('UNKNOWN_ACTION');
  const updated=await this.settings.get(s),updatedLocale=resolveLocale(updated.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale});return settingsPanel(issue,updated,updatedLocale);
 }
 private async sessionPanel(issue:Issue,session:Session,locale:ReturnType<typeof resolveLocale>){
  if(session.state.complete)return sessionCompletePanel(issue,locale);
  const node=session.definition.nodes.find(n=>n.id===session.state.nodeId)!;
  return questionPanel(issue,{sessionId:session.id,revision:session.revision,nodeId:node.id,question:node.question,options:node.options,context:session.context,type:node.type},locale);
 }
}

