import {randomUUID} from 'node:crypto';
import {sql,tenant,json,privacyReadLock,type Database,type Tx} from '../../db/src/index.js';
import {SettingsService,audit,type Actor, type Settings} from '../../settings/src/index.js';
import {IdentityVault} from '../../identity/src/index.js';
import {assert,type Scope,type EventContext} from '../../shared/src/index.js';
import {enqueue} from '../../discord/src/outbox.js';
import {validateFlow,templateFlow,answerFlow,initialFlowState,type Flow,type FlowState} from './flow.js';
import {validateSignal} from '../../events/src/registry.js';
import {chooseMode,type GuildCapabilityProfile} from '../../lifecycle/src/capabilities.js';
export type Session={id:string,episode_id:string,flow_version_id:string,revision:number,state:FlowState,context:EventContext,definition:Flow};
export async function appendEvent(tx:Tx,s:Scope,episodeId:string,kind:string,context:EventContext,data:Record<string,unknown>={},at=new Date()){
 validateSignal(kind,data);
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data)
 VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episodeId}::uuid,${kind},${at},${context},${json(data)})`.execute(tx);
}
export class OnboardingService {
 constructor(private readonly db:Database,private readonly settings:SettingsService,private readonly vault:IdentityVault){}
 async publish(s:Scope,actor:Actor,revision:number,definition:Flow,template?:Settings['template']){
  const flow=validateFlow(definition);
  return this.settings.mutate(s,actor,revision,async(current,tx)=>{
   const version=(await sql<{n:number}>`SELECT COALESCE(MAX(version),0)::integer+1 AS n FROM flow_versions WHERE ${tenant(s)}`.execute(tx)).rows[0]!.n;
   const id=randomUUID();await sql`INSERT INTO flow_versions(organization_id,guild_id,id,version,definition)
    VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${version},${json(flow)})`.execute(tx);
   await audit(tx,s,actor,'flow.published',null,{id,version});
   return {...current,flowVersionId:id,template:template??current.template};
  });
 }
 async chooseTemplate(s:Scope,actor:Actor,revision:number,template:Settings['template']){return this.publish(s,actor,revision,templateFlow(template),template);}
 async rollback(s:Scope,actor:Actor,revision:number,versionId:string){const flow=await this.flow(s,versionId);return this.publish(s,actor,revision,flow);}
 async flow(s:Scope,id:string,tx:Tx=this.db){
  const row=(await sql<{definition:Flow}>`SELECT definition FROM flow_versions WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx)).rows[0];assert(row,'FLOW_NOT_FOUND');return validateFlow(row.definition);
 }
 async start(s:Scope,userId:string,joinedAt:Date,context:EventContext='PRODUCTION',restart=false):Promise<Session>{
  return this.db.transaction().execute(async tx=>{
   await privacyReadLock(tx,s);
   assert(!(await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash=${this.vault.hash(s,userId)}`.execute(tx)).rows.length,'PRIVACY_OPT_OUT');
   const settings=await this.settings.get(s,tx);assert(context!=='PRODUCTION'||settings.enabled&&settings.onboardingEnabled,'ONBOARDING_DISABLED');
   if(context==='PRODUCTION'&&settings.flags.native_capability_v2){
    const profile=(await sql<{profile:GuildCapabilityProfile}>`SELECT profile FROM guild_capabilities WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(tx)).rows[0]?.profile;
    assert(profile&&Date.now()-new Date(profile.checkedAt).getTime()<3600000,'REFRESH_NATIVE_SETUP');
    const mode=chooseMode(settings.onboardingMode,profile.recommendedMode==='native');
    assert(mode!=='native','USE_DISCORD_CHANNELS_AND_ROLES');
    if(mode==='hybrid'){
     assert(settings.hybrid.enabled&&settings.hybrid.flowVersionId,'HYBRID_NOT_CONFIGURED');
     settings.flowVersionId=settings.hybrid.flowVersionId;
     const hybrid=await this.flow(s,settings.flowVersionId,tx);
     assert(!hybrid.nodes.some(n=>profile.nativePromptIds.includes(n.nativePromptId??settings.hybrid.nativePromptMappings[n.id]??'')),'DUPLICATE_NATIVE_QUESTION');
    }
   }
   assert(settings.flowVersionId,'FLOW_NOT_CONFIGURED');
   const identityId=await this.vault.resolve(tx,s,userId);
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+identityId+context},0))`.execute(tx);
   const id=randomUUID();
   await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context)
    VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${identityId}::uuid,${joinedAt},${context}) ON CONFLICT DO NOTHING`.execute(tx);
   const episode=(await sql<{id:string}>`SELECT id FROM membership_episodes WHERE ${tenant(s)} AND identity_id=${identityId}::uuid AND joined_at=${joinedAt} AND context=${context}`.execute(tx)).rows[0]!;
   if(context==='PRODUCTION'&&settings.onboardingMode==='hybrid'&&settings.hybrid.trigger==='after_native_onboarding_observed')assert((await sql`SELECT episode_id FROM native_lifecycle_state WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND native_onboarding_first_observed_completed_at IS NOT NULL`.execute(tx)).rows.length,'NATIVE_COMPLETION_NOT_OBSERVED');
   if(!restart){const existing=(await sql<{id:string}>`SELECT id FROM flow_sessions WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND context=${context} ORDER BY created_at DESC LIMIT 1`.execute(tx)).rows[0];if(existing)return this.session(s,existing.id,tx);}
   const flow=await this.flow(s,settings.flowVersionId,tx);const sessionId=randomUUID();
   await sql`INSERT INTO flow_sessions(organization_id,guild_id,id,episode_id,flow_version_id,state,context)
    VALUES(${s.organizationId}::uuid,${s.guildId},${sessionId}::uuid,${episode.id}::uuid,${settings.flowVersionId}::uuid,${json(initialFlowState(flow))},${context})`.execute(tx);
   await appendEvent(tx,s,episode.id,'nexus_onboarding.started',context,{flowVersionId:settings.flowVersionId});
   if(initialFlowState(flow).complete){await appendEvent(tx,s,episode.id,'nexus_onboarding.completed',context,{flowVersionId:settings.flowVersionId});if(context==='PRODUCTION')await enqueue(tx,s,`reconcile:${sessionId}`,'ROLE_RECONCILE',{sessionId});}
   return this.session(s,sessionId,tx);
  });
 }
 async session(s:Scope,id:string,tx:Tx=this.db):Promise<Session>{
  const row=(await sql<Omit<Session,'definition'>>`SELECT id,episode_id,flow_version_id,revision,state,context FROM flow_sessions WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx)).rows[0];assert(row,'SESSION_NOT_FOUND');
  return {...row,definition:await this.flow(s,row.flow_version_id,tx)};
 }
 async answer(s:Scope,userId:string,sessionId:string,revision:number,nodeId:string,optionId:string|string[]){
  return this.db.transaction().execute(async tx=>{
   await privacyReadLock(tx,s);
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+this.vault.hash(s,userId)},0))`.execute(tx);
   await sql`SELECT id FROM flow_sessions WHERE ${tenant(s)} AND id=${sessionId}::uuid FOR UPDATE`.execute(tx);
   const session=await this.session(s,sessionId,tx);
   const owner=(await sql<{lookup_hash:string}>`SELECT m.lookup_hash FROM membership_episodes e JOIN member_identity_map m
    ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.identity_id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.id=${session.episode_id}::uuid`.execute(tx)).rows[0];
   assert(owner?.lookup_hash===this.vault.hash(s,userId),'SESSION_OWNER',403);assert(session.revision===revision,'REVISION_CONFLICT',409);
   const latest=(await sql<{id:string}>`SELECT id FROM flow_sessions WHERE ${tenant(s)} AND episode_id=${session.episode_id}::uuid AND context=${session.context} ORDER BY created_at DESC LIMIT 1`.execute(tx)).rows[0];
   assert(latest?.id===sessionId,'SESSION_SUPERSEDED',409);
   const settings=await this.settings.get(s,tx);assert(session.context!=='PRODUCTION'||settings.enabled&&settings.onboardingEnabled,'ONBOARDING_DISABLED');
   const state=answerFlow(session.definition,session.state,nodeId,optionId);
   await sql`UPDATE flow_sessions SET state=${json(state)},revision=revision+1 WHERE ${tenant(s)} AND id=${sessionId}::uuid`.execute(tx);
   for(const selected of state.answers[nodeId]!.split('|'))await appendEvent(tx,s,session.episode_id,'nexus_onboarding.answered',session.context,{nodeId,optionId:selected,flowVersionId:session.flow_version_id});
   if(state.complete){
    await appendEvent(tx,s,session.episode_id,'nexus_onboarding.completed',session.context,{flowVersionId:session.flow_version_id});
    if(session.context==='PRODUCTION')await enqueue(tx,s,`reconcile:${sessionId}`,'ROLE_RECONCILE',{sessionId});
   }
   return {...session,state,revision:revision+1};
  });
 }
}
