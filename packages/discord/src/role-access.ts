import {z} from "zod";
import {PermissionFlagsBits,ChannelFlags} from "discord-api-types/v10";
import {assert} from "../../shared/src/index";

const snowflake=z.string().regex(/^\d{17,20}$/),bits=z.string().regex(/^(0|[1-9]\d{0,77})$/).refine(value=>BigInt(value)<(1n<<256n));
export const roleChannelMetadataSchema=z.object({guildId:snowflake,channelId:snowflake,type:z.number().int().nonnegative(),parentId:snowflake.nullable(),
  obfuscated:z.boolean(),memberOverwritePresent:z.boolean(),observedAt:z.iso.datetime(),
  roles:z.array(z.object({id:snowflake,permissions:bits}).strict()).max(250),
  roleOverwrites:z.array(z.object({roleId:snowflake,allow:bits,deny:bits}).strict()).max(1000),
}).strict();
export type RoleChannelMetadata=z.infer<typeof roleChannelMetadataSchema>;
/** Boundary codec discards every member overwrite ID/value without copying it
 * into a DTO/hash/storage. Only their presence survives as an ambiguity bit. */
export function roleChannelMetadata(guildId:string,channelId:string,rawChannel:unknown,rawRoles:unknown,observedAt=new Date()):RoleChannelMetadata{
  snowflake.parse(guildId);snowflake.parse(channelId);
  const channel=z.object({id:snowflake,guild_id:snowflake,type:z.number().int().nonnegative(),parent_id:snowflake.nullable().optional(),flags:z.number().int().nonnegative().optional(),permission_overwrites:z.array(z.unknown()).max(1000)}).parse(rawChannel);
  assert(channel.guild_id===guildId&&channel.id===channelId,"ROLE_ACCESS_GUILD_MISMATCH",403);
  const roles=z.array(z.object({id:snowflake,permissions:bits})).max(250).parse(rawRoles).map(role=>({id:role.id,permissions:role.permissions}));
  const roleOverwrites:RoleChannelMetadata["roleOverwrites"]=[];let memberOverwritePresent=false;
  for(const raw of channel.permission_overwrites){
    assert(raw&&typeof raw==="object"&&!Array.isArray(raw),"ROLE_ACCESS_METADATA_INVALID",409);
    const type=(raw as {type?:unknown}).type;
    if(type===1){memberOverwritePresent=true;continue;}
    assert(type===0,"ROLE_ACCESS_METADATA_INVALID",409);
    const row=z.object({type:z.literal(0),id:snowflake,allow:bits,deny:bits}).parse(raw);
    roleOverwrites.push({roleId:row.id,allow:row.allow,deny:row.deny});
  }
  const value=roleChannelMetadataSchema.parse({guildId,channelId,type:channel.type,parentId:channel.parent_id??null,obfuscated:Boolean((channel.flags??0)&ChannelFlags.ChannelObfuscated),memberOverwritePresent,observedAt:observedAt.toISOString(),
    roles:roles.sort((a,b)=>a.id.localeCompare(b.id)),roleOverwrites:roleOverwrites.sort((a,b)=>a.roleId.localeCompare(b.roleId))});
  assert(new Set(value.roles.map(role=>role.id)).size===value.roles.length&&value.roles.some(role=>role.id===guildId)
    &&new Set(value.roleOverwrites.map(row=>row.roleId)).size===value.roleOverwrites.length&&value.roleOverwrites.every(row=>value.roles.some(role=>role.id===row.roleId)),"ROLE_ACCESS_COVERAGE_INCOMPLETE",409);
  return value;
}
function roleBits(metadata:RoleChannelMetadata,representativeRoleIds:readonly string[]){
  assert(new Set(representativeRoleIds).size===representativeRoleIds.length&&representativeRoleIds.length<=8&&representativeRoleIds.every(id=>metadata.roles.some(role=>role.id===id)),"ROLE_ACCESS_REPRESENTATIVE_UNAVAILABLE",409);
  const selected=new Set([metadata.guildId,...representativeRoleIds]);
  let permissions=metadata.roles.filter(role=>selected.has(role.id)).reduce((value,role)=>value|BigInt(role.permissions),0n);
  const administrator=Boolean(permissions&PermissionFlagsBits.Administrator);
  if(administrator)return {administrator,view:true,send:true};
  const everyone=metadata.roleOverwrites.find(row=>row.roleId===metadata.guildId);
  if(everyone)permissions=(permissions&~BigInt(everyone.deny))|BigInt(everyone.allow);
  let deny=0n,allow=0n;
  for(const overwrite of metadata.roleOverwrites)if(overwrite.roleId!==metadata.guildId&&selected.has(overwrite.roleId)){deny|=BigInt(overwrite.deny);allow|=BigInt(overwrite.allow);}
  permissions=(permissions&~deny)|allow;
  return {administrator,view:Boolean(permissions&PermissionFlagsBits.ViewChannel),send:Boolean(permissions&PermissionFlagsBits.SendMessages)};
}
/** A complete representative role composition, never a measured individual.
 * Member exceptions cannot be resolved without person data: keep UNKNOWN unless
 * Administrator's explicit bypass mathematically excludes their influence. */
export function projectRoleChannelAccess(input:RoleChannelMetadata,representativeRoleIds:readonly string[]){
  const metadata=roleChannelMetadataSchema.parse(input),representative=roleBits(metadata,representativeRoleIds),everyone=roleBits(metadata,[]);
  const unsupported=metadata.obfuscated||[10,11,12].includes(metadata.type),ambiguous=metadata.memberOverwritePresent&&!representative.administrator;
  return {basis:"REPRESENTATIVE_ROLE_SET_ONLY" as const,representativeRoleIds:[...representativeRoleIds].sort(),
    access:unsupported||ambiguous?null:!representative.view?"NO_ACCESS" as const:!representative.send?"WRITE_DENIED" as const:"ALLOWED" as const,
    visibility:unsupported||ambiguous?null:representative.view?"ALLOWED" as const:"RESTRICTED" as const,
    reportPermission:unsupported||metadata.memberOverwritePresent&&!everyone.administrator?null:everyone.view?"PUBLIC" as const:representative.view?"RESTRICTED" as const:null,
    reasonCode:unsupported?"ROLE_ACCESS_CHANNEL_KIND_UNSUPPORTED":ambiguous?"MEMBER_EXCEPTIONS_UNRESOLVED":null};
}
