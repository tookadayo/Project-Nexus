import {randomUUID} from 'node:crypto';
import {GuildMemberFlags} from 'discord-api-types/v10';
import {sql,tenant,privacyReadLock,type Database,type Tx} from '../../db/src/index.js';
import type {Scope} from '../../shared/src/index.js';
import {DiscordFailure,type DiscordPort} from '../../discord/src/rest.js';
import type {IdentityVault} from '../../identity/src/index.js';
import {SettingsService} from '../../settings/src/index.js';
import {projectActivation} from './activation.js';
const checkpoints=[0,300,3600,86400,604800];
export const nativeFlags=[
 [GuildMemberFlags.StartedOnboarding,'native_onboarding_first_observed_started_at','native_onboarding.observed_started'],
 [GuildMemberFlags.CompletedOnboarding,'native_onboarding_first_observed_completed_at','native_onboarding.observed_completed'],
 [GuildMemberFlags.StartedHomeActions,'home_actions_first_observed_started_at','home_actions.observed_started'],
 [GuildMemberFlags.CompletedHomeActions,'home_actions_first_observed_completed_at','home_actions.observed_completed']
] as const;
export function observedFlags(flags:bigint){return nativeFlags.filter(([bit])=>(flags&BigInt(bit))!==0n);}
export async function scheduleNativeSnapshots(tx:Tx,s:Scope,episodeId:string,joinedAt:Date){
 for(const seconds of checkpoints)await sql`INSERT INTO native_snapshot_jobs(organization_id,guild_id,episode_id,checkpoint,due_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episodeId}::uuid,${String(seconds)},${new Date(joinedAt.getTime()+seconds*1000)}) ON CONFLICT DO NOTHING`.execute(tx);
}
export async function requestNativeRefresh(tx:Tx,s:Scope,episodeId:string,at:Date){
 const checkpoint=`activity:${Math.floor(at.getTime()/300000)}`;
 await sql`INSERT INTO native_snapshot_jobs(organization_id,guild_id,episode_id,checkpoint,due_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episodeId}::uuid,${checkpoint},${at}) ON CONFLICT DO NOTHING`.execute(tx);
}
export async function projectNativeSnapshot(tx:Tx,s:Scope,episodeId:string,flags:bigint,pending:boolean|null,observedAt:Date){
 const previous=(await sql<{pending:boolean|null}>`SELECT pending FROM native_member_snapshots WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND observed_at<${observedAt} ORDER BY observed_at DESC LIMIT 1`.execute(tx)).rows[0];
 if(previous?.pending===true&&pending===false&&!((await sql`SELECT id FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND kind='screening.passed'`.execute(tx)).rows.length))await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episodeId}::uuid,'screening.passed',${observedAt},'PRODUCTION','{}')`.execute(tx);
 await sql`INSERT INTO native_member_snapshots VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episodeId}::uuid,${flags.toString()}::bigint,${pending},${observedAt})`.execute(tx);
 await sql`INSERT INTO native_lifecycle_state(organization_id,guild_id,episode_id) VALUES(${s.organizationId}::uuid,${s.guildId},${episodeId}::uuid) ON CONFLICT DO NOTHING`.execute(tx);
 for(const [,column,kind] of observedFlags(flags)){
  const updated=await sql`UPDATE native_lifecycle_state SET ${sql.ref(column)}=${observedAt} WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND (${sql.ref(column)} IS NULL OR ${sql.ref(column)}>${observedAt}) RETURNING episode_id`.execute(tx);
  if(updated.rows.length){
   await sql`DELETE FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episodeId}::uuid AND kind=${kind}`.execute(tx);
   await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episodeId}::uuid,${kind},${observedAt},'PRODUCTION','{}')`.execute(tx);
  }
 }
}
type Job={episode_id:string,checkpoint:string,identity_id:string,joined_at:Date,attempts:number};
export class NativeMemberSnapshotWorker {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly discord:DiscordPort){}
 async tick(s:Scope){
  const cfg=await new SettingsService(this.db).get(s);if(!cfg.enabled||!cfg.flags.native_snapshot_v2)return false;
  const job=await this.db.transaction().execute(async tx=>{
   const row=(await sql<Job>`SELECT j.episode_id,j.checkpoint,j.attempts,e.identity_id,e.joined_at FROM native_snapshot_jobs j JOIN membership_episodes e ON e.organization_id=j.organization_id AND e.guild_id=j.guild_id AND e.id=j.episode_id WHERE j.organization_id=${s.organizationId}::uuid AND j.guild_id=${s.guildId} AND e.left_at IS NULL AND e.context='PRODUCTION' AND j.due_at<=now() AND (j.state='pending' OR j.state='running' AND j.lease_until<now()) ORDER BY j.due_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`.execute(tx)).rows[0];
   if(row)await sql`UPDATE native_snapshot_jobs SET state='running',attempts=attempts+1,lease_until=now()+interval '30 seconds' WHERE ${tenant(s)} AND episode_id=${row.episode_id}::uuid AND checkpoint=${row.checkpoint}`.execute(tx);return row;
  });if(!job)return false;
  try{
   const userId=await this.vault.forAction(this.db,s,job.identity_id);
   const member=await (this.discord.memberSnapshot?.(s.guildId,userId)??this.discord.member(s.guildId,userId));
   if(member.flags===undefined||member.bot||new Date(member.joinedAt).getTime()!==job.joined_at.getTime())throw new DiscordFailure(404);
   const observedAt=new Date();
   await this.db.transaction().execute(async tx=>{
    await privacyReadLock(tx,s);
    const exists=(await sql`SELECT id FROM membership_episodes WHERE ${tenant(s)} AND id=${job.episode_id}::uuid AND left_at IS NULL FOR UPDATE`.execute(tx)).rows.length;if(!exists)return;
    await projectNativeSnapshot(tx,s,job.episode_id,BigInt(member.flags!),member.pending??null,observedAt);
    if(cfg.flags.activation_dsl_v2)await projectActivation(tx,s,job.episode_id,observedAt);
    await sql`UPDATE native_snapshot_jobs SET state='succeeded',lease_until=NULL WHERE ${tenant(s)} AND episode_id=${job.episode_id}::uuid AND checkpoint=${job.checkpoint}`.execute(tx);
   });
  }catch(error){
   const retry=error instanceof DiscordFailure&&(error.status===429||error.status>=500)||!(error instanceof DiscordFailure);
   await sql`UPDATE native_snapshot_jobs SET state=${retry&&job.attempts<5?'pending':'unavailable'},lease_until=NULL,last_error=${error instanceof DiscordFailure?`HTTP ${error.status}`:'snapshot unavailable'},due_at=${new Date(Date.now()+Math.max(error instanceof DiscordFailure?error.retryAfter:1,2**job.attempts)*1000)} WHERE ${tenant(s)} AND episode_id=${job.episode_id}::uuid AND checkpoint=${job.checkpoint}`.execute(this.db);
  }
  return true;
 }
}
