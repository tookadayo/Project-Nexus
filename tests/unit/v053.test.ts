import {afterEach,expect,it,vi} from 'vitest';
import {CommandRetry} from '../../scripts/command-retry.js';
import {DiscordRest} from '../../packages/discord/src/rest.js';
import {settingsSchema} from '../../packages/settings/src/index.js';

afterEach(()=>vi.unstubAllGlobals());

it('retries failed command registration with bounded exponential delays',()=>{
 const retry=new CommandRetry(10000,1800000),guild='111111111111111111';
 expect(retry.due(guild,0)).toBe(true);
 expect(retry.fail(guild,1000)).toBe(11000);expect(retry.due(guild,10999)).toBe(false);
 expect(retry.fail(guild,11000)).toBe(31000);expect(retry.due(guild,31000)).toBe(true);
 for(let i=0;i<20;i++)retry.fail(guild,31000);
 expect(retry.due(guild,31000+1800000-1)).toBe(false);
 retry.success(guild);expect(retry.due(guild,0)).toBe(true);
});

it('warns when regular members can view the panel channel',async()=>{
 const guild='111111111111111111',channel='222222222222222222';let visible=true;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('/channels/')?{guild_id:guild,permission_overwrites:visible?[]:[{id:guild,type:0,allow:'0',deny:'1024'}]}:[{id:guild,position:0,managed:false,permissions:'1024'}]),{status:200,headers:{'content-type':'application/json'}})));
 const discord=new DiscordRest('test','333333333333333333');expect(await discord.publicChannel(guild,channel)).toBe(true);
 visible=false;expect(await discord.publicChannel(guild,channel)).toBe(false);
});

it('reads v0.5.2 settings with safe v0.5.3 defaults',()=>{
 const cfg=settingsSchema.parse({analysisScope:{mode:'all',channelIds:[]}});
 expect(cfg.managerRoleIds).toEqual([]);expect(cfg.helperRoleIds).toEqual([]);expect(cfg.timezone).toBe('Asia/Tokyo');expect(cfg.firstResponseMinutes).toBe(20);
 expect(cfg.setupSteps).toEqual({scope:false,team:false,notifications:false,goals:false});
 expect(()=>settingsSchema.parse({timezone:'Invalid/Zone'})).toThrow();
});
