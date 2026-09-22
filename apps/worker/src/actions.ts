import {z} from 'zod';
import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {Scope} from '../../../packages/shared/src/index.js';
import {IdentityVault} from '../../../packages/identity/src/index.js';
import {DiscordFailure,type DiscordPort} from '../../../packages/discord/src/rest.js';
import {enqueue,type ActionKind} from '../../../packages/discord/src/outbox.js';
import {OnboardingService} from '../../../packages/onboarding/src/index.js';
import {selectedOptions} from '../../../packages/onboarding/src/flow.js';
import {audit,SettingsService} from '../../../packages/settings/src/index.js';
import type {Panel} from '../../../packages/discord-panels/src/index.js';
import {InterventionWorker} from './interventions.js';
type Action={id:string,kind:ActionKind,payload:Record<string,unknown>,attempts:number};
export class ActionWorker {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly discord:DiscordPort,private readonly onboarding:OnboardingService){}
 async tick(s:Scope):Promise<boolean>{
  // A crashed worker may have performed a REST operation; never blindly retry its expired lease.
  await sql`UPDATE action_outbox SET state='UNKNOWN',last_error='worker lease expired' WHERE ${tenant(s)} AND state='RUNNING' AND lease_until<now()`.execute(this.db);
  const action=await this.db.transaction().execute(async tx=>{
   const row=(await sql<Action>`SELECT id,kind,payload,attempts FROM action_outbox WHERE ${tenant(s)} AND state='PENDING' AND available_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`.execute(tx)).rows[0];
   if(row)await sql`UPDATE action_outbox SET state='RUNNING',attempts=attempts+1,lease_until=now()+interval '60 seconds' WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(tx);
   return row;
  });
  if(!action)return false;
  if(action.kind==='INTERVENTION_DELIVER'){
   const runId=z.uuid().parse(action.payload.runId);await new InterventionWorker(this.db,this.vault,this.discord).tick(s,runId);
   const run=(await sql<{state:string,available_at:Date}>`SELECT state,available_at FROM intervention_runs WHERE ${tenant(s)} AND id=${runId}::uuid`.execute(this.db)).rows[0];
   const state=run?.state==='queued'?'PENDING':run?.state==='delivered'?'SUCCEEDED':run?.state==='unknown'||run?.state==='running'?'UNKNOWN':'FAILED';
   await sql`UPDATE action_outbox SET state=${state},available_at=${run?.available_at??new Date()},lease_until=NULL WHERE ${tenant(s)} AND id=${action.id}::uuid`.execute(this.db);return true;
  }
  let sideEffectStarted=false;
  try{await this.db.connection().execute(async tx=>{
   const privacyKey='privacy:'+s.organizationId+':'+s.guildId;let roleKey:string|null=null;
   await sql`SELECT pg_advisory_lock_shared(hashtextextended(${privacyKey},0))`.execute(tx);
   try{
   const live=(await sql`SELECT id FROM action_outbox WHERE ${tenant(s)} AND id=${action.id}::uuid AND state='RUNNING'`.execute(tx)).rows[0];
   if(!live)return;
   if(action.kind.startsWith('ROLE_')){
    const payload=z.object({sessionId:z.uuid(),roleId:z.string().optional()}).parse(action.payload);
    const session=await this.onboarding.session(s,payload.sessionId,tx);
    roleKey=s.guildId+session.episode_id;
    await sql`SELECT pg_advisory_lock(hashtextextended(${roleKey},0))`.execute(tx);
    const episode=(await sql<{identity_id:string,left_at:Date|null}>`SELECT identity_id,left_at FROM membership_episodes WHERE ${tenant(s)} AND id=${session.episode_id}::uuid`.execute(tx)).rows[0]!;
    const latest=(await sql<{id:string}>`SELECT id FROM flow_sessions WHERE ${tenant(s)} AND episode_id=${session.episode_id}::uuid AND context='PRODUCTION' ORDER BY created_at DESC LIMIT 1`.execute(tx)).rows[0];
    const settings=await new SettingsService(this.db).get(s,tx);
    if(latest?.id===session.id&&session.context==='PRODUCTION'&&session.state.complete&&!episode.left_at&&settings.enabled&&settings.onboardingEnabled){
     const desired=new Map(selectedOptions(session.definition,session.state).filter(o=>o.roleId).map(o=>[o.roleId!,o.id]));
     const grants=(await sql<{role_id:string}>`SELECT role_id FROM nexus_role_grants WHERE ${tenant(s)} AND episode_id=${session.episode_id}::uuid AND revoked_at IS NULL`.execute(tx)).rows;
     if(action.kind==='ROLE_RECONCILE'){
      for(const roleId of desired.keys())await enqueue(tx,s,`${action.id}:add:${roleId}`,'ROLE_ADD',{sessionId:session.id,roleId});
      for(const grant of grants)if(!desired.has(grant.role_id))await enqueue(tx,s,`${action.id}:remove:${grant.role_id}`,'ROLE_REMOVE',{sessionId:session.id,roleId:grant.role_id});
     }else{
      const roleId=payload.roleId!;const userId=await this.vault.forAction(tx,s,episode.identity_id);const member=await this.discord.member(s.guildId,userId);
      if(action.kind==='ROLE_ADD'&&desired.has(roleId)&&!member.roles.includes(roleId)){
       await this.discord.validateRole(s.guildId,roleId);sideEffectStarted=true;await this.discord.addRole(s.guildId,userId,roleId);
       await sql`INSERT INTO nexus_role_grants(organization_id,guild_id,episode_id,role_id,action_id,flow_version_id,node_id)
        VALUES(${s.organizationId}::uuid,${s.guildId},${session.episode_id}::uuid,${roleId},${action.id}::uuid,${session.flow_version_id}::uuid,${desired.get(roleId)!})
        ON CONFLICT(organization_id,guild_id,episode_id,role_id) DO UPDATE SET action_id=EXCLUDED.action_id,flow_version_id=EXCLUDED.flow_version_id,node_id=EXCLUDED.node_id,granted_at=now(),revoked_at=NULL`.execute(tx);
      }
      if(action.kind==='ROLE_REMOVE'&&!desired.has(roleId)&&grants.some(g=>g.role_id===roleId)){
       if(member.roles.includes(roleId)){await this.discord.validateRole(s.guildId,roleId);sideEffectStarted=true;await this.discord.removeRole(s.guildId,userId,roleId);}
       await sql`UPDATE nexus_role_grants SET revoked_at=now() WHERE ${tenant(s)} AND episode_id=${session.episode_id}::uuid AND role_id=${roleId}`.execute(tx);
      }
     }
    }
   }else if(action.kind==='PANEL_UPSERT'){
    const payload=action.payload as {channelId:string,body:Panel};await this.discord.checkChannel(s.guildId,payload.channelId);
    const existing=(await sql<{channel_id:string,message_id:string}>`SELECT channel_id,message_id FROM settings_panels WHERE ${tenant(s)}`.execute(tx)).rows[0];
    let id:string|undefined;
    if(existing&&existing.channel_id===payload.channelId){try{sideEffectStarted=true;await this.discord.editPanel(existing.channel_id,existing.message_id,payload.body);id=existing.message_id;}catch(error){if(!(error instanceof DiscordFailure)||error.status!==404)throw error;}}
    if(!id){sideEffectStarted=true;id=await this.discord.sendPanel(payload.channelId,payload.body,action.id);}
    await sql`INSERT INTO settings_panels(organization_id,guild_id,channel_id,message_id) VALUES(${s.organizationId}::uuid,${s.guildId},${payload.channelId},${id})
     ON CONFLICT(organization_id,guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,message_id=EXCLUDED.message_id`.execute(tx);
   }else if(action.kind==='COMMANDS_REGISTER'){
    sideEffectStarted=true;await this.discord.registerCommands(s.guildId,z.array(z.unknown()).parse(action.payload.commands));
   }else{
    const payload=action.payload as {encryptedToken:string,applicationId:string,body:Panel};
    sideEffectStarted=true;await this.discord.editReply(payload.applicationId,this.vault.open(s,payload.encryptedToken),payload.body);
   }
   await sql`UPDATE action_outbox SET state='SUCCEEDED',lease_until=NULL WHERE ${tenant(s)} AND id=${action.id}::uuid`.execute(tx);
   await audit(tx,s,{key:'system',permissions:'0',roles:[],source:'SYSTEM',requestId:action.id},'action.executed',null,{kind:action.kind,id:action.id});
   }finally{
    if(roleKey)await sql`SELECT pg_advisory_unlock(hashtextextended(${roleKey},0))`.execute(tx);
    await sql`SELECT pg_advisory_unlock_shared(hashtextextended(${privacyKey},0))`.execute(tx);
   }
  });}catch(error){
   const known=error instanceof DiscordFailure;
   const canRetry=known&&(error.status===429||error.status>=500)&&(!sideEffectStarted||error.status===429||action.kind==='REPLY_EDIT');
   const state=canRetry&&action.attempts<5?'PENDING':sideEffectStarted&&(!known||error.status>=500)?'UNKNOWN':'FAILED';
   await sql`UPDATE action_outbox SET state=${state},lease_until=NULL,last_error=${known?`HTTP ${error.status}`:sideEffectStarted?'Ambiguous side effect':'Precondition failed'},
    available_at=${new Date(Date.now()+(known?Math.max(error.retryAfter,2**action.attempts):1)*1000)} WHERE ${tenant(s)} AND id=${action.id}::uuid`.execute(this.db);
  }
  return true;
 }
}
