import {sql,tenant,type Database} from '../../../packages/db/src/index.js';
import type {Scope} from '../../../packages/shared/src/index.js';
import {assert} from '../../../packages/shared/src/index.js';
import type {IdentityVault} from '../../../packages/identity/src/index.js';
import {DiscordFailure,type DiscordPort} from '../../../packages/discord/src/rest.js';
import {interventionSchema,evidence,interventionEligible} from '../../../packages/lifecycle/src/interventions.js';
import {SettingsService} from '../../../packages/settings/src/index.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';
type Run={id:string,episode_id:string,revision_id:string,assignment_id:string|null,approved_by:string|null,attempts:number};
export class InterventionWorker {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly discord:DiscordPort){}
 async tick(s:Scope,runId?:string){
  await sql`UPDATE intervention_runs SET state='unknown',reason='Expired delivery lease' WHERE ${tenant(s)} AND state='running' AND lease_until<now()`.execute(this.db);
  const run=await this.db.transaction().execute(async tx=>{
   const row=(await sql<Run>`SELECT * FROM intervention_runs WHERE ${tenant(s)} AND state='queued' AND available_at<=now() ${runId?sql`AND id=${runId}::uuid`:sql``} ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`.execute(tx)).rows[0];
   if(row)await sql`UPDATE intervention_runs SET state='running',attempts=attempts+1,lease_until=now()+interval '60 seconds' WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(tx);return row;
  });if(!run)return false;
  let effect=false;
  try{await this.db.connection().execute(async connection=>{
   const privacyKey='privacy:'+s.organizationId+':'+s.guildId;let deliveryKey:string|null=null;
   await sql`SELECT pg_advisory_lock_shared(hashtextextended(${privacyKey},0))`.execute(connection);
   try{
   const row=(await sql<{definition:unknown}>`SELECT definition FROM guild_config_revisions WHERE ${tenant(s)} AND id=${run.revision_id}::uuid AND state='published' AND domain='intervention'`.execute(this.db)).rows[0];assert(row,'INTERVENTION_NOT_FOUND');
   const definition=interventionSchema.parse(row.definition),action=definition.actions[0]!;
   if(run.assignment_id){const control=(await sql<{state:string}>`SELECT c.state FROM experiment_controls c JOIN experiment_assignments a ON a.organization_id=c.organization_id AND a.guild_id=c.guild_id AND a.revision_id=c.revision_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.id=${run.assignment_id}::uuid`.execute(this.db)).rows[0];assert(!control||control.state==='running','EXPERIMENT_NOT_RUNNING');}
   const cfg=await new SettingsService(this.db).get(s);assert(cfg.enabled&&cfg.flags.interventions_v2,'INTERVENTIONS_DISABLED');assert(await new EntitlementService(this.db).can(s,'interventions'),'ENTITLEMENT_REQUIRED');
   if(!run.approved_by)assert(definition.safetyMode==='auto'&&!definition.massRoleOperation&&await new EntitlementService(this.db).can(s,'automation_auto'),'APPROVAL_REQUIRED');
   const ev=await evidence(this.db,s,run.episode_id);assert(ev&&interventionEligible(definition,ev),'NO_LONGER_ELIGIBLE');
   const episode=(await sql<{identity_id:string}>`SELECT identity_id FROM membership_episodes WHERE ${tenant(s)} AND id=${run.episode_id}::uuid AND left_at IS NULL`.execute(this.db)).rows[0];assert(episode,'MEMBER_UNAVAILABLE');
   deliveryKey=s.guildId+':delivery:'+episode.identity_id;
   await sql`SELECT pg_advisory_lock(hashtextextended(${deliveryKey},0))`.execute(connection);
   // Atomic reservation checks include running and queued rows, so parallel deliveries cannot evade caps.
   const allowed=await this.db.transaction().execute(async tx=>{
    const counts=(await sql<{weekly:number,daily:number}>`SELECT count(*) FILTER(WHERE COALESCE(r.delivered_at,r.available_at)>now()-interval '7 days')::integer AS weekly,count(*) FILTER(WHERE COALESCE(r.delivered_at,r.available_at)>now()-interval '24 hours')::integer AS daily FROM intervention_runs r JOIN membership_episodes e ON e.organization_id=r.organization_id AND e.guild_id=r.guild_id AND e.id=r.episode_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND e.identity_id=${episode.identity_id}::uuid AND r.id<>${run.id}::uuid AND r.state IN ('delivered','unknown','running')`.execute(tx)).rows[0]!;
    return counts.weekly<Math.min(3,definition.frequencyCaps.contactsPerWeek)&&(action.type!=='send_dm'||cfg.dmEnabled&&counts.daily<Math.min(1,definition.frequencyCaps.dmPerDay));
   });assert(allowed,'CONTACT_CAP_OR_DM_DISABLED');
   const userId=await this.vault.forAction(this.db,s,episode.identity_id),member=await this.discord.member(s.guildId,userId);assert(!member.bot,'BOT_IGNORED');
   // No HTTP side effect is performed inside a SQL transaction.
   let granted=false;
   if(action.type==='assign_nexus_role'||action.type==='remove_nexus_role'){
    await this.discord.validateRole(s.guildId,action.roleId);
    if(action.type==='assign_nexus_role'){
     if(!member.roles.includes(action.roleId)){effect=true;await this.discord.addRole(s.guildId,userId,action.roleId);granted=true;}
    }else{
     const proof=(await sql`SELECT role_id FROM intervention_role_grants WHERE ${tenant(s)} AND episode_id=${run.episode_id}::uuid AND role_id=${action.roleId} AND source='NEXUS' AND revoked_at IS NULL`.execute(this.db)).rows.length;assert(proof,'ROLE_NOT_OWNED');
     if(member.roles.includes(action.roleId)){effect=true;await this.discord.removeRole(s.guildId,userId,action.roleId);}
    }
   }else if(action.type==='send_dm'){
    assert(this.discord.sendDirectMessage,'DM_TRANSPORT_UNAVAILABLE');effect=true;await this.discord.sendDirectMessage(userId,action.text,run.id);
   }else{
    await this.discord.checkChannel(s.guildId,action.channelId);
    const content=action.type==='recommend_channels'?`Suggested channels: ${action.channels.map(c=>`<#${c}>`).join(', ')}`:action.type==='recommend_event'?`Suggested event: https://discord.com/events/${s.guildId}/${action.eventId}`:action.text;
    assert(!/@everyone|@here/.test(content),'MASS_MENTION_PROHIBITED');effect=true;await this.discord.sendPanel(action.channelId,{content,allowed_mentions:{parse:[]}},run.id);
   }
   await this.db.transaction().execute(async tx=>{
    const live=(await sql`SELECT id FROM intervention_runs WHERE ${tenant(s)} AND id=${run.id}::uuid AND state='running' FOR UPDATE`.execute(tx)).rows.length;if(!live)return;
    if(action.type==='assign_nexus_role'&&granted)await sql`INSERT INTO intervention_role_grants(organization_id,guild_id,episode_id,role_id,run_id) VALUES(${s.organizationId}::uuid,${s.guildId},${run.episode_id}::uuid,${action.roleId},${run.id}::uuid) ON CONFLICT(organization_id,guild_id,episode_id,role_id) DO UPDATE SET run_id=EXCLUDED.run_id,granted_at=now(),revoked_at=NULL`.execute(tx);
    if(action.type==='remove_nexus_role')await sql`UPDATE intervention_role_grants SET revoked_at=now() WHERE ${tenant(s)} AND episode_id=${run.episode_id}::uuid AND role_id=${action.roleId}`.execute(tx);
    await sql`UPDATE intervention_runs SET state='delivered',delivered_at=now(),lease_until=NULL WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(tx);
    if(run.assignment_id&&effect)await sql`INSERT INTO experiment_exposures VALUES(${s.organizationId}::uuid,${s.guildId},${run.assignment_id}::uuid,${run.id}::uuid,now()) ON CONFLICT DO NOTHING`.execute(tx);
   });
   }finally{
    if(deliveryKey)await sql`SELECT pg_advisory_unlock(hashtextextended(${deliveryKey},0))`.execute(connection);
    await sql`SELECT pg_advisory_unlock_shared(hashtextextended(${privacyKey},0))`.execute(connection);
   }
  });}catch(error){
   const retry=error instanceof DiscordFailure&&error.status===429&&run.attempts<5;
   const ambiguous=effect&&(!(error instanceof DiscordFailure)||error.status>=500);
   await sql`UPDATE intervention_runs SET state=${retry?'queued':ambiguous?'unknown':effect?'failed':'suppressed'},reason=${error instanceof DiscordFailure?`HTTP ${error.status}`:effect?'Delivery uncertain':'Safety precondition failed'},lease_until=NULL,available_at=${new Date(Date.now()+(error instanceof DiscordFailure?Math.max(1,error.retryAfter):1)*1000)} WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(this.db);
  }
  return true;
 }
}
