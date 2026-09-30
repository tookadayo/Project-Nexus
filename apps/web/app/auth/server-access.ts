import 'server-only';
import {connect} from '../../../../packages/db/src/index';
import {IdentityVault} from '../../../../packages/identity/src/index';
import {DiscordRest,isDiscordFailure} from '../../../../packages/discord/src/rest';
import {SettingsService} from '../../../../packages/settings/src/index';
import {Components} from '../../../../packages/security/src/index';
import {ServerAuthorization} from '../../../../packages/security/src/server-authorization';
import {ServerVerification} from '../../../../packages/security/src/server-verification';
import {scopeForGuild} from '../../../../packages/security/src/scoping';

// This module is reached exclusively from server pages and route handlers.
type Services={verification:ServerVerification;authority:ServerAuthorization;tokens:Components;vault:IdentityVault;db:ReturnType<typeof connect>};
const shared=globalThis as typeof globalThis&{nexusWebServices?:Services};
export function serverServices():Services{
 if(typeof window!=='undefined')throw new Error('SERVER_ONLY');
 if(shared.nexusWebServices)return shared.nexusWebServices;
 const {DATABASE_URL,IDENTITY_KEY,LOOKUP_KEY,COMPONENT_KEY,DISCORD_TOKEN,DISCORD_APPLICATION_ID}=process.env;
 if(!DATABASE_URL||!IDENTITY_KEY||!LOOKUP_KEY||!COMPONENT_KEY||!DISCORD_TOKEN||!DISCORD_APPLICATION_ID)throw new Error('SERVER_AUTHORIZATION_UNAVAILABLE');
 const db=connect(DATABASE_URL),vault=new IdentityVault(IDENTITY_KEY,LOOKUP_KEY),discord=new DiscordRest(DISCORD_TOKEN,DISCORD_APPLICATION_ID),authority=new ServerAuthorization(discord,new SettingsService(db),vault);
 return shared.nexusWebServices={db,vault,authority,tokens:new Components(COMPONENT_KEY),verification:new ServerVerification(db,vault,authority)};
}
export async function manageableConnection(guildId:string,userId:string){
 const s=scopeForGuild(guildId),services=serverServices();
 let snapshot;
 try{snapshot=await services.authority.snapshot(s,userId,'WEB_DASHBOARD','access-check');services.authority.require(snapshot);}
 catch(error){if(isDiscordFailure(error)&&[403,404].includes(error.status)||error instanceof Error&&error.message==='ADMIN_REQUIRED')return null;throw error;}
 return {...await services.verification.connection(s,userId),name:snapshot.member.guildName??guildId};
}
