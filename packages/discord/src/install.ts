/** View Channel, Send Messages, Embed Links, Read Message History. */
export const BASIC_BOT_PERMISSIONS=1024n|2048n|16384n|65536n;
export const BASIC_BOT_SCOPES='bot applications.commands';
export function discordInstallUrl(applicationId:string,guildId?:string){
 if(!/^\d{17,20}$/.test(applicationId))throw new Error('INVALID_APPLICATION_ID');
 if(guildId&&!/^\d{17,20}$/.test(guildId))throw new Error('INVALID_GUILD_ID');
 const url=new URL('https://discord.com/oauth2/authorize');url.searchParams.set('client_id',applicationId);url.searchParams.set('scope',BASIC_BOT_SCOPES);url.searchParams.set('permissions',BASIC_BOT_PERMISSIONS.toString());
 if(guildId){url.searchParams.set('guild_id',guildId);url.searchParams.set('disable_guild_select','true');}
 return url.toString();
}
