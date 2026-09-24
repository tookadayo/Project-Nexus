import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {apiToken,scopeForGuild} from '../../../../packages/security/src/scoping';

export type AuthorizedGuild={id:string;name:string};
type Session={accessToken:string;userId:string;expiresAt:number};
export const authMode=()=>process.env.NEXUS_WEB_AUTH_MODE==='development'?'development':'oauth';
export const oauthRedirectUri=()=>new URL('/auth/callback',process.env.NEXUS_WEB_URL).toString();
export const secureCookies=()=>process.env.NEXUS_WEB_URL?.startsWith('https://')??false;
const key=()=>{const secret=process.env.NEXUS_SESSION_SECRET;if(!secret||secret.length<32)throw new Error('NEXUS_SESSION_SECRET must be at least 32 characters');return createHash('sha256').update(secret).digest();};
export function sealSession(session:Session){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv),data=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
export function openSession(value:string|undefined):Session|null{if(!value)return null;try{const bytes=Buffer.from(value,'base64url');if(bytes.length<30)return null;const decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));const session=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString()) as Session;if(!session.accessToken||!session.userId||!Number.isFinite(session.expiresAt)||session.expiresAt<Date.now())return null;return session;}catch{return null;}}
export function validOAuthState(expected:string|undefined,received:string|null){if(!expected||!received)return false;const a=Buffer.from(expected),b=Buffer.from(received);return a.length===b.length&&timingSafeEqual(a,b);}
export async function authorizedGuilds(token:string):Promise<AuthorizedGuild[]>{
 const response=await fetch('https://discord.com/api/v10/users/@me/guilds',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('DISCORD_GUILDS_UNAVAILABLE');
 const rows=await response.json() as {id:string;name:string;owner?:boolean;permissions?:string}[];
 return rows.filter(row=>row.owner===true||((BigInt(row.permissions??'0')&32n)!==0n)||((BigInt(row.permissions??'0')&8n)!==0n)).map(row=>({id:row.id,name:row.name}));
}
export async function dashboardContext(sessionCookie:string|undefined,guildCookie:string|undefined){
 const base=process.env.NEXUS_API_URL??'http://127.0.0.1:3001';
 if(authMode()==='development'){
  const {NEXUS_ORGANIZATION_ID,NEXUS_GUILD_ID,NEXUS_API_TOKEN}=process.env;
  if(!NEXUS_ORGANIZATION_ID||!NEXUS_GUILD_ID||!NEXUS_API_TOKEN)return null;
  return {base,organizationId:NEXUS_ORGANIZATION_ID,guildId:NEXUS_GUILD_ID,token:NEXUS_API_TOKEN,guilds:[{id:NEXUS_GUILD_ID,name:'Development guild'}],userId:'development'};
 }
 const session=openSession(sessionCookie);if(!session)return null;
 const guilds=await authorizedGuilds(session.accessToken);
 const selected=guilds.find(guild=>guild.id===guildCookie)??guilds[0];if(!selected)return null;
 if(!process.env.API_KEY)throw new Error('API_KEY is required for OAuth dashboard access');
 const scope=scopeForGuild(selected.id);
 return {base,organizationId:scope.organizationId,guildId:scope.guildId,token:apiToken(process.env.API_KEY,scope),guilds,userId:session.userId};
}
