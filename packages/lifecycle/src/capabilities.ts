import {randomUUID} from 'node:crypto';
import {PermissionFlagsBits} from 'discord-api-types/v10';
import {sql,tenant,json,type Database} from '../../db/src/index.js';
import {assert,type Scope} from '../../shared/src/index.js';
import type {DiscordPort,GuildNativeState} from '../../discord/src/rest.js';
import type {Settings} from '../../settings/src/index.js';
export type OnboardingMode=Settings['onboardingMode'];
export type IntentAvailability={members:boolean|null,messages:boolean|null,reactions:boolean|null,voice:boolean|null,scheduledEvents:boolean|null};
export type GuildCapabilityProfile={guildId:string,communityEnabled:boolean,nativeOnboardingAvailable:boolean,nativeOnboardingEnabled:boolean,membershipScreeningEnabled:boolean,serverGuideSignalsAvailable:boolean|null,intents:IntentAvailability,manageGuild:boolean,manageRoles:boolean,sendMessages:boolean,highestBotRolePosition:number|null,onboardingMode:OnboardingMode,recommendedMode:'native'|'fallback',nativePromptIds:string[],checkedAt:string,coverage:'healthy'|'unavailable'};
export function chooseMode(mode:OnboardingMode,nativeUsable:boolean):Exclude<OnboardingMode,'auto'>{return mode==='auto'?(nativeUsable?'native':'fallback'):mode;}
export function capabilityProfile(guildId:string,state:GuildNativeState,mode:OnboardingMode,intents:IntentAvailability,now=new Date()):GuildCapabilityProfile {
 const bits=BigInt(state.bot.permissions),admin=(bits&PermissionFlagsBits.Administrator)!==0n;
 const can=(permission:bigint)=>admin||(bits&permission)!==0n;
 const usable=state.features.includes('COMMUNITY')&&state.onboarding?.enabled===true;
 return {guildId,communityEnabled:state.features.includes('COMMUNITY'),nativeOnboardingAvailable:state.onboardingStatus==='available',nativeOnboardingEnabled:state.onboarding?.enabled??false,membershipScreeningEnabled:state.features.includes('MEMBER_VERIFICATION_GATE_ENABLED'),serverGuideSignalsAvailable:null,intents,manageGuild:can(PermissionFlagsBits.ManageGuild),manageRoles:can(PermissionFlagsBits.ManageRoles),sendMessages:can(PermissionFlagsBits.SendMessages),highestBotRolePosition:state.roles.filter(r=>state.bot.roles.includes(r.id)).reduce<number|null>((n,r)=>Math.max(n??0,r.position),null),onboardingMode:mode,recommendedMode:usable?'native':'fallback',nativePromptIds:state.onboarding?.prompts.map(p=>p.id)??[],checkedAt:now.toISOString(),coverage:state.onboardingStatus==='available'?'healthy':'unavailable'};
}
export class CapabilityService {
 constructor(private readonly db:Database,private readonly discord:DiscordPort,private readonly intents:()=>IntentAvailability=()=>({members:null,messages:null,reactions:null,voice:null,scheduledEvents:null})){}
 async refresh(s:Scope,mode:OnboardingMode){
  assert(this.discord.nativeState,'NATIVE_READ_UNAVAILABLE',503);
  const profile=capabilityProfile(s.guildId,await this.discord.nativeState(s.guildId),mode,this.intents());
  await sql`INSERT INTO guild_capabilities VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${json(profile)},${new Date(profile.checkedAt)})`.execute(this.db);return profile;
 }
 async latest(s:Scope){return (await sql<{profile:GuildCapabilityProfile}>`SELECT profile FROM guild_capabilities WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(this.db)).rows[0]?.profile??null;}
}
