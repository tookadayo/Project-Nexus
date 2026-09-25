import Fastify from 'fastify';
import {z} from 'zod';
import {verifyInteraction,scopeForGuild,Components,canAdmin} from '../../../packages/security/src/index.js';
import {SettingsService} from '../../../packages/settings/src/index.js';
import {resolveLocale,t} from '../../../packages/discord-panels/src/index.js';
import {ensureGuild,sql,type Database,type Tx} from '../../../packages/db/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import type {Interaction} from 'discord.js';
import type {DiscordPort} from '../../../packages/discord/src/rest.js';
import type {Scope} from '../../../packages/shared/src/index.js';
import type {InteractionHealth} from './health.js';
const snowflake=z.string().regex(/^\d{17,20}$/);
const interaction=z.object({id:snowflake,application_id:snowflake,type:z.number(),token:z.string().min(1).max(2048),guild_id:snowflake,locale:z.string().max(20).optional(),guild_locale:z.string().max(20).optional(),
 channel_id:snowflake.optional(),member:z.object({user:z.object({id:snowflake}),permissions:z.string().regex(/^\d+$/),roles:z.array(snowflake)}),
 data:z.object({name:z.string().max(100).optional(),custom_id:z.string().max(100).optional(),values:z.array(z.string().max(100)).max(25).optional(),
 options:z.array(z.object({name:z.string().max(100)})).max(10).optional(),components:z.array(z.object({components:z.array(z.object({custom_id:z.string(),value:z.string().max(2000)}))})).max(5).optional()}),message:z.object({id:snowflake}).optional()});
