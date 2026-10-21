import {createHash} from 'node:crypto';
import {sql,tenant,type Database,type Tx} from '../../../packages/db/src/index';
import {assert,isDomainError,type Scope} from '../../../packages/shared/src/index';
import {DiscordFailure,isDiscordWriteNotStartedError,type DiscordPort,type AutomationDiscordWrite,type CompiledLegacyMessage} from '../../../packages/discord/src/rest';
import type {IdentityVault} from '../../../packages/identity/src/index';
import {SettingsService,type Actor} from '../../../packages/settings/src/index';
import {ServerAuthorization} from '../../../packages/security/src/server-authorization';
import {operationsAccess} from '../../../packages/operations/src/policy';
import type {AutomationRuntimeAdapter,AutomationOperationContext} from '../../../packages/automation/src/runtime';
import {AutomationStore,fingerprint,verifyAutomationApproval,type RunRecord,type OperationOutcome,type AutomationApproval} from '../../../packages/automation/src/store';
import {assertValueCanPublish,escapeMarkdown,validateMessageSpec,buildDiscordMessage,AutomationMessageError} from '../../../packages/automation/src/message';
import {validateCompiledLegacyMessage} from '../../../packages/discord/src/automation-message';
import {assertValueMatchesType} from '../../../packages/automation/src/expression';
import {readAutomationTicketStatus} from '../../../packages/operations/src/automation-ticket';
import {ALPHA15_ADOPTED_ACTIONS} from '../../../packages/automation/src/admission';
import type {EvaluatedValue,TargetRef,FlowDefinition} from '../../../packages/automation/src/types';

const snowflake=/^\d{17,20}$/;
function reference(value:EvaluatedValue|undefined,type:string,guildId:string):TargetRef {
  assert(value?.type===type&&value.value!==null&&typeof value.value==='object'&&!Array.isArray(value.value),'AUTOMATION_TARGET_INVALID');
  const ref=value.value as Record<string,unknown>;
  assert(typeof ref.id==='string'&&snowflake.test(ref.id)&&ref.guildId===guildId,'AUTOMATION_TARGET_INVALID');
  return {id:ref.id,guildId};
}
function text(value:EvaluatedValue|undefined,maximum:number) {
  assert(value?.type==='PlainText'&&typeof value.value==='string'&&value.value.length>0&&value.value.length<=maximum,'AUTOMATION_TEXT_INVALID');
  return value.value;
}
function messageBody(inputs:Record<string,EvaluatedValue>,destination:TargetRef):{content?:string;messageSpec?:CompiledLegacyMessage}{
  assert(Boolean(inputs.content)!==Boolean(inputs.messageSpec),'AUTOMATION_MESSAGE_MODE');
  if(inputs.content){
    const content=text(inputs.content,2000);assertValueCanPublish(inputs.content,destination);
    const escaped=escapeMarkdown(content);assert(escaped.length<=2000,'AUTOMATION_TEXT_INVALID');return {content:escaped};
  }
  const value=inputs.messageSpec;assert(value?.type==='LegacyMessageSpec','AUTOMATION_MESSAGE_INVALID');
  assertValueCanPublish(value,destination);const spec=validateMessageSpec(value.value);
  assert(spec.kind==='legacy','AUTOMATION_MESSAGE_INVALID');
  return {messageSpec:validateCompiledLegacyMessage(buildDiscordMessage(spec))};
}

/** Read-only approval preview. The same native policy is rebuilt at dispatch;
 * only this digest is retained in the existing bounded approval record. */
