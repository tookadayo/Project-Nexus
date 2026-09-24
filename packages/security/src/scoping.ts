import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
export type GuildScope={organizationId:string;guildId:string};
export function scopeForGuild(guildId:string):GuildScope {
 if(!/^\d{17,20}$/.test(guildId))throw new Error('INVALID_GUILD');
 const hex=createHash('sha256').update(`nexus:organization:${guildId}`).digest('hex');
 return {organizationId:`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`,guildId};
}
export function apiToken(key:string,s:GuildScope){return createHmac('sha256',key).update(`${s.organizationId}:${s.guildId}`).digest('base64url');}
export function validApiToken(key:string,s:GuildScope,token:string){const expected=Buffer.from(apiToken(key,s)),actual=Buffer.from(token);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
