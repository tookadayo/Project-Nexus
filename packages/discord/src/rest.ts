import {PermissionFlagsBits,type RESTPostAPIChannelMessageJSONBody} from 'discord-api-types/v10';
import {assert} from '../../shared/src/index.js';
import {z} from 'zod';
export type Member={roles:string[],permissions:string,joinedAt:string,bot:boolean,flags?:string,pending?:boolean|null};
export const nativeOnboardingSchema=z.object({guild_id:z.string(),enabled:z.boolean(),mode:z.number().int(),default_channel_ids:z.array(z.string()),prompts:z.array(z.object({id:z.string(),title:z.string(),type:z.number().int(),options:z.array(z.object({id:z.string(),title:z.string(),role_ids:z.array(z.string()),channel_ids:z.array(z.string())})),single_select:z.boolean(),required:z.boolean(),in_onboarding:z.boolean()}))});
export type NativeOnboarding=z.infer<typeof nativeOnboardingSchema>;
export type GuildNativeState={features:string[],onboarding:NativeOnboarding|null,bot:Member,roles:Role[],onboardingStatus:'available'|'unavailable'};
export type Role={id:string,position:number,managed:boolean,permissions:string};
export class DiscordFailure extends Error {
 constructor(public readonly status:number,public readonly retryAfter=1){super(`Discord HTTP ${status}`);}
}
export interface DiscordPort {
 sendDirectMessage?(userId:string,text:string,nonce:string):Promise<string>;
 nativeState?(guildId:string):Promise<GuildNativeState>;
 memberSnapshot?(guildId:string,userId:string):Promise<Member>;
 registerCommands(guildId:string,commands:unknown[]):Promise<void>;
 member(guildId:string,userId:string):Promise<Member>;
 roles(guildId:string):Promise<Role[]>;
 checkChannel(guildId:string,channelId:string):Promise<void>;
 validateRole(guildId:string,roleId:string):Promise<void>;
 addRole(guildId:string,userId:string,roleId:string):Promise<void>;
 removeRole(guildId:string,userId:string,roleId:string):Promise<void>;
 sendPanel(channelId:string,body:RESTPostAPIChannelMessageJSONBody,nonce:string):Promise<string>;
 editPanel(channelId:string,messageId:string,body:RESTPostAPIChannelMessageJSONBody):Promise<void>;
 editReply(applicationId:string,token:string,body:RESTPostAPIChannelMessageJSONBody):Promise<void>;
}
export class DiscordRest implements DiscordPort {
 private cooldownUntil=0;
 constructor(private readonly token:string,private readonly botId:string){}
 async registerCommands(guildId:string,commands:unknown[]){await this.request(`/applications/${this.botId}/guilds/${guildId}/commands`,'PUT',commands);}
 private async request<T>(path:string,method='GET',body?:unknown):Promise<T>{
  if(this.cooldownUntil>Date.now())throw new DiscordFailure(429,(this.cooldownUntil-Date.now())/1000);
  const res=await fetch(`https://discord.com/api/v10${path}`,{method,headers:{Authorization:`Bot ${this.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  const reset=Number(res.headers.get('x-ratelimit-reset-after')??0);
  if(res.headers.get('x-ratelimit-remaining')==='0'&&Number.isFinite(reset))this.cooldownUntil=Math.max(this.cooldownUntil,Date.now()+reset*1000);
  if(!res.ok){let retry=Number(res.headers.get('retry-after')??1);try{const data=await res.json() as {retry_after?:number};retry=data.retry_after??retry;}catch{/* no response details are logged */}if(res.status===429)this.cooldownUntil=Math.max(this.cooldownUntil,Date.now()+retry*1000);throw new DiscordFailure(res.status,retry);}
  return (res.status===204?undefined:await res.json()) as T;
 }
 async roles(guildId:string){return this.request<Role[]>(`/guilds/${guildId}/roles`);}
 async memberSnapshot(guildId:string,userId:string):Promise<Member>{
  const raw=z.object({roles:z.array(z.string()),joined_at:z.string(),flags:z.number().int().nonnegative().optional(),pending:z.boolean().optional(),user:z.object({bot:z.boolean().optional()}).optional()}).parse(await this.request(`/guilds/${guildId}/members/${userId}`));
  return {roles:raw.roles,joinedAt:raw.joined_at,permissions:'0',bot:raw.user?.bot??false,flags:raw.flags===undefined?undefined:String(raw.flags),pending:raw.pending??null};
 }
 async nativeState(guildId:string):Promise<GuildNativeState>{
  const guild=z.object({features:z.array(z.string())}).parse(await this.request(`/guilds/${guildId}`));
  const bot=await this.member(guildId,this.botId);const roles=await this.roles(guildId);
  let onboarding:NativeOnboarding|null=null;
  try{onboarding=nativeOnboardingSchema.parse(await this.request(`/guilds/${guildId}/onboarding`));}
  catch(error){if(!(error instanceof DiscordFailure)||![403,404].includes(error.status))throw error;}
  return {features:guild.features,onboarding,bot,roles,onboardingStatus:onboarding?'available':'unavailable'};
 }
 async member(guildId:string,userId:string):Promise<Member>{
  const [raw,roles,guild]=await Promise.all([this.request<{roles:string[],joined_at:string,user:{bot?:boolean}}>(`/guilds/${guildId}/members/${userId}`),this.roles(guildId),this.request<{owner_id:string}>(`/guilds/${guildId}`)]);
  let permissions=0n;for(const role of roles)if(role.id===guildId||raw.roles.includes(role.id))permissions|=BigInt(role.permissions);
  if(userId===guild.owner_id)permissions|=PermissionFlagsBits.Administrator;
  return {roles:raw.roles,permissions:permissions.toString(),joinedAt:raw.joined_at,bot:raw.user.bot??false};
 }
 async checkChannel(guildId:string,channelId:string){
  const [channel,bot]=await Promise.all([this.request<{guild_id:string,type:number,permission_overwrites:{id:string,type:number,allow:string,deny:string}[]}>(`/channels/${channelId}`),this.member(guildId,this.botId)]);
  assert(channel.guild_id===guildId&&channel.type===0,'INVALID_START_CHANNEL');
  let bits=BigInt(bot.permissions);
  if((bits&PermissionFlagsBits.Administrator)===0n){
   const everyone=channel.permission_overwrites.find(o=>o.id===guildId);
   if(everyone)bits=(bits&~BigInt(everyone.deny))|BigInt(everyone.allow);
   let deny=0n,allow=0n;for(const o of channel.permission_overwrites)if(o.type===0&&bot.roles.includes(o.id)){deny|=BigInt(o.deny);allow|=BigInt(o.allow);}bits=(bits&~deny)|allow;
   const personal=channel.permission_overwrites.find(o=>o.type===1&&o.id===this.botId);if(personal)bits=(bits&~BigInt(personal.deny))|BigInt(personal.allow);
   assert((bits&PermissionFlagsBits.ViewChannel)!==0n&&(bits&PermissionFlagsBits.SendMessages)!==0n,'CHANNEL_PERMISSION_MISSING');
  }
 }
 async validateRole(guildId:string,roleId:string){
  const [roles,bot]=await Promise.all([this.roles(guildId),this.member(guildId,this.botId)]);
  const role=roles.find(r=>r.id===roleId);const highest=Math.max(0,...roles.filter(r=>bot.roles.includes(r.id)).map(r=>r.position));
  const bits=BigInt(bot.permissions);assert((bits&PermissionFlagsBits.ManageRoles)!==0n||(bits&PermissionFlagsBits.Administrator)!==0n,'MANAGE_ROLES_MISSING');
  assert(role&&!role.managed&&role.id!==guildId&&role.position<highest,'ROLE_NOT_MANAGEABLE');
  const elevated=PermissionFlagsBits.Administrator|PermissionFlagsBits.ManageGuild|PermissionFlagsBits.ManageRoles|PermissionFlagsBits.ManageChannels|PermissionFlagsBits.BanMembers|PermissionFlagsBits.KickMembers|PermissionFlagsBits.ManageWebhooks;
  assert((BigInt(role.permissions)&elevated)===0n,'PRIVILEGED_ROLE_MAPPING_FORBIDDEN');
 }
 async addRole(guildId:string,userId:string,roleId:string){await this.request(`/guilds/${guildId}/members/${userId}/roles/${roleId}`,'PUT');}
 async removeRole(guildId:string,userId:string,roleId:string){await this.request(`/guilds/${guildId}/members/${userId}/roles/${roleId}`,'DELETE');}
 async sendPanel(channelId:string,body:RESTPostAPIChannelMessageJSONBody,nonce:string){return (await this.request<{id:string}>(`/channels/${channelId}/messages`,'POST',{...body,nonce:nonce.replaceAll('-','').slice(0,25),enforce_nonce:true})).id;}
 async sendDirectMessage(userId:string,text:string,nonce:string){const dm=await this.request<{id:string}>('/users/@me/channels','POST',{recipient_id:userId});return this.sendPanel(dm.id,{content:text,allowed_mentions:{parse:[]}},nonce);}
 async editPanel(channelId:string,messageId:string,body:RESTPostAPIChannelMessageJSONBody){await this.request(`/channels/${channelId}/messages/${messageId}`,'PATCH',body);}
 async editReply(applicationId:string,token:string,body:RESTPostAPIChannelMessageJSONBody){await this.request(`/webhooks/${applicationId}/${encodeURIComponent(token)}/messages/@original`,'PATCH',body);}
}