export async function previewAlpha15RolePolicy(db:Database,discord:DiscordPort,vault:IdentityVault,s:Scope,run:RunRecord,approval:AutomationApproval,approver:Actor,tx:Tx=db) {
  assert(approval.operation==='discord.addRole'||approval.operation==='discord.removeRole','AUTOMATION_APPROVAL_OPERATION_INVALID');
  assert(approval.run_id===run.id&&approval.revision===run.revision&&approval.fingerprint===fingerprint(approval.inputs),'AUTOMATION_APPROVAL_CHANGED',409);
  assert(!run.ended_at&&!run.cancel_requested_at&&run.deadline_at>new Date(),'AUTOMATION_STOPPED',409);
  assert(discord.automationRolePreflight&&approver.encryptedUserId,'AUTOMATION_ROLE_POLICY_UNAVAILABLE',503);
  const role=reference(approval.inputs.role,'RoleRef',s.guildId),member=reference(approval.inputs.member,'MemberRef',s.guildId);
  const revision=(await sql<{definition:FlowDefinition;semantic_hash:string}>`SELECT definition,semantic_hash FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${run.flow_id} AND revision=${run.revision}`.execute(tx)).rows[0];
  assert(revision&&revision.semantic_hash===run.semantic_hash&&revision.definition.targets?.roleIds.includes(role.id),'AUTOMATION_TARGET_NOT_ALLOWED',403);
  const requesterId=vault.open(s,run.actor_ciphertext),approverId=vault.open(s,approver.encryptedUserId);
  assert(vault.hash(s,requesterId)===run.actor_hash&&vault.hash(s,approverId)===approver.key,'AUTOMATION_ACTOR_UNAVAILABLE',403);
  const authorization=new ServerAuthorization(discord,new SettingsService(tx),vault);
  const requester=await authorization.snapshot(s,requesterId,'WEB_DASHBOARD',run.id),currentApprover=await authorization.snapshot(s,approverId,'WEB_DASHBOARD',approval.id);
  assert(!requester.member.bot&&!currentApprover.member.bot&&requester.settings.enabled,'AUTOMATION_STOPPED',403);
  await operationsAccess(tx,s,requester.actor,'CONFIGURE');await operationsAccess(tx,s,currentApprover.actor,'GOVERN');
  const cfg=currentApprover.settings;
  const protectedRoleIds=[...new Set([cfg.adminRoleId,...cfg.managerRoleIds,...cfg.helperRoleIds,...cfg.staffRoleIds,cfg.helperRoleId].filter((id):id is string=>Boolean(id)))];
  const policy=await discord.automationRolePreflight({guildId:s.guildId,memberId:member.id,roleId:role.id,add:approval.operation==='discord.addRole',requesterId,approverId,protectedRoleIds});
  return {fingerprint:fingerprint({native:policy.fingerprint,revision:run.revision,semanticHash:run.semantic_hash,roleIds:revision.definition.targets?.roleIds}),changedChannelCount:policy.changedChannelCount};
}

/** A narrow connector: no caller-selected routes, implicit grants, or write retries.
 * The privacy lock spans dispatch, while identity, membership and Bot capabilities
 * are fetched again immediately before every confirmed rate-limit retry. */
