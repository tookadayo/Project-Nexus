import {sql,type Database} from "../../../packages/db/src/index";
import {assert,type Scope} from "../../../packages/shared/src/index";
import {RuleEvaluationWorker,type RuleWorkerOptions} from "./alpha16-rules";

export interface Alpha16PcRuntimeProfile {
  enabled:boolean;
  revision:string;
  expiresAt:Date;
  maxEvaluationJobsPerScope:number;
  maxTrackedScopes:number;
}
export interface Alpha16PcRuntimeOptions {
  /** Trusted PC configuration only. No request body or fixture is a profile. */
  profile():Promise<Alpha16PcRuntimeProfile|null>;
  operator:{startupPass():Promise<{ready:boolean}>;tick():Promise<{ready:boolean}>};
  retention:{tickGlobal():Promise<{ready:boolean;cleanupComplete?:boolean;externalPublicationReady?:boolean}>;tick(scope:Scope):Promise<{ready:boolean}>};
  rules:RuleWorkerOptions;
}
/** The existing PC scheduler owns cadence. Construction/import starts no
 * timers and installs no operational policy, credentials or subscriptions.
 * Missing configuration closes only the new alpha16 work. */
export class Alpha16PcRuntime {
  private readonly cursors=new Map<string,{createdAt:string;jobId:string;expiresAt:number;profileRevision:string}>();
  constructor(private readonly db:Database,private readonly options?:Alpha16PcRuntimeOptions) {}
  get configured() {return !!this.options;}
  private expireCursors() {for(const [key,cursor] of this.cursors)if(cursor.expiresAt<=Date.now())this.cursors.delete(key);}
  private async profile() {
    if(!this.options)return null;
    const profile=await this.options.profile();
    if(!profile?.enabled)return null;
    assert(/^[A-Za-z0-9_.:-]{1,128}$/.test(profile.revision)
      &&profile.expiresAt instanceof Date&&Number.isFinite(profile.expiresAt.getTime())&&profile.expiresAt>new Date()
      &&Number.isSafeInteger(profile.maxEvaluationJobsPerScope)&&profile.maxEvaluationJobsPerScope>0&&profile.maxEvaluationJobsPerScope<=100
      &&Number.isSafeInteger(profile.maxTrackedScopes)&&profile.maxTrackedScopes>0&&profile.maxTrackedScopes<=1000,
    "PC_RULE_RUNTIME_PROFILE_UNAVAILABLE",409);
    return {...profile,expiresAt:new Date(profile.expiresAt)};
  }
  private async currentProfile(expected:Alpha16PcRuntimeProfile) {
    const current=await this.profile();
    assert(current&&current.revision===expected.revision&&current.expiresAt.getTime()===expected.expiresAt.getTime()
      &&current.maxEvaluationJobsPerScope===expected.maxEvaluationJobsPerScope&&current.maxTrackedScopes===expected.maxTrackedScopes,"PC_RULE_RUNTIME_PROFILE_CHANGED",409);
    return current;
  }
  async tickGlobal() {
    this.expireCursors();
    try {
      if(!this.options)return {enabled:false,reasonCode:"PC_RULE_RUNTIME_UNCONFIGURED" as const};
      const deletion=await this.options.operator.startupPass().catch(()=>({ready:false}));
      const publication=await this.options.retention.tickGlobal().catch(()=>({ready:false,cleanupComplete:false,externalPublicationReady:false}));
      // Stopping generation must not stop already approved expiry/deletion
      // maintenance. Each maintenance dependency checks its own purpose gate.
      const profile=await this.profile();
      if(!deletion.ready)return {enabled:!!profile,deletionReady:false,publication,reasonCode:"DELETION_RECONCILIATION_REQUIRED" as const};
      // Publication withdrawal readiness is a separate purpose. It cannot
      // block current READ or unrelated Rule generation through a shared flag.
      return {enabled:!!profile,deletionReady:true,publication};
    }catch{return {enabled:false,reasonCode:"PC_RULE_RUNTIME_DEPENDENCY_UNAVAILABLE" as const};}
  }
  async tick(scope:Scope) {
    this.expireCursors();
    let processed=0,unavailable=0;
    try {
      if(!this.options)return {enabled:false,processed:0,reasonCode:"PC_RULE_RUNTIME_UNCONFIGURED" as const};
      const deletion=await this.options.operator.tick().catch(()=>({ready:false}));
      const retention=await this.options.retention.tick(scope).catch(()=>({ready:false}));
      const profile=await this.profile();
      if(!deletion.ready)return {enabled:!!profile,processed:0,reasonCode:"DELETION_RECONCILIATION_REQUIRED" as const};
      if(!retention.ready)return {enabled:!!profile,processed:0,reasonCode:"RETENTION_ENFORCEMENT_REQUIRED" as const};
      if(!profile){this.cursors.clear();return {enabled:false,processed:0,reasonCode:"PC_RULE_RUNTIME_UNCONFIGURED" as const};}
      assert(profile.expiresAt>new Date(),"PC_RULE_RUNTIME_PROFILE_UNAVAILABLE",409);
      const cursorKey=JSON.stringify([scope.organizationId,scope.guildId]);
      const profileIdentity=JSON.stringify([profile.revision,profile.expiresAt.toISOString(),profile.maxEvaluationJobsPerScope,profile.maxTrackedScopes]);
      for(const [key,value] of this.cursors)if(value.profileRevision!==profileIdentity)this.cursors.delete(key);
      const cursor=this.cursors.get(cursorKey);
      if(!cursor&&this.cursors.size>=profile.maxTrackedScopes)return {enabled:true,processed:0,reasonCode:"PC_RULE_SCOPE_CAPACITY_REQUIRED" as const};
      const selectJobs=async(after?:typeof cursor)=>(await sql<{id:string;created_at_exact:string;expires_at:Date}>`SELECT j.id,to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,j.expires_at FROM rule_evaluation_jobs j
        JOIN rule_config_versions c ON c.organization_id=j.organization_id AND c.guild_id=j.guild_id AND c.version=j.config_version
        WHERE j.organization_id=${scope.organizationId}::uuid AND j.guild_id=${scope.guildId} AND j.expires_at>clock_timestamp()
        AND c.state='ACTIVE' AND c.approved_at IS NOT NULL AND c.expires_at>clock_timestamp() AND c.operating_profile_expires_at>clock_timestamp()
        AND (j.state IN ('QUEUED','CANCEL_REQUESTED') OR j.state='RUNNING' AND j.lease_until<=clock_timestamp())
        ${after?sql`AND (j.created_at,j.id)>(${after.createdAt}::timestamptz,${after.jobId}::uuid)`:sql``}
        ORDER BY j.created_at,j.id LIMIT ${profile.maxEvaluationJobsPerScope}`.execute(this.db)).rows;
      let jobs=await selectJobs(cursor);
      if(!jobs.length&&cursor)jobs=await selectJobs();
      if(jobs.length){
        const last=jobs.at(-1)!;this.cursors.delete(cursorKey);
        this.cursors.set(cursorKey,{createdAt:last.created_at_exact,jobId:last.id,expiresAt:Math.min(profile.expiresAt.getTime(),last.expires_at.getTime()),profileRevision:profileIdentity});
      }else this.cursors.delete(cursorKey);
      // Advance the finite in-memory page before processing: an unauthorized
      // or invalid prefix cannot monopolize every pass. This is selection
      // rotation only; it never requeues, mutates or reauthorizes a job.
      const configuredRules=this.options!.rules;
      const worker=new RuleEvaluationWorker(this.db,{...configuredRules,authorize:async(s,actorHash)=>{
        await this.currentProfile(profile);
        const authorization=await configuredRules.authorize(s,actorHash),current=await this.currentProfile(profile);
        return {...authorization,expiresAt:new Date(Math.min(authorization.expiresAt.getTime(),current.expiresAt.getTime()))};
      }});
      for(const job of jobs){
        await this.currentProfile(profile);
        try {await worker.process(scope,job.id);processed++;}
        catch {unavailable++;}
      }
      return {enabled:true,processed,unavailable,reasonCode:unavailable?"EVALUATION_PREREQUISITE_UNAVAILABLE" as const:null};
    }catch{return {enabled:false,processed,unavailable,reasonCode:"PC_RULE_RUNTIME_DEPENDENCY_UNAVAILABLE" as const};}
  }
}
