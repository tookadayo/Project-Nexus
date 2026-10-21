import { assert } from '../../shared/src/index';

// Process-local metadata only. A fresh, complete Gateway guild payload is the
// census; HTTP alone cannot prove completeness after channel obfuscation.
type Census = {shardId:number;generation:number;channels:Set<string>;verified:boolean};
const guilds=new Map<string,Census>();
let generation=0;
const id=(value:unknown):value is string=>typeof value==='string'&&/^\d{17,20}$/.test(value);
const obfuscated=(value:unknown)=>typeof value!=='number'||!Number.isSafeInteger(value)||value<0||(BigInt(value)&(1n<<17n))!==0n;
type Packet={t?:string|null;d:unknown};

export function observeRoleCoverage(packet:Packet,shardId:number) {
  if(!packet.d||typeof packet.d!=='object'||Array.isArray(packet.d))return;
  const data=packet.d as Record<string,unknown>;
  if(packet.t==='READY'){disconnectRoleCoverage(shardId);return;}
  if(packet.t==='GUILD_DELETE'&&id(data.id)){guilds.delete(data.id);return;}
  if(packet.t==='GUILD_CREATE'&&id(data.id)){
    const channels=Array.isArray(data.channels)?data.channels:[];
    const ids=new Set<string>();let verified=data.unavailable!==true&&Array.isArray(data.channels);
    for(const raw of channels){
      if(!raw||typeof raw!=='object'||Array.isArray(raw)){verified=false;continue;}
      const channel=raw as Record<string,unknown>;
      if(!id(channel.id)||ids.has(channel.id)||obfuscated(channel.flags??0)){verified=false;continue;}
      ids.add(channel.id);
    }
    guilds.set(data.id,{shardId,generation:++generation,channels:ids,verified});return;
  }
  if(['GUILD_ROLE_CREATE','GUILD_ROLE_UPDATE','GUILD_ROLE_DELETE','GUILD_MEMBER_UPDATE','GUILD_UPDATE'].includes(packet.t??'')){
    const guildId=packet.t==='GUILD_UPDATE'?data.id:data.guild_id;
    if(id(guildId)){const census=guilds.get(guildId);if(census)census.generation=++generation;}
    return;
  }
  if(!['CHANNEL_CREATE','CHANNEL_UPDATE','CHANNEL_DELETE'].includes(packet.t??'')||!id(data.guild_id))return;
  const census=guilds.get(data.guild_id);if(!census)return;
  census.generation=++generation;
  if(census.shardId!==shardId||!id(data.id)){census.verified=false;return;}
  if(packet.t==='CHANNEL_DELETE')census.channels.delete(data.id);
  else {
    if(packet.t==='CHANNEL_UPDATE'&&!census.channels.has(data.id))census.verified=false;
    census.channels.add(data.id);
    if(obfuscated(data.flags??0))census.verified=false;
  }
}
export function disconnectRoleCoverage(shardId:number) {
  for(const census of guilds.values())if(census.shardId===shardId){census.verified=false;census.generation=++generation;}
}
export function resetRoleCoverage(){guilds.clear();generation++;}
export function roleCoverage(guildId:string){
  const census=guilds.get(guildId);
  assert(census?.verified,'AUTOMATION_ROLE_COVERAGE_UNVERIFIED',503);
  return {generation:census.generation,channelIds:[...census.channels].sort()};
}
export function assertRoleCoverage(guildId:string,expected:{generation:number;channelIds:string[]},channelIds:string[]) {
  const current=roleCoverage(guildId),sorted=[...channelIds].sort();
  assert(current.generation===expected.generation&&sorted.length===new Set(sorted).size&&JSON.stringify(current.channelIds)===JSON.stringify(sorted),'AUTOMATION_ROLE_COVERAGE_CHANGED',409);
}
