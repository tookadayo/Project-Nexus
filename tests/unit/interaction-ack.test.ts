import {generateKeyPairSync,sign} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Interaction} from 'discord.js';
import type {Database} from '../../packages/db/src/index.js';
import type {IdentityVault} from '../../packages/identity/src/index.js';
import {Components} from '../../packages/security/src/index.js';
import {handleGatewayInteraction,createInteractionServer} from '../../apps/interaction/src/server.js';

it('acknowledges a Gateway command before a blocked database and reports a queue failure',async()=>{
 const order:string[]=[],editReply=vi.fn(async()=>{});
 let rejectDatabase:(error:Error)=>void=()=>{};
 const blocked=new Promise<never>((_resolve,reject)=>{rejectDatabase=reject;});
 const db={transaction:()=>({execute:()=>{order.push('database');return blocked;}})} as unknown as Database;
 const input={inGuild:()=>true,guildId:'111111111111111111',user:{id:'222222222222222222'},isChatInputCommand:()=>true,isMessageComponent:()=>false,isModalSubmit:()=>false,isStringSelectMenu:()=>false,
  id:'333333333333333333',applicationId:'444444444444444444',token:'secret',channelId:'555555555555555555',commandName:'nexus',options:{getSubcommand:()=> 'panel'},locale:'en-US',guildLocale:'en-US',
  deferReply:vi.fn(async()=>{order.push('ack');}),editReply} as unknown as Interaction;
 const work=handleGatewayInteraction(input,{db,vault:{} as IdentityVault,components:new Components('test')});
 await vi.waitFor(()=>expect(order).toEqual(['ack','database']));
 expect(editReply).not.toHaveBeenCalled();
 rejectDatabase(new Error('offline'));await work;
 expect(editReply).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('Try again')}));
});

it('sends the signed HTTP ACK before database work completes',async()=>{
 const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 let rejectDatabase:(error:Error)=>void=()=>{};
 const blocked=new Promise<never>((_resolve,reject)=>{rejectDatabase=reject;});
 const db={transaction:()=>({execute:()=>blocked})} as unknown as Database,editReply=vi.fn(async()=>{});
 const app=createInteractionServer({db,vault:{} as IdentityVault,publicKey,applicationId:'111111111111111111',discord:{editReply} as never});
 const data={id:'222222222222222222',application_id:'111111111111111111',type:2,token:'secret',guild_id:'333333333333333333',member:{user:{id:'444444444444444444'},permissions:'32',roles:[]},data:{name:'nexus',options:[{name:'panel'}]}};
 const body=JSON.stringify(data),timestamp=String(Math.floor(Date.now()/1000));
 const start=performance.now(),response=await app.inject({method:'POST',url:'/interactions',payload:body,headers:{'content-type':'application/json','x-signature-timestamp':timestamp,'x-signature-ed25519':sign(null,Buffer.from(timestamp+body),keys.privateKey).toString('hex')}});
 expect(response.json()).toEqual({type:5,data:{flags:64}});
 expect(performance.now()-start).toBeLessThan(1000);
 rejectDatabase(new Error('offline'));
 await vi.waitFor(()=>expect(editReply).toHaveBeenCalledTimes(1));
 await app.close();
});

it('uses explicit component prefixes only for immediate modal and navigation callbacks',()=>{
 expect(Components.kind('modal:token')).toBe('modal');
 expect(Components.kind('nav:token')).toBe('navigation');
 expect(Components.kind('token')).toBe('ordinary');
});
