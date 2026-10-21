import {afterEach,expect,it,vi} from 'vitest';
import {DiscordRest,type AutomationDiscordWrite} from '../../packages/discord/src/rest';
import {buildDiscordMessage} from '../../packages/automation/src/message';
import {validateCompiledLegacyMessage} from '../../packages/discord/src/automation-message';
const guild='891111111111111111',channel='892222222222222222',message='893333333333333333',bot='894444444444444444';
const body=()=>validateCompiledLegacyMessage(buildDiscordMessage({kind:'legacy',richText:[{kind:'bold',children:[{kind:'text',text:'safe *text* @everyone'}]}],embeds:[{title:'Status',fields:[{name:'Version',value:'2',inline:true}]}]}));
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('sends only validated compiled Legacy fields and keeps mentions off',async()=>{
  const fetcher=vi.fn(async()=>response({id:message})),before=vi.fn(async()=>{});vi.stubGlobal('fetch',fetcher);
  expect(await new DiscordRest('synthetic-token',bot).automationWrite({kind:'message',guildId:guild,channelId:channel,messageSpec:body(),nonce:'a'.repeat(25)},before)).toBe(message);
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe(`https://discord.com/api/v10/channels/${channel}/messages`);expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({...body(),nonce:'a'.repeat(25),enforce_nonce:true});
  expect(before).toHaveBeenCalledTimes(1);
});
it('edits the fixed owned-message route and clears previously omitted text and embeds',async()=>{
  const fetcher=vi.fn(async()=>response({id:message}));vi.stubGlobal('fetch',fetcher);const rest=new DiscordRest('synthetic-token',bot),before=vi.fn(async()=>{});
  await rest.automationWrite({kind:'editMessage',guildId:guild,channelId:channel,messageId:message,messageSpec:validateCompiledLegacyMessage(buildDiscordMessage({kind:'legacy',embeds:[{description:'replacement'}]}))},before);
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe(`https://discord.com/api/v10/channels/${channel}/messages/${message}`);expect(init.method).toBe('PATCH');
  expect(JSON.parse(String(init.body))).toEqual({content:'',embeds:[{description:'replacement'}],allowed_mentions:{parse:[],users:[],roles:[],replied_user:false}});
  await rest.automationWrite({kind:'editMessage',guildId:guild,channelId:channel,messageId:message,content:'plain replacement'},before);
  expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string,RequestInit])[1].body))).toMatchObject({content:'plain replacement',embeds:[]});
});
it.each(['components','flags','attachments','files','username','webhook_id'])('rejects arbitrary Discord JSON field %s before dispatch',async field=>{
  const fetcher=vi.fn(),before=vi.fn(async()=>{});vi.stubGlobal('fetch',fetcher);
  const bad={...body(),[field]:[]};
  await expect(new DiscordRest('synthetic-token',bot).automationWrite({kind:'message',guildId:guild,channelId:channel,messageSpec:bad,nonce:'safe'},before)).rejects.toThrow();
  expect(before).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it('rejects caller ownership flags, mixed bodies, invalid embeds and mention grants',async()=>{
  const fetcher=vi.fn(),before=vi.fn(async()=>{});vi.stubGlobal('fetch',fetcher);const rest=new DiscordRest('synthetic-token',bot);
  for(const input of [
    {kind:'editMessage',guildId:guild,channelId:channel,messageId:message,content:'text',owned:true},
    {kind:'editMessage',guildId:guild,channelId:channel,messageId:message,content:'text',messageSpec:body()},
    {kind:'message',guildId:guild,channelId:channel,nonce:'safe',messageSpec:{...body(),allowed_mentions:{parse:['everyone'],users:[],roles:[],replied_user:false}}},
    {kind:'message',guildId:guild,channelId:channel,nonce:'safe',messageSpec:{...body(),embeds:[{description:'text',url:'http://unsafe.example'}]}},
  ])await expect(rest.automationWrite(input as AutomationDiscordWrite,before)).rejects.toThrow();
  expect(before).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it.each(['network','server','json','wrongId'])('never repeats an ambiguous owned-message PATCH: %s',async failure=>{
  const fetcher=vi.fn(async()=>{if(failure==='network')throw new TypeError('synthetic offline');if(failure==='server')return response({},503);if(failure==='json')return new Response('{',{status:200});return response({id:channel});});vi.stubGlobal('fetch',fetcher);
  await expect(new DiscordRest('synthetic-token',bot).automationWrite({kind:'editMessage',guildId:guild,channelId:channel,messageId:message,content:'safe'},async()=>{})).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
});
