import {PermissionFlagsBits,type RESTPostAPIChannelMessageJSONBody} from 'discord-api-types/v10';
import {createHash} from 'node:crypto';
import {assert} from '../../shared/src/index.js';
import {z} from 'zod';
export type Member={roles:string[],permissions:string,joinedAt:string,bot:boolean,flags?:string,pending?:boolean|null};
export const nativeOnboardingSchema=z.object({guild_id:z.string(),enabled:z.boolean(),mode:z.number().int(),default_channel_ids:z.array(z.string()),prompts:z.array(z.object({id:z.string(),title:z.string(),type:z.number().int(),options:z.array(z.object({id:z.string(),title:z.string(),role_ids:z.array(z.string()),channel_ids:z.array(z.string())})),single_select:z.boolean(),required:z.boolean(),in_onboarding:z.boolean()}))});
export type NativeOnboarding=z.infer<typeof nativeOnboardingSchema>;
export type GuildNativeState={features:string[],onboarding:NativeOnboarding|null,bot:Member,roles:Role[],onboardingStatus:'available'|'unavailable'};
export type Role={id:string,position:number,managed:boolean,permissions:string,name?:string};
export type DiscordEntityOptions={channels:{id:string;label:string}[];roles:{id:string;label:string}[];events:{id:string;label:string}[]};
export class DiscordFailure extends Error {
 constructor(public readonly status:number,public readonly retryAfter=0,public readonly details:{kind?:'http'|'timeout'|'network';rateLimitScope?:string|null;bucket?:string|null;routeCategory?:string;isGlobal?:boolean}={}){super(details.kind==='timeout'?'Discord REST timeout':details.kind==='network'?'Discord REST network failure':`Discord HTTP ${status}`);this.name='DiscordFailure';}
 get kind(){return this.details.kind??'http';}
 get rateLimitScope(){return this.details.rateLimitScope??null;}
 get bucket(){return this.details.bucket??null;}
 get routeCategory(){return this.details.routeCategory??'unknown';}
 get isGlobal(){return this.details.isGlobal??false;}
}
export interface DiscordPort {
 sendDirectMessage?(userId:string,text:string,nonce:string):Promise<string>;
 nativeState?(guildId:string):Promise<GuildNativeState>;
 options?(guildId:string):Promise<DiscordEntityOptions>;
 memberSnapshot?(guildId:string,userId:string):Promise<Member>;
 registerCommands(guildId:string,commands:unknown[]):Promise<void>;
 commandsMatch?(guildId:string,commands:unknown[]):Promise<boolean>;
 member(guildId:string,userId:string):Promise<Member>;
 roles(guildId:string):Promise<Role[]>;
 checkChannel(guildId:string,channelId:string):Promise<void>;
 validateRole(guildId:string,roleId:string):Promise<void>;
 addRole(guildId:string,userId:string,roleId:string):Promise<void>;
 removeRole(guildId:string,userId:string,roleId:string):Promise<void>;
 sendPanel(channelId:string,body:RESTPostAPIChannelMessageJSONBody,nonce:string):Promise<string>;
 editPanel(channelId:string,messageId:string,body:RESTPostAPIChannelMessageJSONBody):Promise<void>;
 deletePanel?(channelId:string,messageId:string):Promise<void>;
 editReply(applicationId:string,token:string,body:RESTPostAPIChannelMessageJSONBody):Promise<void>;
 followup?(applicationId:string,token:string,body:RESTPostAPIChannelMessageJSONBody):Promise<void>;
 publicChannel?(guildId:string,channelId:string):Promise<boolean>;
 channelVisibility?(guildId:string,channelId:string):Promise<'everyone_visible'|'restricted'|'unknown'>;
}
export class DiscordRest implements DiscordPort {
 private globalUntil=0;
 private readonly routeBuckets=new Map<string,string>();
 private readonly bucketUntil=new Map<string,number>();
 private readonly locks=new Map<string,Promise<void>>();
 constructor(private readonly token:string,private readonly botId:string){}
 async registerCommands(guildId:string,commands:unknown[]){await this.request(`/applications/${this.botId}/guilds/${guildId}/commands`,'PUT',commands);}
 async commandsMatch(guildId:string,commands:unknown[]){
  const actual=await this.request<Record<string,unknown>[]>(`/applications/${this.botId}/guilds/${guildId}/commands?with_localizations=true`);
  const matches=(found:unknown,expected:unknown):boolean=>{if(Array.isArray(expected))return Array.isArray(found)&&found.length===expected.length&&expected.every((item,index)=>matches(found[index],item));if(expected&&typeof expected==='object'){if(!found||typeof found!=='object')return false;return Object.entries(expected).filter(([key])=>['type','name','name_localizations','description','description_localizations','required','options','choices','min_value','max_value','min_length','max_length'].includes(key)).every(([key,value])=>matches((found as Record<string,unknown>)[key],value));}return found===expected;};
  return actual.length===commands.length&&commands.every(expected=>{const item=expected as Record<string,unknown>,found=actual.find(row=>row.name===item.name);return found&&matches(found,expected);});
 }
 private async request<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const route=this.route(path,method),signal=AbortSignal.timeout(20000);
  const retrySafe=method==='GET'||method==='PUT'||method==='DELETE'||method==='PATCH'||method==='POST'&&typeof body==='object'&&body!==null&&'enforce_nonce' in body&&(body as {enforce_nonce?:unknown}).enforce_nonce===true;
  // Serialize each route, including the discovery request before Discord sends a bucket.
  // Known routes sharing a bucket also serialize against one another.
  const routeLock=this.acquire(route.key);let bucketLock:ReturnType<DiscordRest['acquire']>|undefined;
  try{
   await this.waitFor(routeLock.previous,signal);
   const observed=this.routeBuckets.get(route.key);
   if(observed&&observed!==route.key){bucketLock=this.acquire(observed);await this.waitFor(bucketLock.previous,signal);}
   for(let attempt=0;attempt<3;attempt++){
    const bucket=this.routeBuckets.get(route.key)??route.key;
    await this.waitForCooldown(Math.max(this.globalUntil,this.bucketUntil.get(bucket)??0),signal);
    let res:Response;
    try{res=await fetch(`https://discord.com/api/v10${path}`,{method,headers:{Authorization:`Bot ${this.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});}
    catch(error){const failure=new DiscordFailure(0,0,{kind:signal.aborted||error instanceof Error&&/abort|timeout/i.test(error.name)?'timeout':'network',routeCategory:route.category});if(retrySafe&&attempt<2&&!signal.aborted){await this.waitForCooldown(Date.now()+Math.min(1000,250*2**attempt),signal);continue;}throw failure;}
    const bucketId=res.headers.get('x-ratelimit-bucket'),scope=res.headers.get('x-ratelimit-scope');
    const bucketKey=bucketId?`${bucketId}:${route.major}`:bucket;
    if(bucketId)this.routeBuckets.set(route.key,bucketKey);
    const resetAfterHeader=res.headers.get('x-ratelimit-reset-after'),absoluteResetHeader=res.headers.get('x-ratelimit-reset');
    const resetAfter=resetAfterHeader===null?NaN:Number(resetAfterHeader),absoluteReset=absoluteResetHeader===null?NaN:Number(absoluteResetHeader);
    const resetMs=Number.isFinite(resetAfter)&&resetAfter>=0?resetAfter*1000:Number.isFinite(absoluteReset)?Math.max(0,absoluteReset*1000-Date.now()):0;
    if(res.headers.get('x-ratelimit-remaining')==='0'&&resetMs>0)this.bucketUntil.set(bucketKey,Math.max(this.bucketUntil.get(bucketKey)??0,Date.now()+resetMs));
    if(res.ok){if(res.status===204)return undefined as T;try{return await res.json() as T;}catch{throw new DiscordFailure(res.status,0,{routeCategory:route.category});}}
    const retryHeader=res.headers.get('retry-after');let retryAfter=retryHeader===null?NaN:Number(retryHeader);let bodyRetry:number|undefined;let bodyGlobal=false;
    if(res.status===429)try{const data=await res.json() as {retry_after?:number;global?:boolean};bodyRetry=data.retry_after;bodyGlobal=data.global===true;}catch{/* Response body is never logged. */}
    if(!Number.isFinite(retryAfter)||retryAfter<0)retryAfter=bodyRetry!==undefined&&Number.isFinite(bodyRetry)&&bodyRetry>=0?bodyRetry:1;
    const isGlobal=res.status===429&&(bodyGlobal||scope==='global');
    const failure=new DiscordFailure(res.status,res.status===429?retryAfter:0,{rateLimitScope:scope,bucket:bucketId,routeCategory:route.category,isGlobal});
    if(res.status===429){const until=Date.now()+Math.max(0,retryAfter*1000);if(isGlobal)this.globalUntil=Math.max(this.globalUntil,until);else this.bucketUntil.set(bucketKey,Math.max(this.bucketUntil.get(bucketKey)??0,until));}
    if((res.status===429||res.status>=500&&retrySafe)&&attempt<2){
     const delay=res.status===429?retryAfter*1000:Math.min(1000,250*2**attempt);
     if(delay>=8000||signal.aborted)throw failure;
     await this.waitForCooldown(Date.now()+delay,signal);
     continue;
    }
    throw failure;
   }
   throw new DiscordFailure(429,0,{routeCategory:route.category});
  }finally{bucketLock?.release();routeLock.release();}
 }
 private acquire(key:string){
  const previous=this.locks.get(key)??Promise.resolve();let done!:()=>void;
  const current=new Promise<void>(resolve=>{done=resolve;});const tail=previous.then(()=>current);
  this.locks.set(key,tail);
  return {previous,release:()=>{done();if(this.locks.get(key)===tail)this.locks.delete(key);}};
 }
 private route(path:string,method:string){
  const parts=path.split('?')[0]!.split('/').filter(Boolean),category=parts[0]==='webhooks'?'webhook':parts[0]==='applications'?'commands':parts[0]==='guilds'?parts[2]??'guild':parts[0]==='channels'?parts[2]??'channel':parts[0]??'unknown';
  const major=parts[0]==='guilds'||parts[0]==='channels'?parts[1]??'':parts[0]==='webhooks'?`${parts[1]??''}:${createHash('sha256').update(parts[2]??'').digest('hex').slice(0,12)}`:'';
  const normalized=parts.map((part,index)=>index===1&&major?part:/^\d{17,20}$/.test(part)?':id':parts[0]==='webhooks'&&index===2?':token':part).join('/');
  return {key:`${method}:${normalized}:${major}`,major,category};
 }
 private async waitFor(promise:Promise<void>,signal:AbortSignal){
  if(signal.aborted)throw new DiscordFailure(0,0,{kind:'timeout'});
  let abort!:()=>void;const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new DiscordFailure(0,0,{kind:'timeout'}));signal.addEventListener('abort',abort,{once:true});});
  try{await Promise.race([promise,cancelled]);}finally{signal.removeEventListener('abort',abort);}
 }
 private async waitForCooldown(until:number,signal:AbortSignal){const ms=until-Date.now();if(ms<=0)return;await this.waitFor(new Promise(resolve=>setTimeout(resolve,ms)),signal);}
 async roles(guildId:string){return this.request<Role[]>(`/guilds/${guildId}/roles`);}
 async options(guildId:string):Promise<DiscordEntityOptions>{
  const [channels,roles,events]=await Promise.all([this.request<{id:string;name:string;type:number}[]>(`/guilds/${guildId}/channels`),this.roles(guildId),this.request<{id:string;name:string;status:number}[]>(`/guilds/${guildId}/scheduled-events`)]);
  return {channels:channels.filter(c=>c.type===0||c.type===5).map(c=>({id:c.id,label:`#${c.name}`})),roles:roles.filter(r=>r.id!==guildId&&!r.managed).map(r=>({id:r.id,label:`@${r.name??'role'}`})),events:events.filter(e=>e.status===1||e.status===2).map(e=>({id:e.id,label:e.name}))};
 }
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
  let channel:{guild_id:string,type:number,permission_overwrites:{id:string,type:number,allow:string,deny:string}[]};
  try{channel=await this.request(`/channels/${channelId}`);}
  catch(error){if(error instanceof DiscordFailure&&[403,404].includes(error.status))assert(false,'INVALID_START_CHANNEL');throw error;}
  const bot=await this.member(guildId,this.botId);
  assert(channel.guild_id===guildId&&(channel.type===0||channel.type===5),'INVALID_START_CHANNEL');
  let bits=BigInt(bot.permissions);
  if((bits&PermissionFlagsBits.Administrator)===0n){
   const everyone=channel.permission_overwrites.find(o=>o.id===guildId);
   if(everyone)bits=(bits&~BigInt(everyone.deny))|BigInt(everyone.allow);
   let deny=0n,allow=0n;for(const o of channel.permission_overwrites)if(o.type===0&&bot.roles.includes(o.id)){deny|=BigInt(o.deny);allow|=BigInt(o.allow);}bits=(bits&~deny)|allow;
   const personal=channel.permission_overwrites.find(o=>o.type===1&&o.id===this.botId);if(personal)bits=(bits&~BigInt(personal.deny))|BigInt(personal.allow);
   assert((bits&PermissionFlagsBits.ViewChannel)!==0n&&(bits&PermissionFlagsBits.SendMessages)!==0n,'CHANNEL_PERMISSION_MISSING');
  }
 }
 async channelVisibility(guildId:string,channelId:string):Promise<'everyone_visible'|'restricted'|'unknown'>{
  const [channel,roles]=await Promise.all([this.request<{guild_id:string;permission_overwrites:{id:string;type:number;allow:string;deny:string}[]}>(`/channels/${channelId}`),this.roles(guildId)]);
  assert(channel.guild_id===guildId,'INVALID_START_CHANNEL');
  const everyone=roles.find(role=>role.id===guildId);if(!everyone)return 'unknown';
  let bits=BigInt(everyone.permissions);const overwrite=channel.permission_overwrites.find(row=>row.id===guildId);
  if(overwrite)bits=(bits&~BigInt(overwrite.deny))|BigInt(overwrite.allow);
  return (bits&PermissionFlagsBits.ViewChannel)!==0n?'everyone_visible':'restricted';
 }
 async publicChannel(guildId:string,channelId:string){return (await this.channelVisibility(guildId,channelId))!=='restricted';}
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
 async deletePanel(channelId:string,messageId:string){await this.request(`/channels/${channelId}/messages/${messageId}`,'DELETE');}
 async editReply(applicationId:string,token:string,body:RESTPostAPIChannelMessageJSONBody){await this.request(`/webhooks/${applicationId}/${encodeURIComponent(token)}/messages/@original`,'PATCH',body);}
 async followup(applicationId:string,token:string,body:RESTPostAPIChannelMessageJSONBody){await this.request(`/webhooks/${applicationId}/${encodeURIComponent(token)}`,'POST',{...body,flags:64});}
}
