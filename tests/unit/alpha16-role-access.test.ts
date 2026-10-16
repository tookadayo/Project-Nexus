import {describe,expect,it} from "vitest";
import {PermissionFlagsBits as P} from "discord-api-types/v10";
import {roleChannelMetadata,roleChannelMetadataSchema,projectRoleChannelAccess} from "../../packages/discord/src/role-access";
import {roleAccessSourceConfig,createRoleAccessSourcePlugin} from "../../packages/rules/src/role-access-source";
const guild="111111111111111111",channel="222222222222222222",role="333333333333333333",other="444444444444444444",person="555555555555555555";
const at=new Date("2026-10-16T12:00:00Z"),view=P.ViewChannel,send=P.SendMessages;
const raw=(overwrites:unknown[]=[],type=0)=>({id:channel,guild_id:guild,type,parent_id:null,permission_overwrites:overwrites});
const roles=(base=0n,chosen=0n)=>[{id:guild,permissions:String(base),name:"discard me"},{id:role,permissions:String(chosen)},{id:other,permissions:"0"}];
describe("role-only permission observation boundary",()=>{
  it("discards every member overwrite identifier/value, retaining only ambiguity",()=>{
    const metadata=roleChannelMetadata(guild,channel,raw([{type:1,id:person,allow:"person-secret",deny:{raw:"discard without parsing"}}]),roles(view|send),at);
    const encoded=JSON.stringify(metadata);expect(encoded).not.toContain(person);expect(encoded).not.toContain("person-secret");expect(encoded).not.toContain("discard me");
    expect(metadata.memberOverwritePresent).toBe(true);
    expect(projectRoleChannelAccess(metadata,[])).toMatchObject({access:null,visibility:null,reportPermission:null,reasonCode:"MEMBER_EXCEPTIONS_UNRESOLVED"});
  });
  it("uses role union after everyone override and lets explicit role allow beat another selected deny",()=>{
    const metadata=roleChannelMetadata(guild,channel,raw([{type:0,id:guild,allow:"0",deny:String(view|send)},
      {type:0,id:role,allow:String(view),deny:String(send)},{type:0,id:other,allow:String(send),deny:"0"}]),roles(view|send),at);
    expect(projectRoleChannelAccess(metadata,[role])).toMatchObject({access:"WRITE_DENIED",visibility:"ALLOWED",reportPermission:"RESTRICTED"});
    expect(projectRoleChannelAccess(metadata,[role,other]).access).toBe("ALLOWED");
    expect(projectRoleChannelAccess(metadata,[])).toMatchObject({access:"NO_ACCESS",visibility:"RESTRICTED",reportPermission:null});
  });
  it("permits the role Administrator bypass but does not infer public visibility from a chosen administrator",()=>{
    const metadata=roleChannelMetadata(guild,channel,raw([{type:1,id:person,allow:"0",deny:String(view)}]),roles(0n,P.Administrator),at);
    expect(projectRoleChannelAccess(metadata,[role])).toMatchObject({access:"ALLOWED",visibility:"ALLOWED",reportPermission:null});
  });
  it("rejects cross-guild, incomplete, duplicate and missing representative metadata",()=>{
    expect(()=>roleChannelMetadata(guild,channel,{...raw(),guild_id:other},roles(),at)).toThrow("ROLE_ACCESS_GUILD_MISMATCH");
    expect(()=>roleChannelMetadata(guild,channel,raw(),[{id:role,permissions:"0"}],at)).toThrow("ROLE_ACCESS_COVERAGE_INCOMPLETE");
    expect(()=>roleChannelMetadata(guild,channel,raw([{type:0,id:person,allow:"0",deny:"0"}]),roles(),at)).toThrow("ROLE_ACCESS_COVERAGE_INCOMPLETE");
    const metadata=roleChannelMetadata(guild,channel,raw(),roles(view),at);
    expect(()=>projectRoleChannelAccess(metadata,[person])).toThrow("ROLE_ACCESS_REPRESENTATIVE_UNAVAILABLE");
    expect(()=>projectRoleChannelAccess(metadata,[role,role])).toThrow("ROLE_ACCESS_REPRESENTATIVE_UNAVAILABLE");
    expect(()=>roleChannelMetadataSchema.parse({...metadata,memberOverwrites:[{id:person}]})).toThrow();
  });
  it("does not apply text-channel permission arithmetic to private threads or obfuscated channels",()=>{
    for(const type of [10,11,12])expect(projectRoleChannelAccess(roleChannelMetadata(guild,channel,raw([],type),roles(view|send),at),[])).toMatchObject({access:null,visibility:null,reportPermission:null});
  });
  it("accepts only a finite declared role/channel config, with no observation, member or permission input",()=>{
    const value={destinationKind:"CASE_CHANNEL",channelId:channel,channelVersion:"a".repeat(64),representativeRoleIds:[role]};
    expect(roleAccessSourceConfig.parse(value)).toEqual(value);
    for(const extra of [{permissions:"8"},{memberId:person},{observedAt:at.toISOString()},{actualAccess:"ALLOWED"},{runtimeApproved:true}])expect(()=>roleAccessSourceConfig.parse({...value,...extra})).toThrow();
    expect(()=>roleAccessSourceConfig.parse({...value,representativeRoleIds:[role,role]})).toThrow();
    expect(()=>roleAccessSourceConfig.parse({...value,destinationKind:"NATIVE_ONBOARDING_OPTION"})).toThrow();
    const plugin=createRoleAccessSourcePlugin();expect(plugin.supportedFields).toEqual({CASE01:["onb.actualAccess"],CASE10:["channel.actualAccess"],CASE17:["reportChannel.actualPermission"]});
    expect(plugin.editorSchema).toBeDefined();expect(JSON.stringify(plugin.editorSchema)).not.toContain('"default":');
  });
});