export function createAlpha15DiscordAdapter(db:Database,discord:DiscordPort,vault:IdentityVault):AutomationRuntimeAdapter {
  const store=new AutomationStore(db);
  async function authorize(s:Scope,run:RunRecord,tx:Tx=db) {
    const current=await store.run(s,run.id,tx);
    assert(current&&!current.ended_at&&!current.cancel_requested_at&&current.deadline_at>new Date(),'AUTOMATION_STOPPED',409);
    assert(current.revision===run.revision&&current.semantic_hash===run.semantic_hash,'AUTOMATION_REVISION_CONFLICT',409);
    const flow=(await sql<{state:string}>`SELECT state FROM automation_flows WHERE ${tenant(s)} AND id=${run.flow_id}`.execute(tx)).rows[0];
    assert(flow?.state==='ACTIVE','AUTOMATION_FLOW_DISABLED',409);
    const userId=vault.open(s,current.actor_ciphertext);
    assert(vault.hash(s,userId)===current.actor_hash,'AUTOMATION_ACTOR_UNAVAILABLE',403);
    const snapshot=await new ServerAuthorization(discord,new SettingsService(tx),vault).snapshot(s,userId,'WEB_DASHBOARD',run.id);
    assert(!snapshot.member.bot,'ADMIN_REQUIRED',403);
    assert(snapshot.settings.enabled,'AUTOMATION_STOPPED',409);
    await operationsAccess(tx,s,snapshot.actor,'CONFIGURE');
    return {current,userId,snapshot};
  }
  return {
    async authorize(s,run){await db.transaction().execute(tx=>authorize(s,run,tx));},
    async authorizeAwait(tx,s,run,ticketId){
      const {userId,snapshot}=await authorize(s,run,tx);
      // Shared by CT05 registration/resume and cached CT11 read outcomes.
      // CT05 separately restricts correlation to structured intake references.
      const read=await readAutomationTicketStatus(tx,s,snapshot.actor,ticketId,async channelId=>Boolean(discord.canReadAttentionChannel&&await discord.canReadAttentionChannel(s.guildId,channelId,userId,snapshot.member)));
      return {allowedChannelIds:read.allowedChannelIds};
    },
    async execute(context:AutomationOperationContext):Promise<OperationOutcome> {
      let dispatched=false;
      try {
        assert(ALPHA15_ADOPTED_ACTIONS.has(context.operation),'AUTOMATION_OPERATION_UNAVAILABLE',503);
        return await db.transaction().execute(async tx=>{
          const s=context.scope,run=await store.run(s,context.runId,tx);
          assert(run,'AUTOMATION_RUN_NOT_FOUND',404);
          const {userId,snapshot}=await authorize(s,run,tx);
          // Fence this definition through dispatch without holding the host-wide
          // admission lock during Discord latency. Other schedules can proceed.
          const active=(await sql<{state:string}>`SELECT state FROM automation_flows WHERE ${tenant(s)} AND id=${run.flow_id} FOR SHARE`.execute(tx)).rows[0];
          assert(active?.state==='ACTIVE','AUTOMATION_FLOW_DISABLED',409);
          if(context.operation==='nexus.readTicket'){
            const value=context.inputs.ticket;
            assert(value?.type==='TicketRef'&&value.value!==null&&typeof value.value==='object'&&!Array.isArray(value.value),'AUTOMATION_TICKET_INVALID');
            const ref=value.value as Record<string,unknown>;
            assert(typeof ref.id==='string'&&ref.guildId===s.guildId&&Object.keys(ref).every(key=>['id','guildId'].includes(key)),'AUTOMATION_TICKET_INVALID');
            const read=await readAutomationTicketStatus(tx,s,snapshot.actor,ref.id,async channelId=>Boolean(discord.canReadAttentionChannel&&await discord.canReadAttentionChannel(s.guildId,channelId,userId,snapshot.member)));
            const type={kind:'Record' as const,schemaId:'nexus.ticket.status.v1'};
            assertValueMatchesType(type,read.status,{guildId:s.guildId});
            return {state:'SUCCEEDED',value:{type,value:read.status,provenance:[...value.provenance,{source:'service',guildId:s.guildId,allowedChannelIds:read.allowedChannelIds,resumable:true}]}};
          }
          assert(discord.automationWrite&&discord.automationPreflight,'AUTOMATION_CONNECTOR_UNAVAILABLE',503);
          let write:AutomationDiscordWrite,resultType:'MessageRef'|'ChannelRef'|'ThreadRef'|undefined;
          let destination:TargetRef|undefined;
          switch(context.operation){
            case 'discord.sendMessage': {
              const channel=reference(context.inputs.channel,'ChannelRef',s.guildId);
              assert(context.targets.channelIds.includes(channel.id),'AUTOMATION_TARGET_NOT_ALLOWED',403);
              write={kind:'message',guildId:s.guildId,channelId:channel.id,...messageBody(context.inputs,channel),nonce:createHash('sha256').update(context.runId+':'+context.identity).digest('hex').slice(0,25)};
              resultType='MessageRef';destination=channel;break;
            }
            case 'discord.editOwnMessage':{
              const message=reference(context.inputs.message,'MessageRef',s.guildId);
              const owned=(await sql<{result:EvaluatedValue}>`SELECT result FROM automation_operations WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND operation='discord.sendMessage' AND state='SUCCEEDED' AND result->>'type'='MessageRef' AND result->'value'->>'id'=${message.id} AND result->'value'->>'guildId'=${s.guildId} LIMIT 2`.execute(tx)).rows;
              assert(owned.length===1,'AUTOMATION_MESSAGE_NOT_OWNED',403);
              const channels=owned[0]!.result.provenance.filter(source=>source.source==='service'&&source.guildId===s.guildId).flatMap(source=>source.allowedChannelIds??[]);
              assert(channels.length===1&&snowflake.test(channels[0]!)&&context.targets.channelIds.includes(channels[0]!), 'AUTOMATION_MESSAGE_NOT_OWNED',403);
              const fixed=(await sql<{definition:FlowDefinition;semantic_hash:string}>`SELECT definition,semantic_hash FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${run.flow_id} AND revision=${run.revision}`.execute(tx)).rows[0];
              assert(fixed?.semantic_hash===run.semantic_hash&&fixed.definition.targets?.channelIds.includes(channels[0]!),'AUTOMATION_TARGET_NOT_ALLOWED',403);
              destination={id:channels[0]!,guildId:s.guildId};
              write={kind:'editMessage',guildId:s.guildId,channelId:destination.id,messageId:message.id,...messageBody(context.inputs,destination)};resultType='MessageRef';break;
            }
            case 'discord.createChannel': {
              const parent=reference(context.inputs.parent,'ChannelRef',s.guildId),name=text(context.inputs.name,100).trim();
              assert(name.length>0&&context.targets.parentCategoryIds.includes(parent.id),'AUTOMATION_TARGET_NOT_ALLOWED',403);
              assertValueCanPublish(context.inputs.name!,parent);
              write={kind:'channel',guildId:s.guildId,parentId:parent.id,name};resultType='ChannelRef';destination=parent;break;
            }
            case 'discord.createThread': {
              const channel=reference(context.inputs.channel,'ChannelRef',s.guildId),name=text(context.inputs.name,100).trim();
              assert(name.length>0&&context.targets.channelIds.includes(channel.id),'AUTOMATION_TARGET_NOT_ALLOWED',403);
              assertValueCanPublish(context.inputs.name!,channel);
              write={kind:'thread',guildId:s.guildId,channelId:channel.id,name};resultType='ThreadRef';destination=channel;break;
            }
            case 'discord.addRole':case 'discord.removeRole': {
              const role=reference(context.inputs.role,'RoleRef',s.guildId),member=reference(context.inputs.member,'MemberRef',s.guildId);
              assert(context.targets.roleIds.includes(role.id),'AUTOMATION_TARGET_NOT_ALLOWED',403);
              assert(discord.automationRolePreflight,'AUTOMATION_CONNECTOR_UNAVAILABLE',503);
              const fixed=(await sql<{definition:FlowDefinition;semantic_hash:string}>`SELECT definition,semantic_hash FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${run.flow_id} AND revision=${run.revision}`.execute(tx)).rows[0];
              assert(fixed?.semantic_hash===run.semantic_hash&&fixed.definition.targets?.roleIds.includes(role.id)&&fingerprint(fixed.definition.targets)===fingerprint(context.targets),'AUTOMATION_TARGET_NOT_ALLOWED',403);
              // Reuse durable operation evidence for a guild-wide burst cap;
              // no member/role/content log or additional retention is created.
              await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'alpha15-role-dispatch:'+s.organizationId+':'+s.guildId},0))`.execute(tx);
              const recent=(await sql<{count:number}>`SELECT count(*)::integer AS count FROM automation_operations WHERE ${tenant(s)} AND operation IN ('discord.addRole','discord.removeRole') AND started_at>now()-interval '1 minute'`.execute(tx)).rows[0]!.count;
              assert(recent<=5,'AUTOMATION_ROLE_BURST_LIMIT',429);
              const own=(await sql`SELECT identity FROM automation_operations WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND identity=${context.identity} AND state='STARTED' AND fingerprint=${fingerprint(context.inputs)}`.execute(tx)).rows[0];
              assert(own,'AUTOMATION_OPERATION_NOT_STARTED',409);
              write={kind:'role',guildId:s.guildId,memberId:member.id,roleId:role.id,add:context.operation==='discord.addRole'};break;
            }
            default:return {state:'NOT_STARTED',code:'AUTOMATION_OPERATION_UNAVAILABLE'};
          }
          const beforeDispatch=async()=>{
            // This callback repeats only after a confirmed 429 rejection.
            dispatched=false;
            assert(ALPHA15_ADOPTED_ACTIONS.has(context.operation),'AUTOMATION_OPERATION_UNAVAILABLE',503);
            await authorize(s,run,tx);
            if(write.kind==='role'){
              const receipt=await verifyAutomationApproval(tx,s,run.id,context.identity,fingerprint(context.inputs));
              assert(receipt.operation===context.operation&&receipt.id===context.approval?.id,'AUTOMATION_APPROVAL_REQUIRED',403);
              const policy=await previewAlpha15RolePolicy(db,discord,vault,s,run,receipt,{key:receipt.approver_hash!,encryptedUserId:receipt.approver_ciphertext!,permissions:'0',roles:[],source:'WEB_DASHBOARD',requestId:receipt.id},tx);
              assert(receipt.policy_fingerprint&&receipt.policy_fingerprint===policy.fingerprint,'AUTOMATION_APPROVAL_POLICY_CHANGED',409);
            }else await discord.automationPreflight!(s.guildId,userId,write.kind==='editMessage'?'message':write.kind,write.kind==='channel'?write.parentId:write.channelId);
            // Recheck cancellation/deadline after network preflight as well.
            const current=await store.run(s,run.id,tx);
            assert(current&&!current.ended_at&&!current.cancel_requested_at&&current.deadline_at>new Date(),'AUTOMATION_STOPPED',409);
            const flow=(await sql<{state:string}>`SELECT state FROM automation_flows WHERE ${tenant(s)} AND id=${run.flow_id}`.execute(tx)).rows[0];
            assert(flow?.state==='ACTIVE','AUTOMATION_FLOW_DISABLED',409);
            dispatched=true;
          };
          const id=await discord.automationWrite!(write,beforeDispatch);
          if(resultType){assert(id&&snowflake.test(id),'AUTOMATION_RESULT_UNKNOWN',503);return {state:'SUCCEEDED',value:{type:resultType,value:{id,guildId:s.guildId},provenance:[{source:'service',guildId:s.guildId,...(destination?{allowedChannelIds:[resultType==='ChannelRef'||resultType==='ThreadRef'?id:destination.id]}:{})}]}};}
          return {state:'SUCCEEDED'};
        });
      }catch(error){
        if(isDiscordWriteNotStartedError(error))return {state:'NOT_STARTED',code:error.code};
        if(!dispatched)return {state:'NOT_STARTED',code:isDomainError(error)?error.code:error instanceof AutomationMessageError?'AUTOMATION_'+error.code:'AUTOMATION_PREFLIGHT_UNAVAILABLE'};
        if(error instanceof DiscordFailure&&error.kind==='http'&&[400,401,403,404,405,413,429].includes(error.status))return {state:'FAILED',code:'AUTOMATION_DISCORD_REJECTED'};
        return {state:'UNKNOWN',code:'AUTOMATION_RESULT_UNKNOWN'};
      }
    },
  };
}
