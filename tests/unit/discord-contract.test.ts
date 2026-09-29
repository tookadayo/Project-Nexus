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
it('isolates an exhausted member bucket while panel channel and roles routes remain usable',async()=>{
 const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push(url);const path=new URL(url).pathname;const headers:Record<string,string>=path.includes('/members/')?{'x-ratelimit-bucket':'member-bucket','x-ratelimit-remaining':'0','x-ratelimit-reset-after':'0.02'}:{};return new Response(JSON.stringify(path.includes('/members/')?member:path.includes('/roles')?roles:{guild_id:guildId,type:0,permission_overwrites:[]}),{status:200,headers});}));
 const rest=new DiscordRest('test-only-token',botId);await rest.memberSnapshot(guildId,botId);await rest.checkChannel(guildId,'888888888888888888');
 expect(calls.some(path=>path.includes('/channels/888888888888888888'))).toBe(true);
 expect(calls.some(path=>path.includes('/roles'))).toBe(true);
});
it('waits only for the exhausted bucket and keeps retries bounded',async()=>{
 let count=0;vi.stubGlobal('fetch',vi.fn(async()=>{count++;return count===1?new Response(JSON.stringify(member),{status:200,headers:{'x-ratelimit-bucket':'member','x-ratelimit-remaining':'0','x-ratelimit-reset-after':'0.01'}}):new Response(JSON.stringify(member),{status:200});}));
 const rest=new DiscordRest('test-only-token',botId);await rest.memberSnapshot(guildId,botId);await rest.memberSnapshot(guildId,botId);expect(count).toBe(2);
});
it.each([401,403,404,500])('classifies Discord HTTP %i',async status=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status})));
 try{await new DiscordRest('test-only-token',botId).roles(guildId);throw new Error('expected failure');}catch(error){expect(error).toBeInstanceOf(DiscordFailure);expect((error as DiscordFailure).status).toBe(status);expect((error as DiscordFailure).routeCategory).toBe('roles');}
});
it('retries a route 429 without globally blocking another route',async()=>{
 let rolesCalls=0;const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push(url);if(url.endsWith('/roles')&&rolesCalls++===0)return new Response(JSON.stringify({retry_after:0.001}),{status:429,headers:{'x-ratelimit-scope':'shared','x-ratelimit-bucket':'roles','retry-after':'0.001'}});return new Response(JSON.stringify(url.endsWith('/roles')?roles:[]),{status:200});}));
 const rest=new DiscordRest('test-only-token',botId);await rest.roles(guildId);await rest.options(guildId);expect(rolesCalls).toBe(3);expect(calls.some(url=>url.endsWith('/channels'))).toBe(true);
});
it('uses body retry_after when Retry-After is absent and stops after bounded failures',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return calls===1?new Response(JSON.stringify({retry_after:0.001}),{status:429,headers:{'x-ratelimit-scope':'user'}}):new Response(JSON.stringify(roles),{status:200});}));
 expect(await new DiscordRest('test-only-token',botId).roles(guildId)).toEqual(roles);expect(calls).toBe(2);
 calls=0;vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return new Response('{}',{status:503});}));
 await expect(new DiscordRest('test-only-token',botId).roles(guildId)).rejects.toMatchObject({status:503});expect(calls).toBe(3);
});
it('uses absolute reset when Reset-After is absent',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>{calls++;const headers:Record<string,string>=calls===1?{'x-ratelimit-bucket':'roles','x-ratelimit-remaining':'0','x-ratelimit-reset':String((Date.now()+15)/1000)}:{};return new Response(JSON.stringify(roles),{status:200,headers});}));
 const rest=new DiscordRest('test-only-token',botId);await rest.roles(guildId);await rest.roles(guildId);expect(calls).toBe(2);
});
it('shares an observed bucket across routes with the same major guild',async()=>{
 let rolesCalls=0;const calls:{url:string;at:number}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push({url,at:Date.now()});const role=url.endsWith('/roles');if(role)rolesCalls++;return new Response(JSON.stringify(role?roles:[]),{status:200,headers:{'x-ratelimit-bucket':'shared-guild','x-ratelimit-remaining':role&&rolesCalls===3?'0':'1','x-ratelimit-reset-after':'0.05'}});}));
 const rest=new DiscordRest('test-only-token',botId);await rest.roles(guildId);await rest.options(guildId);await rest.roles(guildId);const before=Date.now();await rest.options(guildId);
 expect(Date.now()-before).toBeGreaterThanOrEqual(30);expect(calls.some(call=>call.url.endsWith('/channels'))).toBe(true);
});
it('applies a true global 429 to other routes only until retry_after',async()=>{
 const calls:{url:string;at:number}[]=[];let first=true;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push({url,at:Date.now()});if(first){first=false;return new Response(JSON.stringify({global:true,retry_after:0.04}),{status:429,headers:{'x-ratelimit-scope':'global'}});}return new Response(JSON.stringify(url.endsWith('/roles')?roles:[]),{status:200});}));
 const rest=new DiscordRest('test-only-token',botId),roleRequest=rest.roles(guildId);await new Promise(resolve=>setTimeout(resolve,5));await rest.options(guildId);await roleRequest;
 const other=calls.find(call=>call.url.endsWith('/channels'));expect(other).toBeDefined();expect(other!.at-calls[0]!.at).toBeGreaterThanOrEqual(25);
});
it('keeps interaction webhook tokens in separate major-resource buckets',async()=>{
 const calls:{url:string;at:number}[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push({url,at:Date.now()});return new Response(null,{status:204,headers:{'x-ratelimit-bucket':'interaction-callback','x-ratelimit-remaining':'0','x-ratelimit-reset-after':'1'}});}));
 const rest=new DiscordRest('test-only-token',botId);await rest.editReply(botId,'interaction-token-a',{content:'ok'});const before=Date.now();await rest.editReply(botId,'interaction-token-b',{content:'ok'});
 expect(calls).toHaveLength(2);expect(Date.now()-before).toBeLessThan(500);
});
it('classifies global 429, timeout and network errors without response bodies',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({global:true,retry_after:9,secret:'never-log'}),{status:429,headers:{'x-ratelimit-scope':'global','retry-after':'9'}})));
 await expect(new DiscordRest('test-only-token',botId).roles(guildId)).rejects.toMatchObject({status:429,isGlobal:true,retryAfter:9});
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new DOMException('timeout','TimeoutError');}));
 await expect(new DiscordRest('test-only-token',botId).roles(guildId)).rejects.toMatchObject({kind:'timeout'});
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('network unreachable');}));
 await expect(new DiscordRest('test-only-token',botId).roles(guildId)).rejects.toMatchObject({kind:'network'});
});
it('retries transient GET network failures but never retries an unsafe POST or 403/404',async()=>{
 let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>{calls++;if(calls<3)throw new TypeError('network unavailable');return new Response(JSON.stringify(roles),{status:200});}));
 expect(await new DiscordRest('test-only-token',botId).roles(guildId)).toEqual(roles);expect(calls).toBe(3);
 calls=0;vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return new Response('{}',{status:503});}));
 await expect(new DiscordRest('test-only-token',botId).followup(botId,'private-interaction-token',{content:'hello'})).rejects.toMatchObject({status:503});expect(calls).toBe(1);
 for(const status of [403,404]){calls=0;vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return new Response('{}',{status});}));await expect(new DiscordRest('test-only-token',botId).roles(guildId)).rejects.toMatchObject({status});expect(calls).toBe(1);}
});
it('retries nonce-protected panel sends with the same nonce',async()=>{
 const bodies:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{bodies.push(String(init.body));return bodies.length===1?new Response('{}',{status:503}):new Response(JSON.stringify({id:'999999999999999999'}),{status:200});}));
 expect(await new DiscordRest('test-only-token',botId).sendPanel('888888888888888888',{content:'panel'},'same-action-id')).toBe('999999999999999999');
 expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);
});
it('rejects an above-bot role before making a role mutation',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/roles')?[...roles,{id:'777777777777777777',name:'Owner',position:9,permissions:'0',managed:false}]:url.includes('/members/')?member:guild),{status:200})));
 await expect(new DiscordRest('test-only-token',botId).validateRole(guildId,'777777777777777777')).rejects.toThrow('ROLE_NOT_MANAGEABLE');
});
it('explains a channel deleted after selection without exposing Discord HTTP errors',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:404})));
 await expect(new DiscordRest('test-only-token',botId).checkChannel(guildId,'888888888888888888')).rejects.toThrow('INVALID_START_CHANNEL');
});
