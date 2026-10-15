import { createHash } from 'node:crypto';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import { assert } from '../../shared/src/index';
import type { Member, Role } from './rest';

export interface AutomationRolePolicyInput {
  guildId:string;memberId:string;roleId:string;add:boolean;
  requesterId:string;approverId:string;protectedRoleIds:string[];
}
export interface AutomationRolePolicy {fingerprint:string;changedChannelCount:number;}
export interface RolePolicyChannel {
  id:string;guild_id?:string;type:number;flags?:number;
  permission_overwrites:{id:string;type:number;allow:string;deny:string}[];
}
// Explicit ordinary capabilities. Unknown and administrative permission bits
// require a later reviewed profile; they cannot sneak in through a new API bit.
export const ORDINARY_ROLE_PERMISSIONS=P.ViewChannel|P.SendMessages|P.SendTTSMessages|
  P.EmbedLinks|P.AttachFiles|P.ReadMessageHistory|P.AddReactions|P.UseExternalEmojis|
  P.Connect|P.Speak|P.Stream|P.UseVAD|P.UseApplicationCommands|P.RequestToSpeak|
  P.CreatePublicThreads|P.CreatePrivateThreads|P.UseExternalStickers|P.SendMessagesInThreads|
  P.UseEmbeddedActivities|P.UseSoundboard|P.UseExternalSounds|P.SendVoiceMessages|P.SendPolls;
const allKnown=Object.values(P).reduce((bits,value)=>bits|value,0n);
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
const bits=(value:string)=>{assert(/^\d+$/.test(value),'AUTOMATION_PERMISSIONS_UNVERIFIED',503);return BigInt(value);};
function native(member:Member,required:bigint){const value=bits(member.permissions);return (value&P.Administrator)!==0n||(value&required)===required;}
function highest(member:Member,roles:Role[]){return Math.max(0,...roles.filter(role=>member.roles.includes(role.id)).map(role=>role.position));}
function base(member:Member,roles:Role[],guildId:string){
  assert(roles.some(role=>role.id===guildId)&&member.roles.every(id=>roles.some(role=>role.id===id)),'AUTOMATION_PERMISSIONS_UNVERIFIED',503);
  return roles.filter(role=>role.id===guildId||member.roles.includes(role.id)).reduce((value,role)=>value|bits(role.permissions),0n);
}
function effective(member:Member,userId:string,roles:Role[],guildId:string,channel:RolePolicyChannel){
  let value=base(member,roles,guildId);
  if(member.ownerId===userId||(value&P.Administrator)!==0n)return allKnown;
  const everyone=channel.permission_overwrites.find(overwrite=>overwrite.type===0&&overwrite.id===guildId);
  if(everyone)value=(value&~bits(everyone.deny))|bits(everyone.allow);
  let allow=0n,deny=0n;
  for(const overwrite of channel.permission_overwrites)if(overwrite.type===0&&member.roles.includes(overwrite.id)){allow|=bits(overwrite.allow);deny|=bits(overwrite.deny);}
  value=(value&~deny)|allow;
  const personal=channel.permission_overwrites.find(overwrite=>overwrite.type===1&&overwrite.id===userId);
  if(personal)value=(value&~bits(personal.deny))|bits(personal.allow);
  // VIEW_CHANNEL is an implicit prerequisite. Restoring it must not activate
  // administrative capabilities hidden behind a previous view denial.
  return (value&P.ViewChannel)!==0n?value:0n;
}

export function evaluateAutomationRolePolicy(input:AutomationRolePolicyInput,botId:string,roles:Role[],members:{requester:Member;approver:Member;target:Member;bot:Member},channels:RolePolicyChannel[]):AutomationRolePolicy {
  const role=roles.find(item=>item.id===input.roleId),{requester,approver,target,bot}=members;
  assert(role&&role.id!==input.guildId&&!role.managed&&(!role.tags||Object.keys(role.tags).length===0),'ROLE_NOT_MANAGEABLE',403);
  assert(!input.protectedRoleIds.includes(role.id),'AUTOMATION_ROLE_PROTECTED',403);
  assert((bits(role.permissions)&~ORDINARY_ROLE_PERMISSIONS)===0n,'PRIVILEGED_ROLE_MAPPING_FORBIDDEN',403);
  assert(!target.bot&&target.ownerId!==input.memberId&&!target.pending,'AUTOMATION_ROLE_TARGET',403);
  assert(!requester.bot&&!approver.bot&&!requester.pending&&!approver.pending&&native(requester,P.ManageRoles)&&native(approver,P.ManageRoles),'AUTOMATION_ROLE_NATIVE_PERMISSION',403);
  assert(bot.bot&&native(bot,P.ManageRoles),'AUTOMATION_BOT_PERMISSION',403);
  for(const [person,personId] of [[requester,input.requesterId],[approver,input.approverId],[bot,botId]] as const){
    if(personId!==person.ownerId){
      const top=highest(person,roles);
      assert(role.position<top&&highest(target,roles)<top,'ROLE_NOT_MANAGEABLE',403);
    }
    // The role's guild capabilities must already belong to both native managers
    // and the Bot. Administrator is respected without requesting it.
    assert(native(person,bits(role.permissions)),'AUTOMATION_ROLE_NATIVE_PERMISSION',403);
  }
  const after={...target,roles:input.add?[...new Set([...target.roles,role.id])]:target.roles.filter(id=>id!==role.id)};
  let changedChannelCount=0;
  for(const channel of channels){
    const overwrite=channel.permission_overwrites.find(item=>item.type===0&&item.id===role.id);
    if(overwrite)assert(((bits(overwrite.allow)|bits(overwrite.deny))&~ORDINARY_ROLE_PERMISSIONS)===0n,'PRIVILEGED_ROLE_MAPPING_FORBIDDEN',403);
    const before=effective(target,input.memberId,roles,input.guildId,channel),next=effective(after,input.memberId,roles,input.guildId,channel);
    if(before===next)continue;
    changedChannelCount++;
    const gained=next&~before;
    assert((gained&~ORDINARY_ROLE_PERMISSIONS)===0n,'AUTOMATION_ROLE_PRIVILEGE_GAIN',403);
    for(const [person,personId] of [[requester,input.requesterId],[approver,input.approverId]] as const){
      const allowed=effective(person,personId,roles,input.guildId,channel);
      assert((allowed&P.ViewChannel)!==0n&&(gained&~allowed)===0n,'AUTOMATION_ROLE_CHANNEL_PERMISSION',403);
    }
  }
  const memberPolicy=(member:Member)=>({roles:[...member.roles].sort(),permissions:member.permissions,ownerId:member.ownerId,pending:member.pending??false,bot:member.bot});
  const material={input:{...input,protectedRoleIds:[...input.protectedRoleIds].sort()},botId,
    roles:roles.map(item=>({id:item.id,position:item.position,managed:item.managed,permissions:item.permissions,tags:item.tags??{}})).sort((a,b)=>a.id.localeCompare(b.id)),
    members:{requester:memberPolicy(requester),approver:memberPolicy(approver),target:memberPolicy(target),bot:memberPolicy(bot)},
    channels:channels.map(channel=>({id:channel.id,type:channel.type,overwrites:[...channel.permission_overwrites].sort((a,b)=>a.id.localeCompare(b.id)||a.type-b.type)})).sort((a,b)=>a.id.localeCompare(b.id))};
  return {fingerprint:createHash('sha256').update(JSON.stringify(stable(material))).digest('hex'),changedChannelCount};
}
