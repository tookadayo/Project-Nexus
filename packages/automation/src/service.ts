import {randomUUID} from 'node:crypto';
import {sql,json,tenant,type Database,type Tx} from '../../db/src/index';
import {assert,isDomainError,type Scope} from '../../shared/src/index';
import {SettingsService,type Actor} from '../../settings/src/index';
import {operationsAccess} from '../../operations/src/policy';
import {betaAccess} from '../../security/src/hosted-beta';
import {validateFlowDefinition} from './definition';
import {scratchNumericOptions} from './scratch-math-server';
import {collectFixedTemporalValues,assertTemporalUserEdits,assertTemporalLiteralInput} from './temporal-edit';
import {assertTimeZone} from './datetime';
import {evaluateValue} from './expression';
import type {FlowDefinition,ExecutionPlan,EvaluatedValue,Statement} from './types';
import {MAX_RUN_SECONDS} from './types';
import {validateEventTriggerInputs} from './event-contract';
import {AutomationStore,fingerprint,type ResumeState,type AutomationApproval,type RunRecord,type ScheduleOccurrenceSnapshot} from './store';
import {nextScheduleAt} from './scheduler';
import {checkScheduleMeaning,plannedCalendarMeaning,type ScheduleMeaningReader} from './schedule-rules';
import {simulateAutomationPlan,type AutomationSimulationInput} from './simulation';
import {ALPHA15_AUTOMATION_STORAGE,ALPHA15_BETA_ADMISSION,ALPHA15_SCRATCH_RANDOM,type AutomationStoragePolicy} from './admission';
import {automationLock,DISABLED_AUTOMATION_ADMISSION,reserveAutomationQuota,validateAdmissionLimits,type AutomationAdmissionLimits} from './quota';

