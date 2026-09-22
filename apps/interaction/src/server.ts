import Fastify from 'fastify';
import {z} from 'zod';
import {verifyInteraction,scopeForGuild,Components,canAdmin} from '../../../packages/security/src/index.js';
import {SettingsService} from '../../../packages/settings/src/index.js';
import {ensureGuild,sql,type Database} from '../../../packages/db/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
const snowflake=z.string().regex(/^\d{17,20}$/);
const interaction=z.object({id:snowflake,application_id:snowflake,type:z.number(),token:z.string().min(1).max(2048),guild_id:snowflake,
 channel_id:snowflake.optional(),member:z.object({user:z.object({id:snowflake}),permissions:z.string().regex(/^\d+$/),roles:z.array(snowflake)}),
 data:z.object({name:z.string().max(100).optional(),custom_id:z.string().max(100).optional(),values:z.array(z.string().max(100)).max(25).optional(),
 options:z.array(z.object({name:z.string().max(100)})).max(10).optional(),components:z.array(z.object({components:z.array(z.object({custom_id:z.string(),value:z.string().max(2000)}))})).max(5).optional()})});
export type InteractionJob={id:string,applicationId:string,token:string,userId:string,channelId?:string,command?:string,customId?:string,values?:string[],fields?:Record<string,string>};
export function createInteractionServer(opts:{db:Database,vault:IdentityVault,publicKey:string,applicationId:string,components?:Components}){
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
  if(![2,3,5].includes(input.type))return {type:4,data:{flags:64,content:'Unsupported interaction.'}};
  const s=scopeForGuild(input.guild_id);
  const job:InteractionJob={id:input.id,applicationId:input.application_id,token:input.token,userId:input.member.user.id,
   channelId:input.channel_id,command:input.data.name==='nexus'?input.data.options?.[0]?.name:undefined,customId:input.data.custom_id,values:input.data.values,
   fields:input.type===5?Object.fromEntries(input.data.components?.flatMap(row=>row.components.map(c=>[c.custom_id,c.value]))??[]):undefined};
  // PostgreSQL 18 bounds the entire transaction, not just each individual statement.
  // Together with the 500ms pool acquisition timeout this leaves an ACK margin.
  try{return await opts.db.transaction().execute(async tx=>{
   await sql`SET LOCAL transaction_timeout='1700ms'`.execute(tx);
   await sql`SET LOCAL statement_timeout='1200ms'`.execute(tx);await sql`SET LOCAL lock_timeout='500ms'`.execute(tx);
   if(input.type===3&&input.data.custom_id&&opts.components){
    let intent;try{intent=await opts.components.read(tx,s,input.data.custom_id,opts.vault.hash(s,input.member.user.id));}
    catch{return {type:4,data:{flags:64,content:'This control expired. Reload /nexus panel.'}};}
    if(intent.action==='editNodeOpen'){
     const settings=await new SettingsService(opts.db).get(s,tx);
     if(!canAdmin(input.member.permissions,input.member.roles,settings.adminRoleId))return {type:4,data:{flags:64,content:'Admin required.'}};
     const customId=await opts.components.issue(tx,s,{...intent,action:'editNodeSave'},opts.vault.hash(s,input.member.user.id));
     return {type:9,data:{title:'Edit onboarding question',custom_id:customId,components:[
      {type:1,components:[{type:4,style:1,custom_id:'question',label:'Question',value:String(intent.question),required:true,max_length:500}]},
      {type:1,components:[{type:4,style:2,custom_id:'options',label:'id | label | next node (or end)',value:String(intent.options),required:true,max_length:2000}]}
     ]}};
    }
   }
   await ensureGuild(tx,s);
   await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES
    (${s.organizationId}::uuid,${s.guildId},${job.id},${opts.vault.seal(s,JSON.stringify(job))}) ON CONFLICT DO NOTHING`.execute(tx);
   return {type:5,data:{flags:64}};
  });}catch{return reply.code(503).send({error:'queue unavailable'});}
 });
 return app;
}
