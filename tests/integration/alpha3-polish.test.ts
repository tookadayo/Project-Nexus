import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {infrastructure} from '../fixtures/infrastructure.js';
import {FakeDiscord} from '../fixtures/discord.js';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
import {Components,scopeForGuild} from '../../packages/security/src/index.js';
import {SettingsService,type Actor} from '../../packages/settings/src/index.js';
import {OnboardingService} from '../../packages/onboarding/src/index.js';
import {LifecycleService} from '../../packages/lifecycle/src/index.js';
import {normalize,type Envelope} from '../../packages/events/src/index.js';
import {CommunityService} from '../../packages/presentation/src/community.js';
import {PrivacyService} from '../../packages/security/src/privacy.js';
import {InteractionWorker} from '../../apps/worker/src/interactions.js';
import {createInteractionServer} from '../../apps/interaction/src/server.js';

let infra:Awaited<ReturnType<typeof infrastructure>>,db:Database,counter=0;
const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),channel='733333333333333333',newcomer='722222222222222222',helper='722222222222222223',bot='722222222222222224',messageId='744444444444444444',managerRole='755555555555555555',root='766666666666666666';
const actor:Actor={key:'admin',permissions:'8',roles:[],source:'DISCORD_PANEL',requestId:'polish'};
beforeAll(async()=>{infra=await infrastructure();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function setup(){
 const s=scopeForGuild(String(711111111111111110n+BigInt(++counter)));await ensureGuild(db,s);
 const settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('polish-test'),now=new Date(),joined=new Date(now.getTime()-3600000);
 await settings.update(s,actor,0,{enabled:true,setupVersion:2,setupSteps:{scope:true,team:true,notifications:true,goals:true},helperChannelId:channel,managerRoleIds:[managerRole]});
 discord.members.set(newcomer,{joinedAt:joined.toISOString(),roles:[],permissions:'0',bot:false});
 discord.members.set(helper,{joinedAt:new Date(now.getTime()-30*86400000).toISOString(),roles:[],permissions:'8',bot:false});
 discord.members.set(bot,{joinedAt:joined.toISOString(),roles:[],permissions:'0',bot:true});
 const lifecycle=new LifecycleService(db,vault,settings,discord),onboarding=new OnboardingService(db,settings,vault),worker=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{});
 await lifecycle.process(normalize({t:'MESSAGE_CREATE',s:1,d:{guild_id:s.guildId,id:messageId,channel_id:channel,author:{id:newcomer},timestamp:joined.toISOString(),type:0,content:'never retain'}},0,'polish',vault)!);
 await sql`INSERT INTO telemetry_cursor VALUES(${s.organizationId}::uuid,${s.guildId},${new Date(now.getTime()-86400000)},${now})`.execute(db);
 await sql`INSERT INTO settings_panels VALUES(${s.organizationId}::uuid,${s.guildId},${channel},${root})`.execute(db);
 return {s,settings,discord,tokens,lifecycle,worker,now,joined};
}
const job=(userId=helper)=>({id:randomUUID(),applicationId:'777777777777777777',token:'test-only',userId,channelId:channel,locale:'en-US'});
function reaction(ctx:Awaited<ReturnType<typeof setup>>,userId:string,sequence:number):Envelope{
 return normalize({t:'MESSAGE_REACTION_ADD',s:sequence,d:{guild_id:ctx.s.guildId,user_id:userId,message_id:messageId,channel_id:channel,emoji:{name:'must not be stored'}}},0,'polish',vault,ctx.now)!;
}
it('counts received human reactions, excludes self and bots, deduplicates retries and keeps Attention open',async()=>{
 const ctx=await setup();
 const first=reaction(ctx,helper,2);await ctx.lifecycle.process(first);await ctx.lifecycle.process(first);
 await ctx.lifecycle.process(reaction(ctx,helper,3));await ctx.lifecycle.process(reaction(ctx,newcomer,4));await ctx.lifecycle.process(reaction(ctx,bot,5));await ctx.lifecycle.process(reaction(ctx,helper,6));
 const rows=(await sql<{data:Record<string,unknown>}>`SELECT data FROM lifecycle_events WHERE ${tenant(ctx.s)} AND kind='reaction.received'`.execute(db)).rows;
 expect(rows).toHaveLength(3);expect(rows[0]?.data).toEqual({channelId:channel,messageId});
 expect(JSON.stringify(rows)).not.toMatch(/must not|never retain|emoji|722222222222222223/);
 const view=await new CommunityService(db,ctx.settings).overview(ctx.s,30,ctx.now);
 expect(view.reactionsReceived).toBe(3);expect(view.daily.todayConnected).toBe(0);expect(view.attention).toHaveLength(1);
 expect((await sql`SELECT id FROM lifecycle_events WHERE ${tenant(ctx.s)} AND kind IN ('reply.received','reply.established','voice.connected')`.execute(db)).rows).toHaveLength(0);
 const status=await ctx.worker.dispatch(ctx.s,{...job(),command:'contextMember',targetUserId:newcomer});
 expect(JSON.stringify(status)).toContain('Received light responses (3)');expect(JSON.stringify(status)).toContain('Waiting for first connection');
 await ctx.settings.update(ctx.s,actor,(await ctx.settings.get(ctx.s)).revision,{analysisScope:{mode:'exclude',channelIds:[channel]}});
 expect((await new CommunityService(db,ctx.settings).overview(ctx.s,30,ctx.now)).reactionsReceived).toBe(0);
 expect(JSON.stringify(await ctx.worker.dispatch(ctx.s,{...job(),command:'contextMember',targetUserId:newcomer}))).toContain('Received light responses (0)');
 await new PrivacyService(db,vault,ctx.settings).delete(ctx.s,newcomer,{...actor,key:vault.hash(ctx.s,newcomer)});
 expect((await sql`SELECT id FROM lifecycle_events WHERE ${tenant(ctx.s)} AND kind='reaction.received'`.execute(db)).rows).toHaveLength(0);
});
it('purges received reaction observations using the existing detailed retention period',async()=>{
 const ctx=await setup();await ctx.lifecycle.process(reaction(ctx,helper,2));
 await sql`UPDATE lifecycle_events SET occurred_at=now()-interval '31 days' WHERE ${tenant(ctx.s)} AND kind='reaction.received'`.execute(db);
 await new PrivacyService(db,vault,ctx.settings).purge(ctx.s);
 expect((await sql`SELECT id FROM lifecycle_events WHERE ${tenant(ctx.s)} AND kind='reaction.received'`.execute(db)).rows).toHaveLength(0);
});
it.each(['reply','voice'] as const)('recognizes a strong %s connection while reactions remain weak',async kind=>{
 const ctx=await setup();await ctx.lifecycle.process(reaction(ctx,helper,2));
 if(kind==='reply')await ctx.lifecycle.process(normalize({t:'MESSAGE_CREATE',s:3,d:{guild_id:ctx.s.guildId,id:'744444444444444445',channel_id:channel,author:{id:helper},timestamp:ctx.now.toISOString(),type:19,message_reference:{message_id:messageId}}},0,'polish',vault)!);
 else for(const [i,user_id] of [newcomer,helper].entries())await ctx.lifecycle.process(normalize({t:'VOICE_STATE_UPDATE',s:3+i,d:{guild_id:ctx.s.guildId,user_id,channel_id:channel}},0,'polish',vault,ctx.now)!);
 const view=await new CommunityService(db,ctx.settings).overview(ctx.s,30,ctx.now);
 expect(view.daily.todayConnected).toBe(1);expect(view.reactionsReceived).toBe(1);
});
it.each(['8','32','manager','unauthorized'])('checks context command authority at execution (%s)',async authority=>{
 const ctx=await setup();ctx.discord.members.get(helper)!.permissions=authority==='8'||authority==='32'?authority:'0';ctx.discord.members.get(helper)!.roles=authority==='manager'?[managerRole]:[];
 const request={...job(),command:'contextExplain',targetMessageId:messageId};
 if(authority==='unauthorized')await expect(ctx.worker.dispatch(ctx.s,request)).rejects.toThrow('ADMIN_REQUIRED');
 else expect(JSON.stringify(await ctx.worker.dispatch(ctx.s,request))).toContain('Message detection');
});
it('opens private settings, binds follow-up controls to the actor and panel, and rejects unauthorized and stale edits',async()=>{
 const ctx=await setup(),revision=(await ctx.settings.get(ctx.s)).revision;
 const open=await ctx.tokens.issue(db,ctx.s,{action:'controlSettings',section:'notifications',privateSettings:true},null);
 expect(Components.kind(open)).toBe('ephemeral');
 const view=await ctx.worker.dispatch(ctx.s,{...job(),messageId:root,customId:open,privateResponse:true});
 const controls:string[]=[];function ids(node:unknown){if(!node||typeof node!=='object')return;if('custom_id' in node)controls.push(String(node.custom_id));Object.values(node).forEach(value=>Array.isArray(value)?value.forEach(ids):ids(value));}ids(view);
 const followups=await Promise.all(controls.map(token=>ctx.tokens.read(db,ctx.s,token,vault.hash(ctx.s,helper))));
 expect(followups.every(intent=>intent.privateSettings===true&&intent.panelMessageId===root)).toBe(true);
 await expect(ctx.tokens.read(db,ctx.s,controls[0]!,vault.hash(ctx.s,newcomer))).rejects.toThrow('COMPONENT_OWNER');
 const save=await ctx.tokens.issue(db,ctx.s,{action:'controlNotificationSave',privateSettings:true,panelMessageId:root,revision},vault.hash(ctx.s,helper));
 await ctx.worker.dispatch(ctx.s,{...job(),customId:save,fields:{minutes:'35',enabled:'ON'},privateResponse:true});
 expect(await ctx.settings.get(ctx.s)).toMatchObject({firstResponseMinutes:35,helperEnabled:true});
 await expect(ctx.worker.dispatch(ctx.s,{...job(),customId:save,fields:{minutes:'45',enabled:'OFF'},privateResponse:true})).rejects.toThrow('REVISION_CONFLICT');
 await expect(ctx.worker.dispatch(ctx.s,{...job(newcomer),messageId:root,customId:open,privateResponse:true})).rejects.toThrow('ADMIN_REQUIRED');
 await sql`UPDATE settings_panels SET message_id='766666666666666667' WHERE ${tenant(ctx.s)}`.execute(db);
 await expect(ctx.worker.dispatch(ctx.s,{...job(),customId:save,fields:{minutes:'45',enabled:'OFF'},privateResponse:true})).rejects.toThrow('COMPONENT_EXPIRED');
});
it('opens notification modals through signed HTTP and defers private settings without updating the public panel',async()=>{
 const ctx=await setup(),keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 const app=createInteractionServer({db,vault,components:ctx.tokens,publicKey,applicationId:'777777777777777777'});
 async function send(custom_id:string,type=3){
  const body=JSON.stringify({id:String(788888888888888880n+BigInt(++counter)),application_id:'777777777777777777',type,token:'test-only',guild_id:ctx.s.guildId,channel_id:channel,member:{user:{id:helper},permissions:'8',roles:[]},message:{id:root},data:{custom_id}}),timestamp=String(Math.floor(Date.now()/1000));
  return app.inject({method:'POST',url:'/interactions',payload:body,headers:{'content-type':'application/json','x-signature-timestamp':timestamp,'x-signature-ed25519':sign(null,Buffer.from(timestamp+body),keys.privateKey).toString('hex')}});
 }
 const modal=await ctx.tokens.issue(db,ctx.s,{action:'controlNotificationEdit',privateSettings:true,panelMessageId:root,revision:(await ctx.settings.get(ctx.s)).revision},vault.hash(ctx.s,helper));
 const response=await send(modal);expect(response.json()).toMatchObject({type:9,data:{components:expect.any(Array)}});
 expect(response.json().data.components).toHaveLength(2);
 const privateToken=await ctx.tokens.issue(db,ctx.s,{action:'controlSettings',section:'goals',privateSettings:true},null);
 expect((await send(privateToken)).json()).toEqual({type:5,data:{flags:64}});
 await new Promise(resolve=>setTimeout(resolve,40));await app.close();
});
