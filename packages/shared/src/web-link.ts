export function discordDashboardLink(configured:string|undefined,guildId:string,development=false):string|undefined{
 if(!configured||!/^\d{17,20}$/.test(guildId))return undefined;
 try{
  const url=new URL(configured);
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  const local=host==='localhost'||host.endsWith('.localhost')||host==='0.0.0.0'||/^127(?:\.\d{1,3}){3}$/.test(host)||host==='::1'||host==='[::1]';
  if(url.username||url.password||url.search||url.hash||(!development&&url.protocol!=='https:'))return undefined;
  if(local&&!development)return undefined;
  if(!['https:','http:'].includes(url.protocol))return undefined;
  return new URL(`/dashboard/${guildId}`,url).toString();
 }catch{return undefined;}
}
