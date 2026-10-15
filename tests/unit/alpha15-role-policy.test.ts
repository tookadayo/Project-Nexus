import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PermissionFlagsBits as P} from 'discord-api-types/v10';
import {DiscordRest,type Member,type Role} from '../../packages/discord/src/rest';
import {evaluateAutomationRolePolicy,type AutomationRolePolicyInput,type RolePolicyChannel} from '../../packages/discord/src/automation-role-policy';
import {observeRoleCoverage,disconnectRoleCoverage,resetRoleCoverage,roleCoverage,assertRoleCoverage} from '../../packages/discord/src/role-coverage';
const guild='811111111111111111',bot='822222222222222222',requester='833333333333333333',approver='844444444444444444',target='855555555555555555',role='866666666666666666',managerRole='877777777777777777',channel='888888888888888888',owner='899999999999999999';
const input:AutomationRolePolicyInput={guildId:guild,memberId:target,roleId:role,add:true,requesterId:requester,approverId:approver,protectedRoleIds:[]};
const ordinary=P.ViewChannel|P.SendMessages|P.ReadMessageHistory;
function fixture(){
  const roles:Role[]=[{id:guild,position:0,managed:false,permissions:'0'},{id:role,position:2,managed:false,permissions:String(ordinary)},{id:managerRole,position:10,managed:false,permissions:String(ordinary|P.ManageRoles)}];
  const member=(manager=false,isBot=false):Member=>({roles:manager?[managerRole]:[],permissions:String(manager?ordinary|P.ManageRoles:0n),bot:isBot,joinedAt:'2026-10-01T00:00:00Z',ownerId:owner});
  const members={requester:member(true),approver:member(true),target:member(),bot:member(true,true)};
  const channels:RolePolicyChannel[]=[{id:channel,guild_id:guild,type:0,permission_overwrites:[]}];
  return {roles,members,channels,run:(value:AutomationRolePolicyInput=input)=>evaluateAutomationRolePolicy(value,bot,roles,members,channels)};
}
beforeEach(resetRoleCoverage);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();resetRoleCoverage();});
it('allows explicitly approved ordinary access capabilities and fixes their semantic digest',()=>{
  const f=fixture(),first=f.run();expect(first.changedChannelCount).toBe(1);expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(f.run().fingerprint).toBe(first.fingerprint);
  f.channels[0]!.permission_overwrites=[{id:role,type:0,allow:String(P.AttachFiles),deny:'0'}];
  // The requester and approver must themselves possess a newly granted bit.
  expect(()=>f.run()).toThrowError(expect.objectContaining({code:'AUTOMATION_ROLE_CHANNEL_PERMISSION'}));
  f.roles[2]!.permissions=String(ordinary|P.ManageRoles|P.AttachFiles);
  f.members.requester.permissions=f.roles[2]!.permissions;f.members.approver.permissions=f.roles[2]!.permissions;f.members.bot.permissions=f.roles[2]!.permissions;
  expect(f.run().fingerprint).not.toBe(first.fingerprint);
});
it('evaluates role removal as a possible access grant through an existing deny',()=>{
  const f=fixture();f.roles[0]!.permissions=String(ordinary);f.roles[1]!.permissions='0';f.members.target.roles=[role];
  f.channels[0]!.permission_overwrites=[{id:role,type:0,allow:'0',deny:String(P.ViewChannel)}];
  expect(f.run({...input,add:false}).changedChannelCount).toBe(1);
  f.channels[0]!.permission_overwrites.push({id:approver,type:1,allow:'0',deny:String(P.ViewChannel)});
  expect(()=>f.run({...input,add:false})).toThrowError(expect.objectContaining({code:'AUTOMATION_ROLE_CHANNEL_PERMISSION'}));
});
it.each([P.Administrator,P.ManageGuild,P.ManageRoles,P.ManageChannels,P.ManageMessages,P.ModerateMembers,P.KickMembers,P.BanMembers,1n<<61n])('rejects administrative or unknown role capabilities %s',permission=>{
  const f=fixture();f.roles[1]!.permissions=String(permission);expect(()=>f.run()).toThrowError(expect.objectContaining({code:'PRIVILEGED_ROLE_MAPPING_FORBIDDEN'}));
});
it('rejects administrative overwrite changes, including a deny removed by removing the role',()=>{
  const f=fixture();f.channels[0]!.permission_overwrites=[{id:role,type:0,allow:'0',deny:String(P.ManageMessages)}];
  expect(()=>f.run()).toThrowError(expect.objectContaining({code:'PRIVILEGED_ROLE_MAPPING_FORBIDDEN'}));
});
it('does not activate a target existing administrative capabilities by granting channel visibility',()=>{
  const f=fixture();f.roles.push({id:'811222222222222222',position:1,managed:false,permissions:String(P.ManageMessages)});f.members.target.roles=['811222222222222222'];
  expect(()=>f.run()).toThrowError(expect.objectContaining({code:'AUTOMATION_ROLE_PRIVILEGE_GAIN'}));
});
it.each(['requester','approver','bot'] as const)('requires current native management authority and hierarchy for %s',person=>{
  const f=fixture();f.members[person].permissions=String(ordinary);
  expect(()=>f.run()).toThrowError(expect.objectContaining({code:person==='bot'?'AUTOMATION_BOT_PERMISSION':'AUTOMATION_ROLE_NATIVE_PERMISSION'}));
  f.members[person].permissions=String(P.Administrator);f.members[person].roles=[role];
  expect(()=>f.run()).toThrowError(expect.objectContaining({code:'ROLE_NOT_MANAGEABLE'}));
});
it('protects owners, bots, current high members, integration roles and configured NEXUS roles',()=>{
  const f=fixture();f.members.target.ownerId=target;expect(()=>f.run()).toThrow();f.members.target.ownerId=owner;
  f.members.target.bot=true;expect(()=>f.run()).toThrow();f.members.target.bot=false;
  f.members.target.roles=[managerRole];expect(()=>f.run()).toThrowError(expect.objectContaining({code:'ROLE_NOT_MANAGEABLE'}));f.members.target.roles=[];
  f.roles[1]!.tags={integration_id:managerRole};expect(()=>f.run()).toThrowError(expect.objectContaining({code:'ROLE_NOT_MANAGEABLE'}));delete f.roles[1]!.tags;
  f.roles[1]!.managed=true;expect(()=>f.run()).toThrow();f.roles[1]!.managed=false;
  expect(()=>f.run({...input,protectedRoleIds:[role]})).toThrowError(expect.objectContaining({code:'AUTOMATION_ROLE_PROTECTED'}));
});
function census(channels:unknown[]=[{id:channel,type:0}]){observeRoleCoverage({t:'GUILD_CREATE',d:{id:guild,channels}},0);}
it('requires the complete live Gateway census and rejects HTTP omissions, obfuscation and disconnect',()=>{
  expect(()=>roleCoverage(guild)).toThrow();census();const first=roleCoverage(guild);assertRoleCoverage(guild,first,[channel]);
  expect(()=>assertRoleCoverage(guild,first,[])).toThrowError(expect.objectContaining({code:'AUTOMATION_ROLE_COVERAGE_CHANGED'}));
  observeRoleCoverage({t:'CHANNEL_UPDATE',d:{guild_id:guild,id:channel,flags:1<<17}},0);expect(()=>roleCoverage(guild)).toThrow();
  census();disconnectRoleCoverage(0);expect(()=>roleCoverage(guild)).toThrow();
  census([{id:channel,flags:1<<17}]);expect(()=>roleCoverage(guild)).toThrow();
});
it('tracks channel changes and fences in-flight permissions checks across a change',()=>{
  census();const first=roleCoverage(guild);observeRoleCoverage({t:'CHANNEL_UPDATE',d:{guild_id:guild,id:channel,type:0}},0);
  expect(()=>assertRoleCoverage(guild,first,[channel])).toThrowError(expect.objectContaining({code:'AUTOMATION_ROLE_COVERAGE_CHANGED'}));
  observeRoleCoverage({t:'CHANNEL_DELETE',d:{guild_id:guild,id:channel}},0);expect(roleCoverage(guild).channelIds).toEqual([]);
  observeRoleCoverage({t:'GUILD_DELETE',d:{id:guild}},0);expect(()=>roleCoverage(guild)).toThrow();
});
it('uses current native membership and exact complete HTTP metadata in REST preflight',async()=>{
  const f=fixture(),rest=new DiscordRest('synthetic-token',bot);census();
  vi.spyOn(rest,'roles').mockResolvedValue(f.roles);vi.spyOn(rest,'member').mockImplementation(async(_guild,id)=>id===bot?f.members.bot:id===requester?f.members.requester:id===approver?f.members.approver:f.members.target);
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(f.channels),{status:200}));vi.stubGlobal('fetch',fetcher);
  expect((await rest.automationRolePreflight(input)).changedChannelCount).toBe(1);
  fetcher.mockResolvedValue(new Response('[]',{status:200}));await expect(rest.automationRolePreflight(input)).rejects.toMatchObject({code:'AUTOMATION_ROLE_COVERAGE_CHANGED'});
});
