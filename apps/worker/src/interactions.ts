import {ComponentType,ButtonStyle} from 'discord-api-types/v10';
import {z} from 'zod';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {Components,canAdmin} from '../../../packages/security/src/index.js';
import {SettingsService,templates,type Actor} from '../../../packages/settings/src/index.js';
import {OnboardingService,type Session} from '../../../packages/onboarding/src/index.js';
import {rootPanel,settingsPanel,privacyPanel,questionPanel,panel,confirmation,type Panel,type Issue} from '../../../packages/discord-panels/src/index.js';
import {enqueue} from '../../../packages/discord/src/outbox.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import {assert,DomainError,type Scope} from '../../../packages/shared/src/index.js';
import type {InteractionJob} from '../../interaction/src/server.js';
import {CapabilityService} from '../../../packages/lifecycle/src/capabilities.js';
import {AnalyticsService} from '../../../packages/analytics/src/index.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';
import {domainRevisions} from '../../../packages/settings/src/domain-config.js';
import {InterventionService} from '../../../packages/lifecycle/src/interventions.js';
import {ExperimentService} from '../../../packages/lifecycle/src/experiments.js';
import {diagnose} from '../../../packages/analytics/src/diagnoses.js';
type Overview=(s:Scope)=>Promise<string>;
type DeleteData=(s:Scope,userId:string,actor:Actor,guild:boolean)=>Promise<void>;
export class InteractionWorker {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly tokens:Components,private readonly discord:DiscordPort,
 private readonly settings:SettingsService,private readonly onboarding:OnboardingService,private readonly overview:Overview,private readonly deletion:DeleteData){}
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
   const message=error instanceof DomainError?error.code==='REVISION_CONFLICT'?'Someone changed this setting while you were editing. Use /nexus panel to reload.':error.code:'Discord or storage is unavailable. Retry from the panel.';
   body=panel('Unable to complete this action',message);
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
  const intent=input.customId?await this.tokens.read(this.db,s,input.customId,actorHash):{action:input.command};
  const action=String(intent.action??'');
  const issue:Issue=(data,publicEntry=false)=>this.tokens.issue(this.db,s,data,publicEntry?null:actorHash,publicEntry?31536000:900);
  const adminActions=['panel','setup','rolloutPreview','rolloutConfirm','modePreview','modeConfirm','lifecycle','activation','activationDraft','activationPublish','cohorts','diagnose','interventions','interventionDraft','interventionApprove','experiments','experimentDraft','configPublish','reports','billing','advanced','settings','status','flows','template','startChannel','enabled','onboardingEnabled','mapOption','mapRole','editNode','editNodeOpen','editNodeSave','rollback','preview','deleteGuildConfirm','deleteGuild','overview'];
  if(adminActions.includes(action))assert(admin,'ADMIN_REQUIRED',403);
  const button=async(label:string,data:Record<string,unknown>)=>({type:ComponentType.ActionRow as const,components:[{type:ComponentType.Button as const,style:ButtonStyle.Primary as const,label,custom_id:await issue(data)}]});
  if(action==='setup'){
   const p=await new CapabilityService(this.db,this.discord).refresh(s,current.onboardingMode);
   return panel('Native Readiness',`Community: ${p.communityEnabled}\nNative Onboarding: ${p.nativeOnboardingAvailable?p.nativeOnboardingEnabled?'enabled':'disabled':'unavailable'}\nRules Screening: ${p.membershipScreeningEnabled}\nServer Guide configuration: unavailable (member flags measured separately)\nRecommended mode: ${p.recommendedMode}\nConfigured mode: ${current.onboardingMode}\nNo Discord configuration is modified.`,[
    {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'modePreview'}),placeholder:'Choose onboarding mode',options:['auto','native','fallback','hybrid'].map(value=>({label:value,value}))}]},
    await button('Preview v0.2 rollout',{action:'rolloutPreview'})
   ]);
  }
  if(action==='rolloutPreview')return panel('Preview v0.2 rollout','Enable Native capability reads, Native checkpoints, Activation DSL, Interventions and Experiments. Published definitions and plan entitlements are still required. Existing fallback mode is preserved.',[await button('Confirm rollout',{action:'rolloutConfirm',revision:current.revision})]);
  if(action==='rolloutConfirm'){
   await this.settings.update(s,actor,z.number().parse(intent.revision),{flags:{...current.flags,native_capability_v2:true,native_snapshot_v2:true,activation_dsl_v2:true,interventions_v2:true,experiments_v2:true}});
   return panel('Rollout enabled','Define Activation before observing new cohorts. Existing cohorts retain their definition. Use /nexus setup to revalidate Native capabilities.');
  }
  if(action==='modePreview'){
   const mode=z.enum(['auto','native','fallback','hybrid']).parse(input.values?.[0]);
   const revisions=domainRevisions(this.db),id=await revisions.draft(s,actor,'onboarding',{onboardingMode:mode,hybrid:current.hybrid}),preview=await revisions.preview(s,id);
   return panel('Preview onboarding mode',`Change NEXUS mode from ${current.onboardingMode} to ${mode}. Native Discord configuration will not change. Hybrid needs an explicitly configured additional flow.`,[await button('Publish mode',{action:'configPublish',id,hash:preview.confirmationHash,expectedHead:preview.before?.id??null})]);
  }
  if(action==='activation')return panel('Define Activation','Choose an observable first-value signal. The published rule applies to future joining members; historical cohorts keep their version.',[
   {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'activationDraft'}),placeholder:'Activation signal within 7 days',options:[{label:'Receive a direct reply',value:'reply.received'},{label:'Subscribe to a scheduled event',value:'scheduled_event.subscribed'},{label:'Send a message',value:'message.sent'}]}]}
  ]);
  if(action==='activationDraft'){
   const signal=z.enum(['reply.received','scheduled_event.subscribed','message.sent']).parse(input.values?.[0]),revisions=domainRevisions(this.db);
   assert(await new EntitlementService(this.db).canDefineActivation(s,{windowSeconds:604800,rule:{op:'event',event:signal,withinSeconds:604800}}),'ENTITLEMENT_REQUIRED');
   const id=await revisions.draft(s,actor,'activation',{name:`${signal} within 7d`,windowSeconds:604800,rule:{op:'event',event:signal,withinSeconds:604800}}),preview=await revisions.preview(s,id);
   return panel('Preview Activation',`${signal} within 7 days after joining. Publication creates an immutable version.`,[await button('Publish Activation',{action:'configPublish',id,hash:preview.confirmationHash,expectedHead:preview.before?.id??null})]);
  }
  if(action==='configPublish'){
   const revisions=domainRevisions(this.db),revision=await revisions.get(s,z.uuid().parse(intent.id));
   const feature=revision.domain==='activation'?'custom_activation':revision.domain==='intervention'?'interventions':revision.domain==='experiment'?'experiments':null;
   if(feature)assert(feature==='custom_activation'?await new EntitlementService(this.db).canDefineActivation(s,revision.definition):await new EntitlementService(this.db).can(s,feature),'ENTITLEMENT_REQUIRED');
   await revisions.publish(s,actor,revision.id,z.uuid().nullable().parse(intent.expectedHead),z.string().parse(intent.hash));return panel('Configuration published',`${revision.domain} version ${revision.version} is active. Previous versions remain available for rollback.`);
  }
  if(action==='billing'){const usage=await new EntitlementService(this.db).usage(s);return panel('Plan and usage',`${usage.plan}\nMonthly Tracked Members: ${usage.used} / ${usage.included??'custom'}\nSoft limit: ${usage.softLimit??'custom'}\nProjected: ${usage.projected}\nNo automatic overage charges. Checkout is not configured.`);}
  if(action==='lifecycle'){const m=await new AnalyticsService(this.db,this.settings).canonical(s);return panel('Observable Lifecycle',Object.values(m).map(v=>`${v.metricKey} v${v.metricVersion}: ${v.value===null?'Unavailable':v.value.toFixed(3)} · n=${v.sampleSize} · ${v.dataCoverage.status}${v.provisional?' · provisional':''}`).join('\n'));}
  if(action==='diagnose'){
   const analytics=new AnalyticsService(this.db,this.settings),now=Date.now(),day=86400000;
   const findings=diagnose(await analytics.canonical(s,new Date(now-15*day)),await analytics.canonical(s,new Date(now-30*day),new Date(now-15*day)));
   return panel('Diagnoses',findings.length?findings.map(d=>`${d.type} · ${d.confidenceLabel}\nCausality: not established`).join('\n'):'No diagnosis has enough comparable evidence. Missing data is not treated as zero.');
  }
  if(action==='interventions'){
   const runs=(await sql<{id:string,state:string}>`SELECT id,state FROM intervention_runs WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 10`.execute(this.db)).rows;
   const rows=[];if(runs.some(r=>r.state==='suggested'||r.state==='approval'))rows.push({type:ComponentType.ActionRow as const,components:[{type:ComponentType.StringSelect as const,custom_id:await issue({action:'interventionApprove'}),placeholder:'Approve a proposed intervention',options:runs.filter(r=>r.state==='suggested'||r.state==='approval').map(r=>({label:`${r.state} ${r.id.slice(0,8)}`,value:r.id}))}]});
   rows.push({type:ComponentType.ActionRow as const,components:[{type:ComponentType.ChannelSelect as const,custom_id:await issue({action:'interventionDraft'}),placeholder:'Staff alert channel (24h after join)',channel_types:[0],min_values:1,max_values:1}]});
   return panel('Intervention Studio',`${runs.map(r=>`${r.id.slice(0,8)}: ${r.state}`).join('\n')||'No proposed interventions.'}\nNew rules default to Suggest.`,rows);
  }
  if(action==='interventionDraft'){
   assert(await new EntitlementService(this.db).can(s,'interventions'),'ENTITLEMENT_REQUIRED');const channelId=z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]);await this.discord.checkChannel(s.guildId,channelId);
   const revisions=domainRevisions(this.db),id=await revisions.draft(s,actor,'intervention',{name:'Helper alert after 24h',trigger:'member.joined',delaySeconds:86400,conditions:[],actions:[{type:'staff_alert',channelId,text:'A newcomer may need help getting started.'}],cooldownSeconds:604800,safetyMode:'suggest',frequencyCaps:{dmPerDay:1,contactsPerWeek:3},massRoleOperation:false}),p=await revisions.preview(s,id);
   return panel('Preview staff alert','24 hours after join → propose staff alert. Suggest mode sends nothing until approved.',[await button('Publish intervention',{action:'configPublish',id,hash:p.confirmationHash,expectedHead:p.before?.id??null})]);
  }
  if(action==='interventionApprove'){await new InterventionService(this.db).approve(s,actor,z.uuid().parse(input.values?.[0]));return panel('Intervention approved','Delivery is queued. Eligibility and hard safety limits will be checked again.');}
  if(action==='experiments'){
   const revisions=domainRevisions(this.db),active=await revisions.current(s,'experiment');
   return panel('Experiments',active?JSON.stringify(await new ExperimentService(this.db).result(s,active.id),null,2):'No experiment. Choose a published intervention to compare against a no-action holdout.',[await button('Create helper alert holdout',{action:'experimentDraft'})]);
  }
  if(action==='experimentDraft'){
   assert(await new EntitlementService(this.db).can(s,'experiments'),'ENTITLEMENT_REQUIRED');const revisions=domainRevisions(this.db),intervention=await revisions.current(s,'intervention');assert(intervention,'PUBLISH_INTERVENTION_FIRST');
   const id=await revisions.draft(s,actor,'experiment',{name:'Helper alert vs holdout',eligibility:[],randomization:'time_block',blockSeconds:86400,variants:[{key:'control',weight:50,interventionRevisionId:null},{key:'treatment',weight:50,interventionRevisionId:intervention.id}],primaryMetric:'activation',windowSeconds:604800,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}}),p=await revisions.preview(s,id);
   return panel('Preview experiment','Daily time-block assignment; Control receives no action. Treatment uses the published intervention and its safety mode. Primary: activation within 7 days after assignment. Block-level evidence requires at least 20 mature blocks per arm. Cross-block spillover remains a limitation.',[await button('Publish experiment',{action:'configPublish',id,hash:p.confirmationHash,expectedHead:p.before?.id??null})]);
  }
  if(action==='cohorts')return panel('Cohorts','Metrics use membership episodes and mature observation windows. Advanced cohort editing is not enabled in this rollout.');
  if(action==='reports')return panel('Reports','Use Overview and Lifecycle for current metrics. Scheduled reports are P1 and are not enabled.');
  if(action==='advanced')return settingsPanel(issue,current);
  if(action==='panel'){
   assert(input.channelId,'CHANNEL_REQUIRED');await this.discord.checkChannel(s.guildId,input.channelId);
   const root=await rootPanel(issue);await enqueue(this.db,s,`panel:${input.id}`,'PANEL_UPSERT',{channelId:input.channelId,body:root});
   return settingsPanel(issue,current);
  }
  if(action==='settings')return settingsPanel(issue,current);
  if(action==='template')await this.onboarding.chooseTemplate(s,actor,z.number().parse(intent.revision),z.enum(templates).parse(input.values?.[0]));
  else if(action==='startChannel'){
   const channel=z.string().regex(/^\d{17,20}$/).parse(input.values?.[0]);await this.discord.checkChannel(s.guildId,channel);
   await this.settings.update(s,actor,z.number().parse(intent.revision),{startChannelId:channel});
  }else if(action==='enabled'||action==='onboardingEnabled')await this.settings.update(s,actor,z.number().parse(intent.revision),{[action]:z.boolean().parse(intent.value)});
  else if(action==='flows'){
   if(!current.flowVersionId)return panel('Onboarding','Choose a community template in Settings first.');
   const flow=await this.onboarding.flow(s,current.flowVersionId);
   const versions=(await sql<{id:string,version:number}>`SELECT id,version FROM flow_versions WHERE ${tenant(s)} ORDER BY version DESC LIMIT 25`.execute(this.db)).rows;
   return panel('Onboarding Flow','Published versions are immutable. Mapping a role or rolling back creates a new version. Existing sessions keep their version.',[
    {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'mapOption',revision:current.revision}),placeholder:'Choose an answer to map a role',options:flow.nodes.flatMap(n=>n.options.map(o=>({label:`${n.id}: ${o.label}`.slice(0,100),value:`${n.id}:${o.id}`}))).slice(0,25)}]},
    {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'rollback',revision:current.revision}),placeholder:'Publish a copy of an earlier version',options:versions.map(v=>({label:`Version ${v.version}`,value:v.id}))}]},
    {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'editNode',revision:current.revision}),placeholder:'Edit a question and its options',options:flow.nodes.map(n=>({label:n.question.slice(0,100),value:n.id}))}]}
   ]);
  }else if(action==='editNode'){
   assert(current.flowVersionId,'FLOW_NOT_CONFIGURED');assert(intent.revision===current.revision,'REVISION_CONFLICT',409);
   const flow=await this.onboarding.flow(s,current.flowVersionId);const node=flow.nodes.find(n=>n.id===input.values?.[0]);assert(node,'INVALID_NODE');
   return panel('Edit question','Changes publish a new version. Existing sessions keep their version.',[
    {type:ComponentType.ActionRow,components:[{type:ComponentType.Button,style:ButtonStyle.Primary,label:'Open editor',custom_id:await issue({action:'editNodeOpen',revision:current.revision,nodeId:node.id,question:node.question,options:node.options.map(o=>`${o.id} | ${o.label} | ${o.next??'end'}`).join('\n')})}]}
   ]);
  }else if(action==='editNodeSave'){
   assert(current.flowVersionId,'FLOW_NOT_CONFIGURED');const flow=await this.onboarding.flow(s,current.flowVersionId);const node=flow.nodes.find(n=>n.id===intent.nodeId);assert(node,'INVALID_NODE');
   node.question=z.string().min(1).max(500).parse(input.fields?.question);
   node.options=z.string().parse(input.fields?.options).split('\n').filter(Boolean).map(line=>{
    const parts=line.split('|').map(v=>v.trim());assert(parts.length===3,'INVALID_OPTION_FORMAT');
    const [id,label,next]=parts;return {...node.options.find(o=>o.id===id),id:id!,label:label!,next:next==='end'?null:next!};
   });await this.onboarding.publish(s,actor,z.number().parse(intent.revision),flow);
  }else if(action==='mapOption'){
   const option=z.string().parse(input.values?.[0]);assert(intent.revision===current.revision,'REVISION_CONFLICT',409);
   return panel('Managed Role Mapping','Choose a community role below the bot. Privileged roles cannot be mapped.',[
    {type:ComponentType.ActionRow,components:[{type:ComponentType.RoleSelect,custom_id:await issue({action:'mapRole',revision:current.revision,option}),min_values:0,max_values:1}]}
   ]);
  }else if(action==='mapRole'){
   assert(current.flowVersionId,'FLOW_NOT_CONFIGURED');const flow=await this.onboarding.flow(s,current.flowVersionId);
   const [nodeId,optionId]=String(intent.option).split(':');const option=flow.nodes.find(n=>n.id===nodeId)?.options.find(o=>o.id===optionId);assert(option,'INVALID_OPTION');
   const roleId=input.values?.[0];if(roleId){await this.discord.validateRole(s.guildId,roleId);option.roleId=roleId;}else delete option.roleId;
   await this.onboarding.publish(s,actor,z.number().parse(intent.revision),flow);
  }else if(action==='rollback')await this.onboarding.rollback(s,actor,z.number().parse(intent.revision),z.uuid().parse(input.values?.[0]));
  else if(action==='personalize'||action==='restart'||action==='preview'){
   const session=await this.onboarding.start(s,input.userId,new Date(member.joinedAt),action==='preview'?'PREVIEW':'PRODUCTION',action==='restart'||action==='preview');
   return this.sessionPanel(issue,session);
  }else if(action==='answer'){
   const session=await this.onboarding.answer(s,input.userId,z.uuid().parse(intent.sessionId),z.number().parse(intent.revision),z.string().parse(intent.nodeId),z.array(z.string()).min(1).parse(input.values));
   return this.sessionPanel(issue,session);
  }else if(action==='privacy')return privacyPanel(issue,admin);
  else if(action==='deleteMemberConfirm'||action==='deleteGuildConfirm')return confirmation(issue,action==='deleteGuildConfirm'?'deleteGuild':'deleteMember');
  else if(action==='deleteMember'||action==='deleteGuild'){
   assert(input.customId,'CONFIRMATION_REQUIRED');await this.deletion(s,input.userId,actor,action==='deleteGuild');return panel('Data deletion','NEXUS data deletion completed. Discord roles were left in place.');
  }else if(action==='overview')return panel('Community Overview',await this.overview(s));
  else if(action==='status'){
   const statuses=[`Start channel: ${current.startChannelId?'READY':'NOT CONFIGURED'}`,`Flow: ${current.flowVersionId?'READY':'NOT CONFIGURED'}`,`Onboarding: ${current.onboardingEnabled?'READY':'NOT CONFIGURED'}`];
   if(current.startChannelId){try{await this.discord.checkChannel(s.guildId,current.startChannelId);statuses.push('Bot channel permissions: READY');}catch{statuses.push('Bot channel permissions: NEEDS ATTENTION');}}
   if(current.flowVersionId){const flow=await this.onboarding.flow(s,current.flowVersionId);statuses.push(`First-step choices: ${flow.nodes.find(n=>n.id===flow.start)!.options.length}`);
    for(const role of new Set(flow.nodes.flatMap(n=>n.options.flatMap(o=>o.roleId?[o.roleId]:[])))){try{await this.discord.validateRole(s.guildId,role);statuses.push(`Role <@&${role}>: READY`);}catch{statuses.push(`Role <@&${role}>: NEEDS ATTENTION`);}}
   }
   statuses.push('Activation: first message in the configured start channel','Helpers / Reports: NOT CONFIGURED (outside this slice)','Privacy: metadata only · SUGGEST');return panel('Activation Readiness',statuses.join('\n'));
  }else throw new DomainError('UNKNOWN_ACTION');
  return settingsPanel(issue,await this.settings.get(s));
 }
 private async sessionPanel(issue:Issue,session:Session){
  if(session.state.complete)return panel('Your Community Setup','Preferences saved. Role changes are queued. You can update your preferences at any time.',[
   {type:ComponentType.ActionRow,components:[{type:ComponentType.Button,style:ButtonStyle.Primary,label:'Update Preferences / Restart Setup',custom_id:await issue({action:'restart'})},{type:ComponentType.Button,style:ButtonStyle.Secondary,label:'Privacy',custom_id:await issue({action:'privacy'})}]}
  ]);
  const node=session.definition.nodes.find(n=>n.id===session.state.nodeId)!;
  return questionPanel(issue,{sessionId:session.id,revision:session.revision,nodeId:node.id,question:node.question,options:node.options,context:session.context,type:node.type});
 }
}