interface FlowRow {id:string;name:string;draft_revision:number;active_revision:number|null;state:'DRAFT'|'ACTIVE'|'DISABLED'|'DELETED';generation:number;activator_hash:string|null;activator_ciphertext:string|null;beta_generation:number|null;updated_at:Date;}
interface RevisionRow {revision:number;definition:FlowDefinition;semantic_hash:string;complete:boolean;}
type Access=(tx:Tx,s:Scope,actor:Actor,permission:'READ'|'CONFIGURE'|'OPERATE'|'GOVERN')=>Promise<unknown>;
export interface AutomationServiceOptions {
  /** Measured host safety setting, fixed into each new random material. */
  scratchRandomAttempts?:number;
  admission?:AutomationAdmissionLimits;now?:()=>Date;authorize?:Access;
  /** Only connector operations with verified permissions/result contracts. */
  adoptedActions?:ReadonlySet<string>;
  storage?:AutomationStoragePolicy;
  scheduleMeaningReader?:ScheduleMeaningReader;
  /** Live native role impact, rebuilt for both review and the final decision. */
  approvalPolicy?:(tx:Tx,s:Scope,run:RunRecord,approval:AutomationApproval,actor:Actor)=>Promise<{fingerprint:string;changedChannelCount:number}>;
}
export class AutomationService {
  readonly scratchRandomAttempts:number|undefined;
  readonly limits:AutomationAdmissionLimits;
  readonly store:AutomationStore;
  readonly storage:AutomationStoragePolicy;
  private readonly now:()=>Date;
  private readonly access:Access;
  constructor(readonly db:Database,readonly options:AutomationServiceOptions={}) {
    this.limits=validateAdmissionLimits({...options.admission??DISABLED_AUTOMATION_ADMISSION});
    this.scratchRandomAttempts=options.scratchRandomAttempts??(this.limits.measurementId===ALPHA15_BETA_ADMISSION.measurementId?ALPHA15_SCRATCH_RANDOM.attemptLimit:undefined);
    assert(this.scratchRandomAttempts===undefined||Number.isSafeInteger(this.scratchRandomAttempts)&&this.scratchRandomAttempts>0,'AUTOMATION_RANDOM_CONFIGURATION_INVALID');
    this.now=options.now??(()=>new Date());this.store=new AutomationStore(db,this.now);
    this.storage={...options.storage??ALPHA15_AUTOMATION_STORAGE};
    assert(Object.values(this.storage).every(value=>Number.isSafeInteger(value)&&value>0),'AUTOMATION_STORAGE_POLICY_INVALID');
    this.access=options.authorize??((tx,s,actor,permission)=>operationsAccess(tx,s,actor,permission));
  }
  private async flow(tx:Tx,s:Scope,id:string) {
    const row=(await sql<FlowRow>`SELECT * FROM automation_flows WHERE ${tenant(s)} AND id=${id} AND state<>'DELETED'`.execute(tx)).rows[0];
    assert(row,'AUTOMATION_FLOW_NOT_FOUND',404);return row;
  }
  private async revision(tx:Tx,s:Scope,id:string,revision:number) {
    const row=(await sql<RevisionRow>`SELECT revision,definition,semantic_hash,complete FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${id} AND revision=${revision}`.execute(tx)).rows[0];
    assert(row,'AUTOMATION_REVISION_NOT_FOUND',404);return row;
  }
  private async replay(tx:Tx,s:Scope,actor:Actor,requestId:string,hash:string) {
    const row=(await sql<{actor_hash:string;fingerprint:string;flow_id:string;revision:number|null;run_id:string|null;kind:string}>`SELECT * FROM automation_requests WHERE ${tenant(s)} AND id=${requestId}::uuid`.execute(tx)).rows[0];
    if(row)assert(row.actor_hash===actor.key&&row.fingerprint===hash,'AUTOMATION_REQUEST_CONFLICT',409);
    return row;
  }
  private async record(tx:Tx,s:Scope,actor:Actor,requestId:string,hash:string,flowId:string,revision:number|null,kind:'SAVE'|'ENABLE'|'DISABLE'|'DELETE'|'START'|'CANCEL',runId:string|null=null) {
    await sql`INSERT INTO automation_requests(organization_id,guild_id,id,actor_hash,fingerprint,flow_id,revision,kind,run_id) VALUES(${s.organizationId}::uuid,${s.guildId},${requestId}::uuid,${actor.key},${hash},${flowId},${revision},${kind},${runId}::uuid)`.execute(tx);
  }
  async list(s:Scope,actor:Actor) {
    await this.access(this.db,s,actor,'READ');
    const rows=(await sql<FlowRow>`SELECT id,name,draft_revision,active_revision,state,generation,updated_at FROM automation_flows WHERE ${tenant(s)} AND state<>'DELETED' ORDER BY updated_at DESC,id LIMIT 200`.execute(this.db)).rows;
    return {items:rows.map(row=>({id:row.id,name:row.name,draftRevision:row.draft_revision,activeRevision:row.active_revision,state:row.state,updatedAt:row.updated_at.toISOString()})),limits:{...this.limits,storage:this.storage,kind:'HOST_SAFETY',commercial:false}};
  }
  async timeZonePreference(s:Scope,actor:Actor) {
    await this.access(this.db,s,actor,'READ');
    const row=(await sql<{settings:Record<string,unknown>;revision:number}>`SELECT settings,revision FROM guild_settings WHERE ${tenant(s)}`.execute(this.db)).rows[0];
    if(!row)return {timeZone:null,source:'missing' as const,revision:0};
    if(!Object.hasOwn(row.settings,'timezone'))return {timeZone:null,source:'legacy' as const,revision:row.revision};
    const zone=row.settings.timezone;
    try{assert(typeof zone==='string','TIME_ZONE_INVALID');assertTimeZone(zone);}catch{return {timeZone:null,source:'invalid' as const,revision:row.revision};}
    return {timeZone:zone,source:'saved' as const,revision:row.revision};
  }
  async get(s:Scope,actor:Actor,id:string) {
    await this.access(this.db,s,actor,'READ');
    const row=await this.flow(this.db,s,id),revision=await this.revision(this.db,s,id,row.draft_revision);
    const scheduleReview=revision.definition.trigger.kind==='schedule'?(await sql<{review_required:boolean;review_reason:string|null}>`SELECT review_required,review_reason FROM automation_schedules WHERE ${tenant(s)} AND flow_id=${id}`.execute(this.db)).rows[0]:undefined;
    return {id:row.id,name:row.name,draftRevision:row.draft_revision,activeRevision:row.active_revision,state:row.state,definition:revision.definition,validation:validateFlowDefinition(revision.definition,{...await scratchNumericOptions(revision.definition),temporalResolution:'fixed'}),scheduleReview:{required:scheduleReview?.review_required??false,reason:scheduleReview?.review_reason??null}};
  }
  async getRevision(s:Scope,actor:Actor,id:string,revision:number) {
    await this.access(this.db,s,actor,'READ');
    assert(Number.isSafeInteger(revision)&&revision>0&&revision<=2147483647,'AUTOMATION_REVISION_INVALID');
    await this.flow(this.db,s,id);
    const saved=await this.revision(this.db,s,id,revision);
    return {id,revision:saved.revision,definition:saved.definition};
  }
  async save(s:Scope,actor:Actor,input:{definition:unknown;expectedRevision:number;requestId:string}) {
    await this.access(this.db,s,actor,'CONFIGURE');
    const candidate=input.definition as Partial<FlowDefinition>|null;
    let fixedTemporalValues:ReadonlySet<string>=new Set();
    if(candidate&&candidate.guildId===s.guildId&&typeof candidate.id==='string'&&input.expectedRevision>0){
      const previous=(await sql<RevisionRow>`SELECT revision,definition,semantic_hash,complete FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${candidate.id} AND revision=${input.expectedRevision}`.execute(this.db)).rows[0];
      if(previous)fixedTemporalValues=collectFixedTemporalValues(previous.definition);
    }
    const numeric=await scratchNumericOptions(input.definition);
    const validation=validateFlowDefinition(input.definition,{...numeric,fixedTemporalValues});
    assert(!validation.issues.some(issue=>issue.severity==='error')&&validation.definition,'AUTOMATION_DEFINITION_INVALID');
    const definition=validation.definition;
    assertTemporalUserEdits(definition,fixedTemporalValues);
    assert(definition.guildId===s.guildId,'AUTOMATION_GUILD_MISMATCH',403);
    assert(/^[a-zA-Z0-9_-]{1,100}$/.test(definition.id),'AUTOMATION_FLOW_ID_INVALID');
    const hash=fingerprint({kind:'SAVE',definition,expectedRevision:input.expectedRevision});
    const result=await this.db.transaction().execute(async tx=>{
      await this.access(tx,s,actor,'CONFIGURE');await automationLock(tx,s);
      const prior=await this.replay(tx,s,actor,input.requestId,hash);
      if(prior)return {id:prior.flow_id,revision:prior.revision!};
      const row=(await sql<FlowRow>`SELECT * FROM automation_flows WHERE ${tenant(s)} AND id=${definition.id} FOR UPDATE`.execute(tx)).rows[0];
      assert(!row||row.state!=='DELETED','AUTOMATION_FLOW_DELETED',409);
      assert((row?.draft_revision??0)===input.expectedRevision,'AUTOMATION_REVISION_CONFLICT',409);
      const stored=(await sql<{flows:number;revisions:number}>`SELECT (SELECT count(*)::integer FROM automation_flows WHERE ${tenant(s)}) AS flows,(SELECT count(*)::integer FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${definition.id}) AS revisions`.execute(tx)).rows[0]!;
      assert((row||stored.flows<this.storage.maxFlowsPerGuild)&&stored.revisions<this.storage.maxRevisionsPerFlow,'AUTOMATION_DEFINITION_STORAGE_LIMIT',429);
      const bytes=(await sql<{guild:number;host:number;added:number}>`SELECT (COALESCE(sum(octet_length(definition::text)) FILTER(WHERE ${tenant(s)}),0)+(SELECT COALESCE(sum(octet_length(snapshot::text)),0) FROM automation_schedule_reviews WHERE ${tenant(s)}))::float8 AS guild,(COALESCE(sum(octet_length(definition::text)),0)+(SELECT COALESCE(sum(octet_length(snapshot::text)),0) FROM automation_schedule_reviews))::float8 AS host,(SELECT octet_length(${json(definition)}::text)) AS added FROM automation_revisions`.execute(tx)).rows[0]!;
      assert(bytes.guild+bytes.added<=this.storage.maxGuildDefinitionBytes&&bytes.host+bytes.added<=this.storage.maxHostDefinitionBytes,'AUTOMATION_DEFINITION_BYTES_LIMIT',429);
      const revision=input.expectedRevision+1;
      await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,draft_revision) VALUES(${s.organizationId}::uuid,${s.guildId},${definition.id},${definition.name},${revision}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET name=EXCLUDED.name,draft_revision=EXCLUDED.draft_revision,updated_at=now()`.execute(tx);
      await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${s.organizationId}::uuid,${s.guildId},${definition.id},${revision},${json(definition)},${validation.semanticHash??fingerprint(definition)},${validation.complete})`.execute(tx);
      await this.record(tx,s,actor,input.requestId,hash,definition.id,revision,'SAVE');
      return {id:definition.id,revision};
    });
    // Return the exact committed revision even if a different tab saved again.
    const saved=await this.revision(this.db,s,result.id,result.revision);
    return {id:result.id,draftRevision:result.revision,definition:saved.definition,requestId:input.requestId,validation:validateFlowDefinition(saved.definition,{...numeric,temporalResolution:'fixed'})};
  }
  async check(s:Scope,actor:Actor,id:string,revision:number,kind:'VALIDATE'|'TEST'|'IMPACT',mockInput:AutomationSimulationInput={}) {
    return this.db.transaction().execute(async tx=>{
      await this.access(tx,s,actor,'CONFIGURE');await automationLock(tx,s);
      if(kind==='TEST'){
        for(const value of Object.values(mockInput.values??{}))assertTemporalLiteralInput(value.type,value.value);
        for(const value of Object.values(mockInput.outputs??{}))assertTemporalLiteralInput(value.type,value.value);
        for(const reads of Object.values(mockInput.pollReads??{}))for(const read of reads)if(read.output)assertTemporalLiteralInput(read.output.type,read.output.value);
        if(mockInput.clock!==undefined)assertTemporalLiteralInput('Instant',mockInput.clock);
        for(const event of Object.values(mockInput.awaitEvents??{}))if(event.state==='MATCHED')assertTemporalLiteralInput('Instant',event.occurredAt);
      }
      const flow=await this.flow(tx,s,id);assert(flow.draft_revision===revision,'AUTOMATION_REVISION_CONFLICT',409);
      const saved=await this.revision(tx,s,id,revision),numeric=await scratchNumericOptions(saved.definition),checked=validateFlowDefinition(saved.definition,{...numeric,temporalResolution:'fixed'});
      const base={revision,semanticHash:checked.semanticHash??saved.semantic_hash,valid:checked.valid,complete:checked.complete,issues:checked.issues};
      const scheduleReview=checked.valid&&checked.complete?await checkScheduleMeaning(tx,s,id,revision,saved.definition,this.now(),this.options.scheduleMeaningReader,true,this.storage):{required:false,reason:null};
      if(scheduleReview.required)return {...base,valid:false,scheduleReview,issues:[...base.issues,{severity:'error' as const,code:'TIME_ZONE_REVIEW_REQUIRED',path:'trigger.schedule',message:'Time-zone rules changed. Save a new revision, review its dates and explicitly enable it.'}]};
      const simulation=kind==='TEST'&&checked.plan?simulateAutomationPlan(checked.plan,mockInput,this.now().toISOString(),{...numeric,temporalResolution:'fixed'}):null;
      if(checked.valid&&checked.complete&&(kind!=='TEST'||simulation?.status==='COMPLETED'))await sql`INSERT INTO automation_checks(organization_id,guild_id,flow_id,revision,kind,semantic_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${id},${revision},${kind},${saved.semantic_hash}) ON CONFLICT(organization_id,guild_id,flow_id,revision,kind) DO UPDATE SET checked_at=now(),semantic_hash=EXCLUDED.semantic_hash`.execute(tx);
      if(kind==='VALIDATE')return base;
      const actions: {blockId:string;operation:string;state:'PLANNED'|'UNAVAILABLE'}[]=[],waits:string[]=[];
      const visit=(body:Statement[])=>{for(const statement of body){if(statement.enabled===false)continue;
        if(statement.kind==='action')actions.push({blockId:statement.id,operation:statement.operation,state:this.options.adoptedActions?.has(statement.operation)?'PLANNED':'UNAVAILABLE'});
        if(statement.kind==='wait')waits.push(statement.id);
        if(statement.kind==='branch'){visit(statement.then);visit(statement.otherwise);visit(statement.unknown);}
        if(statement.kind==='resultBranch'){visit(statement.succeeded);visit(statement.failed);visit(statement.notStarted);visit(statement.unknown);}
        if(statement.kind==='optionalBranch'){visit(statement.present);visit(statement.unset);}
        if(statement.kind==='searchBranch'){visit(statement.found);visit(statement.notFound);}
        if(statement.kind==='approval'){waits.push(statement.id);visit(statement.approved);visit(statement.rejected);visit(statement.expired);}
        if(statement.kind==='repeat')visit(statement.body);
        if(statement.kind==='boundedLoop'){visit(statement.body);Object.values(statement.handlers).forEach(body=>body&&visit(body));}
        if(statement.kind==='switch')statement.cases.forEach(choice=>visit(choice.body));
        if(statement.kind==='parallel')statement.branches.forEach(branch=>visit(branch.body));
        if(statement.kind==='poll'){actions.push({blockId:statement.id,operation:'nexus.readTicket',state:this.options.adoptedActions?.has('nexus.readTicket')?'PLANNED':'UNAVAILABLE'});waits.push(statement.id);visit(statement.matched);visit(statement.exhausted);visit(statement.timedOut);}
        if(statement.kind==='awaitEvent'){waits.push(statement.id);visit(statement.matched);visit(statement.timedOut);}
      }};visit(saved.definition.body);saved.definition.procedures?.forEach(procedure=>visit(procedure.body));
      if(kind==='TEST')return {...base,...(simulation??{mode:'SIMULATION',status:'UNDETERMINED',externalChanges:0,productionRuns:0,approvalConsumption:0,steps:[]}),notice:'Mock input and outcomes only. Dynamic inputs, permissions and formal approvals are checked again before production.'};
      let productionUnavailableReason:string|null=null;
      if(!checked.valid||!checked.complete||!checked.plan)productionUnavailableReason='AUTOMATION_DEFINITION_INCOMPLETE';
      else try{this.requireCapabilities(checked.plan);}catch(error){if(!isDomainError(error))throw error;productionUnavailableReason=error.code;}
      if(!productionUnavailableReason&&!this.limits.measurementId)productionUnavailableReason='AUTOMATION_CAPACITY_UNMEASURED';
      return {...base,plannedActions:actions,waits,retentionDays:7,runDeadlineDays:7,externalChanges:0,capacityMeasured:Boolean(this.limits.measurementId),productionAvailable:productionUnavailableReason===null,productionUnavailableReason};
    });
  }
  async enable(s:Scope,actor:Actor,id:string,input:{revision:number;semanticHash:string;requestId:string}) {
    let blockedReason:string|null=null;
    const result=await this.db.transaction().execute(async tx=>{
      await this.access(tx,s,actor,'CONFIGURE');await automationLock(tx,s);
      const hash=fingerprint({kind:'ENABLE',id,...input,requestId:undefined}),old=await this.replay(tx,s,actor,input.requestId,hash);
      if(old){const current=await this.flow(tx,s,id);assert(current.state==='ACTIVE'&&current.active_revision===old.revision,'AUTOMATION_REQUEST_STALE',409);return {id,state:'ACTIVE',activeRevision:old.revision};}
      const row=await this.flow(tx,s,id);assert(row.draft_revision===input.revision,'AUTOMATION_REVISION_CONFLICT',409);
      const revision=await this.revision(tx,s,id,input.revision),checked=validateFlowDefinition(revision.definition,{...await scratchNumericOptions(revision.definition),temporalResolution:'fixed'});
      assert(checked.valid&&checked.complete&&checked.plan,'AUTOMATION_DEFINITION_INCOMPLETE');
      assert(revision.semantic_hash===input.semanticHash,'AUTOMATION_REVISION_CONFLICT',409);
      const checks=(await sql<{kind:string}>`SELECT kind FROM automation_checks WHERE ${tenant(s)} AND flow_id=${id} AND revision=${input.revision} AND semantic_hash=${input.semanticHash}`.execute(tx)).rows;
      assert(['VALIDATE','TEST','IMPACT'].every(kind=>checks.some(check=>check.kind===kind)),'AUTOMATION_REVIEW_REQUIRED',409);
      const scheduleReview=await checkScheduleMeaning(tx,s,id,input.revision,revision.definition,this.now(),this.options.scheduleMeaningReader);
      if(scheduleReview.required){blockedReason=scheduleReview.reason;return null;}
      assert(this.limits.measurementId&&this.limits.activeFlows>0,'AUTOMATION_CAPACITY_UNMEASURED',503);
      assert(actor.encryptedUserId,'AUTOMATION_IDENTITY_REQUIRED',403);
      this.requireCapabilities(checked.plan);
      const count=(await sql<{count:number}>`SELECT count(*)::integer AS count FROM automation_flows WHERE ${tenant(s)} AND state='ACTIVE' AND id<>${id}`.execute(tx)).rows[0]!.count;
      assert(count<this.limits.activeFlows,'AUTOMATION_FLOW_LIMIT',429);
      const invitation=await betaAccess(tx,s,'work');
      await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=${input.revision},generation=generation+1,activator_hash=${actor.key},activator_ciphertext=${actor.encryptedUserId},beta_generation=${invitation?.generation??null},updated_at=now() WHERE ${tenant(s)} AND id=${id}`.execute(tx);
      await sql`UPDATE automation_schedules SET enabled=false,generation=generation+1,next_at=NULL WHERE ${tenant(s)} AND flow_id=${id}`.execute(tx);
      if(revision.definition.trigger.kind==='schedule'){
        const next=nextScheduleAt(revision.definition,this.now()),meaning=plannedCalendarMeaning(revision.definition,next);
        await sql`INSERT INTO automation_schedules(organization_id,guild_id,id,flow_id,revision,generation,rule_hash,enabled,next_at,planned_local,planned_offset) VALUES(${s.organizationId}::uuid,${s.guildId},${id},${id},${input.revision},${row.generation+1},${input.semanticHash},true,${next},${meaning?json(meaning.local):null},${meaning?.offset??null}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET revision=EXCLUDED.revision,generation=EXCLUDED.generation,rule_hash=EXCLUDED.rule_hash,enabled=true,next_at=EXCLUDED.next_at,planned_local=EXCLUDED.planned_local,planned_offset=EXCLUDED.planned_offset,deleted_at=NULL,review_required=false,review_reason=NULL`.execute(tx);
      }
      await this.record(tx,s,actor,input.requestId,hash,id,input.revision,'ENABLE');
      return {id,state:'ACTIVE',activeRevision:input.revision};
    });
    assert(result,blockedReason??'TIME_ZONE_REVIEW_REQUIRED',409);
    return result;
  }
  requireCapabilities(plan:ExecutionPlan) {
    const visit=(body:Statement[])=>{for(const statement of body){if(statement.enabled===false)continue;
      if(statement.kind==='action')assert(this.options.adoptedActions?.has(statement.operation),'AUTOMATION_ACTION_UNAVAILABLE',503);
      if(statement.kind==='parallel')statement.branches.forEach(branch=>visit(branch.body));
      if(statement.kind==='branch'){visit(statement.then);visit(statement.otherwise);visit(statement.unknown);}
      if(statement.kind==='resultBranch'){visit(statement.succeeded);visit(statement.failed);visit(statement.notStarted);visit(statement.unknown);}
      if(statement.kind==='optionalBranch'){visit(statement.present);visit(statement.unset);}
      if(statement.kind==='searchBranch'){visit(statement.found);visit(statement.notFound);}
      if(statement.kind==='approval'){visit(statement.approved);visit(statement.rejected);visit(statement.expired);}
      if(statement.kind==='repeat')visit(statement.body);
      if(statement.kind==='boundedLoop'){visit(statement.body);Object.values(statement.handlers).forEach(body=>body&&visit(body));}
      if(statement.kind==='random'&&plan.definition.semanticProfile==='scratch.v1')assert(this.scratchRandomAttempts,'AUTOMATION_RANDOM_CAPACITY_UNMEASURED',503);
      if(statement.kind==='poll'){assert(this.options.adoptedActions?.has('nexus.readTicket'),'AUTOMATION_ACTION_UNAVAILABLE',503);visit(statement.matched);visit(statement.exhausted);visit(statement.timedOut);}
      if(statement.kind==='awaitEvent'){assert(this.options.adoptedActions?.has('nexus.readTicket'),'AUTOMATION_ACTION_UNAVAILABLE',503);visit(statement.matched);visit(statement.timedOut);}
      if(statement.kind==='switch')statement.cases.forEach(choice=>visit(choice.body));
    }};visit(plan.definition.body);plan.definition.procedures?.forEach(procedure=>visit(procedure.body));
    const trigger=plan.definition.trigger;
    assert(trigger.kind==='manual'||trigger.kind==='schedule'||((trigger.kind==='internal'||trigger.kind==='interaction')&&validateEventTriggerInputs(trigger)),'AUTOMATION_TRIGGER_UNAVAILABLE',503);
  }
  async disable(s:Scope,actor:Actor,id:string,requestId:string,remove=false) {
    return this.db.transaction().execute(async tx=>{
      await this.access(tx,s,actor,'CONFIGURE');await automationLock(tx,s);
      const hash=fingerprint({kind:remove?'DELETE':'DISABLE',id}),old=await this.replay(tx,s,actor,requestId,hash);
      if(old)return {id,state:remove?'DELETED':'DISABLED'};
      await this.flow(tx,s,id);
      await sql`UPDATE automation_flows SET state=${remove?'DELETED':'DISABLED'},generation=generation+1,deleted_at=${remove?this.now():null},updated_at=now() WHERE ${tenant(s)} AND id=${id}`.execute(tx);
      await sql`UPDATE automation_schedules SET enabled=false,generation=generation+1,next_at=NULL,deleted_at=${remove?this.now():null} WHERE ${tenant(s)} AND flow_id=${id}`.execute(tx);
      await sql`UPDATE automation_runs SET cancel_requested_at=COALESCE(cancel_requested_at,${this.now()}) WHERE ${tenant(s)} AND flow_id=${id} AND ended_at IS NULL`.execute(tx);
      await this.record(tx,s,actor,requestId,hash,id,null,remove?'DELETE':'DISABLE');return {id,state:remove?'DELETED':'DISABLED'};
    });
  }
  async request(s:Scope,actor:Actor,id:string) {
    await this.access(this.db,s,actor,'READ');
    const row=(await sql<{flow_id:string;revision:number|null;run_id:string|null;kind:string}>`SELECT flow_id,revision,run_id,kind FROM automation_requests WHERE ${tenant(s)} AND id=${id}::uuid AND actor_hash=${actor.key}`.execute(this.db)).rows[0];
    if(row)return {state:'CONFIRMED',kind:row.kind,flowId:row.flow_id,revision:row.revision,runId:row.run_id};
    const approval=(await sql<{run_id:string;revision:number}>`SELECT run_id,revision FROM automation_approvals WHERE ${tenant(s)} AND request_id=${id}::uuid AND approver_hash=${actor.key}`.execute(this.db)).rows[0];
    assert(approval,'AUTOMATION_REQUEST_NOT_CONFIRMED',404);return {state:'CONFIRMED',kind:'APPROVAL',revision:approval.revision,runId:approval.run_id};
  }
  async start(s:Scope,actor:Actor,id:string,input:{requestId:string;values?:Record<string,EvaluatedValue>}) {
    return this.db.transaction().execute(async tx=>{
      await this.access(tx,s,actor,'CONFIGURE');await automationLock(tx,s);
      const requestHash=fingerprint({kind:'START',id,values:input.values??{}}),prior=await this.replay(tx,s,actor,input.requestId,requestHash);
      if(prior){assert(prior.run_id,'AUTOMATION_REQUEST_CONFLICT',409);return {id:prior.run_id,state:'EXISTING',revision:prior.revision!};}
      assert(actor.encryptedUserId,'AUTOMATION_IDENTITY_REQUIRED',403);
      assert((await new SettingsService(this.db).get(s,tx)).enabled,'AUTOMATION_STOPPED',409);
      const flow=await this.flow(tx,s,id);assert(flow.state==='ACTIVE'&&flow.active_revision,'AUTOMATION_NOT_ACTIVE',409);
      const revision=await this.revision(tx,s,id,flow.active_revision),validated=validateFlowDefinition(revision.definition,{...await scratchNumericOptions(revision.definition),temporalResolution:'fixed'});
      assert(validated.plan,'AUTOMATION_DEFINITION_INVALID');this.requireCapabilities(validated.plan);
      assert(revision.definition.trigger.kind==='manual','AUTOMATION_MANUAL_TRIGGER_REQUIRED');
      for(const value of Object.values(input.values??{}))assertTemporalLiteralInput(value.type,value.value);
      // Scheduled occurrences use the activator. A manual run belongs to the
      // actual requester and must recheck that person's native access later.
      const accepted=await this.acceptRun(tx,s,{...flow,activator_hash:actor.key,activator_ciphertext:actor.encryptedUserId},revision,input.requestId,input.values??{});
      await this.record(tx,s,actor,input.requestId,requestHash,id,accepted.revision,'START',accepted.id);return accepted;
    });
  }
  async acceptRun(tx:Tx,s:Scope,flow:FlowRow,revision:RevisionRow,dedupeKey:string,values:Record<string,EvaluatedValue>,occurrence?:ScheduleOccurrenceSnapshot) {
    const inputHash=fingerprint(values),old=(await sql<{id:string;input_hash:string;flow_id:string;revision:number}>`SELECT id,input_hash,flow_id,revision FROM automation_runs WHERE ${tenant(s)} AND dedupe_key=${dedupeKey}`.execute(tx)).rows[0];
    if(old){assert(old.input_hash===inputHash&&old.flow_id===flow.id,'AUTOMATION_REQUEST_CONFLICT',409);return {id:old.id,state:'EXISTING',revision:old.revision};}
    assert(flow.activator_ciphertext&&flow.activator_hash,'AUTOMATION_IDENTITY_REQUIRED',403);
    const now=this.now(),month=await reserveAutomationQuota(tx,s,this.limits,now),id=randomUUID();
    // Values are validated by the same language contracts before persistence.
    const context=validateFlowDefinition(revision.definition,{...await scratchNumericOptions(revision.definition),temporalResolution:'fixed'});assert(context.plan,'AUTOMATION_DEFINITION_INVALID');
    const declared='inputs' in revision.definition.trigger?revision.definition.trigger.inputs:[];
    assert(Object.keys(values).every(key=>declared.some(variable=>variable.id===key)),'AUTOMATION_INPUT_UNDECLARED');
    const normalized:Record<string,EvaluatedValue>={};
    for(const variable of declared){const value=values[variable.id];assert(value&&JSON.stringify(value.type)===JSON.stringify(variable.type),'AUTOMATION_INPUT_INVALID');const evaluated=evaluateValue({kind:'literal',type:variable.type,value:value.value},{guildId:s.guildId,variables:{},limits:context.plan.limits,semanticProfile:context.plan.definition.semanticProfile});normalized[variable.id]={...evaluated,provenance:[{source:'input',guildId:s.guildId,resumable:true}]};}
    const resume:ResumeState={frames:[{path:'body',index:0,locals:[]}],variables:normalized,startedAt:now.toISOString(),steps:0,evaluations:0,externalActions:0};
    if(occurrence)resume.scheduleOccurrence=structuredClone(occurrence);
    if(context.plan.definition.semanticProfile==='scratch.v1'){resume.semanticProfile='scratch.v1';resume.checkpointVersion=0;}
    assert(Buffer.byteLength(JSON.stringify(resume))<=context.plan.limits.maxValueBytes,'AUTOMATION_STATE_LIMIT');
    await sql`INSERT INTO automation_runs(organization_id,guild_id,id,flow_id,revision,semantic_hash,dedupe_key,input_hash,actor_hash,actor_ciphertext,beta_generation,status,usage_month,started_at,deadline_at,resume) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${flow.id},${revision.revision},${revision.semantic_hash},${dedupeKey},${inputHash},${flow.activator_hash},${flow.activator_ciphertext},${flow.beta_generation},'QUEUED',${month}::date,${now},${new Date(now.getTime()+MAX_RUN_SECONDS*1000)},${json(resume)})`.execute(tx);
    return {id,state:'QUEUED',revision:revision.revision};
  }
  async approvals(s:Scope,actor:Actor) {
    await this.access(this.db,s,actor,'GOVERN');
    const rows=(await sql<AutomationApproval>`SELECT a.* FROM automation_approvals a JOIN automation_runs r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.id=a.run_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.state='PENDING' AND a.expires_at>${this.now()} AND r.ended_at IS NULL AND r.cancel_requested_at IS NULL ORDER BY a.requested_at LIMIT 100`.execute(this.db)).rows;
    const items=[];
    for(const row of rows){
      const item={id:row.id,runId:row.run_id,revision:row.revision,operation:row.operation,fingerprint:row.fingerprint,inputs:row.inputs,expiresAt:row.expires_at.toISOString()};
      if(!['discord.addRole','discord.removeRole'].includes(row.operation)){items.push(item);continue;}
      try{
        const run=await this.store.run(s,row.run_id);
        assert(run,'AUTOMATION_RUN_NOT_FOUND',404);
        const policy=await this.roleApprovalPolicy(this.db,s,run,row,actor);
        items.push({...item,policyFingerprint:policy.fingerprint,changedChannelCount:policy.changedChannelCount});
      }catch(error){
        // One unavailable native proof must not hide unrelated approvals. Only
        // bounded public codes are exposed; transport messages/identities are not.
        const code=isDomainError(error)&&/^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)?error.code:'AUTOMATION_ROLE_POLICY_UNAVAILABLE';
        items.push({...item,policyUnavailableReason:code});
      }
    }
    return {items};
  }
  private async roleApprovalPolicy(tx:Tx,s:Scope,run:RunRecord,approval:AutomationApproval,actor:Actor){
    assert(this.options.approvalPolicy,'AUTOMATION_ROLE_POLICY_UNAVAILABLE',503);
    const policy=await this.options.approvalPolicy(tx,s,run,approval,actor);
    assert(typeof policy?.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(policy.fingerprint)&&Number.isSafeInteger(policy.changedChannelCount)&&policy.changedChannelCount>=0,'AUTOMATION_ROLE_POLICY_UNAVAILABLE',503);
    return policy;
  }
  async decideApproval(s:Scope,actor:Actor,id:string,input:{decision:'APPROVE'|'REJECT';fingerprint:string;requestId:string;policyFingerprint?:string}) {
    return this.db.transaction().execute(async tx=>{
      await this.access(tx,s,actor,'GOVERN');await automationLock(tx,s);
      assert(actor.encryptedUserId,'AUTOMATION_IDENTITY_REQUIRED',403);
      const row=(await sql<AutomationApproval&{request_id:string|null}>`SELECT * FROM automation_approvals WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row,'AUTOMATION_APPROVAL_NOT_FOUND',404);
      assert(row.fingerprint===input.fingerprint,'AUTOMATION_APPROVAL_CHANGED',409);
      const desired=input.decision==='APPROVE'?'APPROVED':'REJECTED';
      const needsPolicy=desired==='APPROVED'&&['discord.addRole','discord.removeRole'].includes(row.operation);
      if(needsPolicy)assert(typeof input.policyFingerprint==='string'&&/^[a-f0-9]{64}$/.test(input.policyFingerprint),'AUTOMATION_APPROVAL_POLICY_REQUIRED',409);
      if(row.state!=='PENDING'){
        assert(row.state===desired&&row.request_id===input.requestId&&row.approver_hash===actor.key,'AUTOMATION_APPROVAL_DECIDED',409);
        if(needsPolicy)assert(row.policy_fingerprint===input.policyFingerprint,'AUTOMATION_APPROVAL_POLICY_CHANGED',409);
        return {id,state:row.state};
      }
      assert(row.expires_at>this.now(),'AUTOMATION_APPROVAL_EXPIRED',409);
      const run=await this.store.run(s,row.run_id,tx);assert(run&&!run.ended_at&&!run.cancel_requested_at&&run.revision===row.revision&&run.deadline_at>this.now(),'AUTOMATION_STOPPED');
      let policyFingerprint:string|null=null;
      if(needsPolicy){
        const policy=await this.roleApprovalPolicy(tx,s,run,row,actor);
        assert(policy.fingerprint===input.policyFingerprint,'AUTOMATION_APPROVAL_POLICY_CHANGED',409);
        policyFingerprint=policy.fingerprint;
        const latest=await this.store.run(s,row.run_id,tx);
        assert(latest&&!latest.ended_at&&!latest.cancel_requested_at&&latest.revision===row.revision&&latest.deadline_at>this.now(),'AUTOMATION_STOPPED',409);
        assert(row.expires_at>this.now(),'AUTOMATION_APPROVAL_EXPIRED',409);
      }
      await sql`UPDATE automation_approvals SET state=${desired},approver_hash=${actor.key},approver_ciphertext=${actor.encryptedUserId},request_id=${input.requestId}::uuid,decided_at=${this.now()},policy_fingerprint=${policyFingerprint} WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
      await sql`UPDATE automation_runs SET status='QUEUED',wake_at=NULL,updated_at=now() WHERE ${tenant(s)} AND id=${row.run_id}::uuid AND status IN('WAITING','WAITING_APPROVAL')`.execute(tx);
      return {id,state:desired};
    });
  }
  async cancel(s:Scope,actor:Actor,runId:string,requestId:string) {
    return this.db.transaction().execute(async tx=>{
      await this.access(tx,s,actor,'CONFIGURE');await automationLock(tx,s);
      const hash=fingerprint({kind:'CANCEL',runId}),old=await this.replay(tx,s,actor,requestId,hash);
      if(old)return {id:runId,state:'CONFIRMED',requestId};
      const run=await this.store.run(s,runId,tx);assert(run,'AUTOMATION_RUN_NOT_FOUND',404);
      await this.store.cancelInTransaction(tx,s,runId,this.now());
      await this.record(tx,s,actor,requestId,hash,run.flow_id,run.revision,'CANCEL',runId);
      return {id:runId,state:'CONFIRMED',requestId};
    });
  }
  async eventReceipts(s:Scope,actor:Actor,flowId?:string) {
    await this.access(this.db,s,actor,'READ');
    if(flowId)await this.flow(this.db,s,flowId);
    const rows=(await sql<{source:'INTERNAL'|'INTERACTION';event_id:string;flow_id:string;revision:number;state:'PENDING'|'STARTED'|'SKIPPED';reason:string|null;run_id:string|null;occurred_at:Date}>`SELECT source,event_id,flow_id,revision,state,reason,run_id,occurred_at FROM automation_event_inbox WHERE ${tenant(s)} ${flowId?sql`AND flow_id=${flowId}`:sql``} ORDER BY occurred_at DESC,event_id,flow_id,revision LIMIT 100`.execute(this.db)).rows;
    // Only receipt metadata is public. Actor identities, native instance IDs,
    // ticket/channel identifiers and resumable input values stay internal.
    return {items:rows.map(row=>({source:row.source,eventId:row.event_id,flowId:row.flow_id,revision:row.revision,state:row.state,reason:row.reason&&/^[A-Z][A-Z0-9_]{0,100}$/.test(row.reason)?row.reason:row.reason?'AUTOMATION_EVENT_FAILED':null,runId:row.run_id,occurredAt:row.occurred_at.toISOString()}))};
  }
  async overview(s:Scope,actor:Actor) {
    const listed=await this.list(s,actor),month=this.now().toISOString().slice(0,7)+'-01';
    const usage=(await sql<{reserved:number;consumed:number}>`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(s)} AND month=${month}::date`.execute(this.db)).rows[0]??{reserved:0,consumed:0};
    const runs=(await sql<{id:string;flow_id:string;status:string;started_at:Date;ended_at:Date|null;wake_at:Date|null}>`SELECT id,flow_id,status,started_at,ended_at,wake_at FROM automation_runs WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 30`.execute(this.db)).rows;
    const schedules=(await sql<{id:string;next_at:Date;definition:FlowDefinition}>`SELECT a.id,a.next_at,r.definition FROM automation_schedules a JOIN automation_revisions r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.flow_id=a.flow_id AND r.revision=a.revision WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.enabled AND a.next_at IS NOT NULL ORDER BY a.next_at LIMIT 5`.execute(this.db)).rows;
    const receipts=await this.eventReceipts(s,actor);
    return {flows:listed.items.map(flow=>({...flow,revision:flow.draftRevision})),runs:runs.map(run=>({id:run.id,flowId:run.flow_id,state:run.status,startedAt:run.started_at.toISOString(),endedAt:run.ended_at?.toISOString()??null,dueAt:run.wake_at?.toISOString()??null})),eventReceipts:receipts.items,nextOccurrences:schedules.map(schedule=>({id:schedule.id,at:schedule.next_at.toISOString(),timezone:schedule.definition.trigger.kind==='schedule'?(schedule.definition.trigger.schedule.kind==='once'?schedule.definition.trigger.schedule.at.timeZone:schedule.definition.trigger.schedule.kind==='elapsed'?'UTC':schedule.definition.trigger.schedule.timeZone):'UTC'})),usage:{limit:this.limits.monthlyRuns,...usage,compensated:0,remaining:Math.max(0,this.limits.monthlyRuns-usage.reserved-usage.consumed),updatedAt:this.now().toISOString()},status:this.limits.measurementId?'AVAILABLE':'CAPACITY_UNMEASURED'};
  }
}
