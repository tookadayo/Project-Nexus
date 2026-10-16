import { sql,tenant,type Database } from "../../../packages/db/src/index";
import { acquireRuleScopeLocks,ruleScopeLockSet } from "../../../packages/rules/src/locks";
import { purgeExpiredRuleData } from "../../../packages/rules/src/privacy";
import { purgeExpiredPersonalization } from "../../../packages/operations/src/alpha16-personalization";
import { purgeExpiredManualReports, purgeExpiredReportGenerationEvidence } from "../../../packages/operations/src/reports";
import { purgeExpiredLifecycleWeb } from "../../../packages/lifecycle/src/web-workspace";
import { purgeExpiredStaticPublicationManifests } from "../../../packages/operations/src/alpha16-publication";
import type { Scope } from "../../../packages/shared/src/index";
import type { IndependentSafetyAuthority } from "../../../packages/security/src/alpha16-safety-state";

export type Alpha16RetentionMaintenanceProfile={enabled:boolean;writerCoverageVerified:boolean;startupDeletionReconciled:boolean;policyRevision:string|null;globalBatchSize?:number|null};
/** Called by the PC supervisor only after the deletion reconciler has finished.
 * It neither installs a timer nor activates a production retention policy. */
export class Alpha16RetentionMaintenance{
  constructor(private readonly db:Database,private readonly profile:()=>Promise<Alpha16RetentionMaintenanceProfile>=async()=>({enabled:false,writerCoverageVerified:false,startupDeletionReconciled:false,policyRevision:null}),private readonly safety?:IndependentSafetyAuthority){}
  async tickGlobal(){
    this.safety?.purgeExpired();
    const profile=await this.profile();
    if(!profile.enabled||!profile.writerCoverageVerified||!profile.startupDeletionReconciled||!profile.policyRevision||!Number.isSafeInteger(profile.globalBatchSize)||(profile.globalBatchSize??0)<=0||(profile.globalBatchSize??Infinity)>200)
      return {ready:false,reason:"GLOBAL_RETENTION_ENFORCEMENT_NOT_CONFIGURED"};
    // No guild transaction/row locks are held across global publication cleanup.
    // Any returned withdrawal requirement still blocks operational readiness.
    return purgeExpiredStaticPublicationManifests(this.db,new Date(),profile.globalBatchSize!);
  }
  async tick(scope:Scope){
    this.safety?.purgeExpired();
    const profile=await this.profile();
    if(!profile.enabled||!profile.writerCoverageVerified||!profile.startupDeletionReconciled||!profile.policyRevision)
      return {ready:false,reason:"RETENTION_ENFORCEMENT_NOT_CONFIGURED"};
    return this.db.transaction().execute(async tx=>{
      await acquireRuleScopeLocks(tx,ruleScopeLockSet(scope));
      const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      await purgeExpiredRuleData(tx,scope,now);
      // An already authorized cancellation completes independently of new
      // generation or a retired Rule configuration. No input or TTL changes.
      await sql`UPDATE rule_evaluation_jobs SET state='CANCELLED',row_version=row_version+1,finished_at=COALESCE(finished_at,${now}),lease_token=NULL,lease_until=NULL WHERE ${tenant(scope)} AND state='CANCEL_REQUESTED'`.execute(tx);
      await purgeExpiredPersonalization(tx,scope,now);
      await purgeExpiredManualReports(tx,scope,now);
      await purgeExpiredReportGenerationEvidence(tx,scope,now);
      await purgeExpiredLifecycleWeb(tx,scope,now);
      await sql`DELETE FROM automation_rollbacks WHERE ${tenant(scope)} AND expires_at<=${now}`.execute(tx);
      await sql`DELETE FROM operations_audit_events WHERE ${tenant(scope)} AND retention_class='ALPHA16_MINIMAL_OPERATION' AND expires_at<=${now}`.execute(tx);
      return {ready:true,asOf:now.toISOString()};
    });
  }
}