export type InteractionJob={id:string,applicationId:string,token:string,userId:string,channelId?:string,messageId?:string,command?:string,customId?:string,values?:string[],fields?:Record<string,string>,locale?:string,guildLocale?:string};
type Diagnostic={id:string;kind:'command'|'component'|'modal';action:string;receivedAt:Date;acknowledgedAt:Date};
async function saveDiagnostic(tx:Tx,s:Scope,vault:IdentityVault,diagnostic:Diagnostic){
 await sql`INSERT INTO interaction_diagnostics(organization_id,guild_id,interaction_hash,kind,action,received_at,acknowledged_at,result)
 VALUES(${s.organizationId}::uuid,${s.guildId},${vault.hash(s,diagnostic.id)},${diagnostic.kind},${diagnostic.action.slice(0,80)},${diagnostic.receivedAt},${diagnostic.acknowledgedAt},'acknowledged')
 ON CONFLICT(organization_id,guild_id,interaction_hash) DO NOTHING`.execute(tx);
}
async function beforeDeadline<T>(work:Promise<T>,milliseconds:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work,new Promise<T>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('INTERACTION_ACK_DEADLINE')),milliseconds);})]);}
 finally{if(timer)clearTimeout(timer);}
}
export async function handleGatewayInteraction(input:Interaction,opts:{db:Database,vault:IdentityVault,components:Components,health?:InteractionHealth}){
 if(!input.inGuild()||!input.guildId||(!input.isChatInputCommand()&&!input.isMessageComponent()&&!input.isModalSubmit()))return;
 const receivedAt=new Date();opts.health?.received(receivedAt);
 const s=scopeForGuild(input.guildId),userId=input.user.id,customId=input.isMessageComponent()||input.isModalSubmit()?input.customId:undefined;
 if(input.isMessageComponent()&&customId&&Components.kind(customId)==='modal'){
  try{
   const modal=await beforeDeadline((async()=>{
    const settings=await new SettingsService(opts.db).get(s),locale=resolveLocale(settings.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guildLocale??undefined}),intent=await opts.components.read(opts.db,s,customId,opts.vault.hash(s,userId));
    if(intent.action!=='editNodeOpen')throw new Error('INVALID_MODAL_ACTION');
    const roles=input.member&&'roles' in input.member?Array.isArray(input.member.roles)?input.member.roles:[...input.member.roles.cache.keys()]:[];
    if(!canAdmin(input.memberPermissions?.bitfield.toString()??'0',roles,settings.adminRoleId))throw new Error('ADMIN_REQUIRED');
    const id=await opts.components.issue(opts.db,s,{...intent,action:'editNodeSave'},opts.vault.hash(s,userId));
    return {title:t(locale,'modal.title').slice(0,45),custom_id:id,components:[{type:1 as const,components:[{type:4 as const,style:1 as const,custom_id:'question',label:t(locale,'modal.question').slice(0,45),value:String(intent.question),required:true,max_length:500}]},{type:1 as const,components:[{type:4 as const,style:2 as const,custom_id:'options',label:t(locale,'modal.options').slice(0,45),value:String(intent.options),required:true,max_length:2000}]}]};
   })(),1200);
   await input.showModal(modal);const acknowledgedAt=new Date();opts.health?.acknowledged(acknowledgedAt);opts.health?.completed(acknowledgedAt);
   void opts.db.transaction().execute(async tx=>{await ensureGuild(tx,s);await saveDiagnostic(tx,s,opts.vault,{id:input.id,kind:'component',action:'editNodeOpen',receivedAt,acknowledgedAt});await sql`UPDATE interaction_diagnostics SET completed_at=${acknowledgedAt},result='completed' WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId} AND interaction_hash=${opts.vault.hash(s,input.id)}`.execute(tx);}).catch(()=>{});
   return;
  }catch(error){
   if(!input.replied&&!input.deferred){const locale=resolveLocale('auto',{interactionLocale:input.locale,guildLocale:input.guildLocale??undefined});await input.reply({content:t(locale,error instanceof Error&&error.message==='ADMIN_REQUIRED'?'modal.admin':'modal.unavailable'),flags:64}).then(()=>opts.health?.acknowledged()).catch(()=>opts.health?.failed('ack_failed'));}
   return;
  }
 }
 try{await input.deferReply({flags:64});opts.health?.acknowledged();}catch{opts.health?.failed('ack_failed');return;}
 const job:InteractionJob={id:input.id,applicationId:input.applicationId,token:input.token,userId,channelId:input.channelId??undefined,messageId:input.isMessageComponent()?input.message.id:undefined,command:input.isChatInputCommand()&&input.commandName==='nexus'?input.options.getSubcommand(false)??undefined:undefined,customId,values:input.isStringSelectMenu()?input.values:undefined,fields:input.isModalSubmit()?Object.fromEntries(input.fields.fields.map((field,id)=>[id,'value' in field?String(field.value):''])):undefined,locale:input.locale,guildLocale:input.guildLocale??undefined};
 const acknowledgedAt=new Date();
 try{await opts.db.transaction().execute(async tx=>{await ensureGuild(tx,s);await saveDiagnostic(tx,s,opts.vault,{id:input.id,kind:input.isChatInputCommand()?'command':input.isModalSubmit()?'modal':'component',action:job.command??'component',receivedAt,acknowledgedAt});await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES(${s.organizationId}::uuid,${s.guildId},${job.id},${opts.vault.seal(s,JSON.stringify(job))}) ON CONFLICT DO NOTHING`.execute(tx);});}
 catch{opts.health?.failed('queue_failed');const locale=resolveLocale('auto',{interactionLocale:input.locale,guildLocale:input.guildLocale??undefined});await input.editReply({content:t(locale,'interaction.saveFailed')}).catch(()=>{});}
}
export function createInteractionServer(opts:{db:Database,vault:IdentityVault,publicKey:string,applicationId:string,components?:Components,discord?:DiscordPort,health?:InteractionHealth}){
 const app=Fastify({logger:false,bodyLimit:65536,requestTimeout:2000});
 app.removeContentTypeParser('application/json');app.addContentTypeParser('application/json',{parseAs:'buffer'},(_request,body,done)=>done(null,body));
 app.get('/health',()=>({status:'ok'}));
 app.post('/interactions',async(req,reply)=>{
  const body=req.body as Buffer;
  if(!verifyInteraction(opts.publicKey,String(req.headers['x-signature-ed25519']??''),String(req.headers['x-signature-timestamp']??''),body)) return reply.code(401).send({error:'invalid signature'});
  let raw:unknown;try{raw=JSON.parse(body.toString('utf8'));}catch{return reply.code(400).send({error:'invalid JSON'});}
  if(z.object({type:z.literal(1)}).safeParse(raw).success)return {type:1};
  const parsed=interaction.safeParse(raw);if(!parsed.success)return reply.code(400).send({error:'invalid interaction'});
  const input=parsed.data;if(input.application_id!==opts.applicationId)return reply.code(403).send({error:'wrong application'});
  const immediateLocale=resolveLocale('auto',{interactionLocale:input.locale,guildLocale:input.guild_locale});
  if(![2,3,5].includes(input.type))return {type:4,data:{flags:64,content:t(immediateLocale,'modal.unsupported')}};
  const receivedAt=new Date();opts.health?.received(receivedAt);
  const s=scopeForGuild(input.guild_id);
  if(input.type===3&&input.data.custom_id&&Components.kind(input.data.custom_id)==='modal'&&opts.components){
   try{const response=await beforeDeadline(opts.db.transaction().execute(async tx=>{
    await sql`SET LOCAL transaction_timeout='900ms'`.execute(tx);
    const settings=await new SettingsService(opts.db).get(s,tx),locale=resolveLocale(settings.uiLanguage,{interactionLocale:input.locale,guildLocale:input.guild_locale});
    let intent;try{intent=await opts.components!.read(tx,s,input.data.custom_id!,opts.vault.hash(s,input.member.user.id));}
    catch{return {type:4,data:{flags:64,content:t(locale,'modal.expired')}};}
    if(intent.action!=='editNodeOpen')return {type:4,data:{flags:64,content:t(locale,'modal.expired')}};
    if(!canAdmin(input.member.permissions,input.member.roles,settings.adminRoleId))return {type:4,data:{flags:64,content:t(locale,'modal.admin')}};
    const customId=await opts.components!.issue(tx,s,{...intent,action:'editNodeSave'},opts.vault.hash(s,input.member.user.id));
    return {type:9,data:{title:t(locale,'modal.title').slice(0,45),custom_id:customId,components:[
     {type:1,components:[{type:4,style:1,custom_id:'question',label:t(locale,'modal.question').slice(0,45),value:String(intent.question),required:true,max_length:500}]},
     {type:1,components:[{type:4,style:2,custom_id:'options',label:t(locale,'modal.options').slice(0,45),value:String(intent.options),required:true,max_length:2000}]}
    ]}};
   }),1200);opts.health?.acknowledged();return response;}catch{opts.health?.failed('ack_failed');return {type:4,data:{flags:64,content:t(immediateLocale,'modal.unavailable')}};}
  }
  const job:InteractionJob={id:input.id,applicationId:input.application_id,token:input.token,userId:input.member.user.id,
   channelId:input.channel_id,messageId:input.message?.id,command:input.data.name==='nexus'?input.data.options?.[0]?.name:undefined,customId:input.data.custom_id,values:input.data.values,
   fields:input.type===5?Object.fromEntries(input.data.components?.flatMap(row=>row.components.map(c=>[c.custom_id,c.value]))??[]):undefined,locale:input.locale,guildLocale:input.guild_locale};
  const acknowledgedAt=new Date();opts.health?.acknowledged(acknowledgedAt);
  // Send the initial response before acquiring a database connection.
  void opts.db.transaction().execute(async tx=>{
   await sql`SET LOCAL transaction_timeout='1700ms'`.execute(tx);
   await sql`SET LOCAL statement_timeout='1200ms'`.execute(tx);await sql`SET LOCAL lock_timeout='500ms'`.execute(tx);
   await ensureGuild(tx,s);
   await saveDiagnostic(tx,s,opts.vault,{id:input.id,kind:input.type===2?'command':input.type===5?'modal':'component',action:job.command??'component',receivedAt,acknowledgedAt});
   await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES
    (${s.organizationId}::uuid,${s.guildId},${job.id},${opts.vault.seal(s,JSON.stringify(job))}) ON CONFLICT DO NOTHING`.execute(tx);
  }).catch(async()=>{opts.health?.failed('queue_failed');await opts.discord?.editReply(input.application_id,input.token,{content:t(immediateLocale,'interaction.saveFailed')}).catch(()=>{});});
  return {type:5,data:{flags:64}};
 });
 return app;
}
