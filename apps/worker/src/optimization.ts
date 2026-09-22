import {sql,type Database} from '../../../packages/db/src/index.js';
import type {Scope} from '../../../packages/shared/src/index.js';
import {SettingsService} from '../../../packages/settings/src/index.js';
import {experimentSchema,ExperimentService} from '../../../packages/lifecycle/src/experiments.js';
import {InterventionService} from '../../../packages/lifecycle/src/interventions.js';
import {projectActivation} from '../../../packages/lifecycle/src/activation.js';
import {EntitlementService} from '../../../packages/settings/src/entitlements.js';
export class OptimizationWorker {
 constructor(private readonly db:Database){}
 async tick(s:Scope){
  const cfg=await new SettingsService(this.db).get(s);if(!cfg.enabled)return;
  const episodes=(await sql<{id:string}>`SELECT e.id FROM membership_episodes e LEFT JOIN optimization_checks c ON c.organization_id=e.organization_id AND c.guild_id=e.guild_id AND c.episode_id=e.id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.context='PRODUCTION' AND e.left_at IS NULL AND e.joined_at>now()-interval '30 days' ORDER BY c.checked_at ASC NULLS FIRST,e.joined_at DESC LIMIT 250`.execute(this.db)).rows;
  const heads=(await sql<{id:string,domain:string,definition:unknown}>`SELECT r.id,r.domain,r.definition FROM guild_config_revisions r JOIN guild_config_heads h ON h.organization_id=r.organization_id AND h.guild_id=r.guild_id AND h.revision_id=r.id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId}`.execute(this.db)).rows;
  const experiments=heads.filter(h=>h.domain==='experiment'),interventions=heads.filter(h=>h.domain==='intervention');
  const experimentInterventions=new Set(experiments.flatMap(e=>experimentSchema.parse(e.definition).variants.flatMap(v=>v.interventionRevisionId?[v.interventionRevisionId]:[])));
  const entitlements=new EntitlementService(this.db),canExperiment=cfg.flags.experiments_v2&&await entitlements.can(s,'experiments'),canIntervene=cfg.flags.interventions_v2&&await entitlements.can(s,'interventions');
  if(canExperiment)for(const experiment of experiments)await new ExperimentService(this.db).result(s,experiment.id);
  for(const episode of episodes){
   if(cfg.flags.activation_dsl_v2)await this.db.transaction().execute(tx=>projectActivation(tx,s,episode.id));
   if(canExperiment)for(const experiment of experiments)await new ExperimentService(this.db).deliverAssigned(s,experiment.id,episode.id);
   if(canIntervene)for(const intervention of interventions)if(!experimentInterventions.has(intervention.id))await new InterventionService(this.db).propose(s,intervention.id,episode.id);
   await sql`INSERT INTO optimization_checks VALUES(${s.organizationId}::uuid,${s.guildId},${episode.id}::uuid,now()) ON CONFLICT(organization_id,guild_id,episode_id) DO UPDATE SET checked_at=now()`.execute(this.db);
  }
 }
}
