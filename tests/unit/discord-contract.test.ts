import {afterEach,expect,it,vi} from 'vitest';
import {DiscordRest,DiscordFailure} from '../../packages/discord/src/rest.js';
// Documented v10 shapes: https://docs.discord.com/developers/resources/guild
const guildId='111111111111111111',botId='222222222222222222',roleId='333333333333333333';
const roles=[{id:guildId,name:'@everyone',color:0,hoist:false,position:0,permissions:'3072',managed:false,mentionable:false},{id:roleId,name:'NEXUS',color:0,hoist:false,position:5,permissions:'268435488',managed:false,mentionable:false}];
const guild={id:guildId,name:'Contract fixture',icon:null,splash:null,discovery_splash:null,owner_id:'444444444444444444',afk_channel_id:null,afk_timeout:300,verification_level:0,default_message_notifications:1,explicit_content_filter:2,roles,emojis:[],features:['COMMUNITY','MEMBER_VERIFICATION_GATE_ENABLED'],mfa_level:0,application_id:null,system_channel_id:null,system_channel_flags:0,rules_channel_id:null,vanity_url_code:null,description:null,banner:null,premium_tier:0,preferred_locale:'en-US',public_updates_channel_id:null,nsfw_level:0,premium_progress_bar_enabled:false,safety_alerts_channel_id:null};
const member={user:{id:botId,username:'must-not-persist',discriminator:'0',avatar:null,bot:true},nick:null,avatar:null,roles:[roleId],joined_at:'2026-09-01T00:00:00.000Z',premium_since:null,deaf:false,mute:false,flags:106,pending:false,communication_disabled_until:null};
const onboarding={guild_id:guildId,prompts:[{id:'555555555555555555',type:0,options:[{id:'666666666666666666',channel_ids:[],role_ids:[],emoji:{id:null,name:'🎮',animated:false},title:'Gaming',description:null}],title:'Interests',single_select:false,required:false,in_onboarding:true}],default_channel_ids:[],enabled:true,mode:0};
afterEach(()=>vi.unstubAllGlobals());
it('reads Guild, Member and Onboarding through documented GET contracts only',async()=>{
 const calls:{url:string,method:string}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,method:init.method!});const body=url.endsWith('/onboarding')?onboarding:url.endsWith('/roles')?roles:url.includes('/members/')?member:guild;return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});}));
 const rest=new DiscordRest('test-only-token',botId),native=await rest.nativeState(guildId),snapshot=await rest.memberSnapshot(guildId,botId);
 expect(native.onboarding?.enabled).toBe(true);expect(snapshot.flags).toBe('106');expect(snapshot).not.toHaveProperty('username');expect(calls.every(c=>c.method==='GET')).toBe(true);
});
it('honors Discord reset headers before issuing another request',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(member),{status:200,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset-after':'30'}}));vi.stubGlobal('fetch',fetcher);
 const rest=new DiscordRest('test-only-token',botId);await rest.memberSnapshot(guildId,botId);await expect(rest.memberSnapshot(guildId,botId)).rejects.toBeInstanceOf(DiscordFailure);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects an above-bot role before making a role mutation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/roles')?[...roles,{id:'777777777777777777',name:'Owner',position:9,permissions:'0',managed:false}]:url.includes('/members/')?member:guild),{status:200})));
 await expect(new DiscordRest('test-only-token',botId).validateRole(guildId,'777777777777777777')).rejects.toThrow('ROLE_NOT_MANAGEABLE');
});
it('explains a channel deleted after selection without exposing Discord HTTP errors',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:404})));
 await expect(new DiscordRest('test-only-token',botId).checkChannel(guildId,'888888888888888888')).rejects.toThrow('INVALID_START_CHANNEL');
});
