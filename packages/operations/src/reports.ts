import { z } from "zod";
import { sql, tenant, json, type Database, type Tx } from "../../db/src/index";
import { createHash, randomUUID } from "node:crypto";
import { assert, isDomainError, type Scope } from "../../shared/src/index";
import { SettingsService, type Actor } from "../../settings/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { chartQuerySchema, type ChartSpec } from "../../analytics/src/chart-spec";
import { operationsAccess, operationsAudit, operationsLock, actorPermissions } from "./policy";
import { configHash } from "../../settings/src/revisions";
import { scheduleInput, nextReportOccurrence } from "./schedule";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import { minimalOperationAudit } from "./alpha16-audit";
import { assertMaintenanceAuthorization, type MaintenanceAuthorizationProof } from "./maintenance-authorization";
import { analysisChannelScope } from "../../lifecycle/src/discovery";
export type ManualReportProfile = { enabled: boolean; artifactRetentionApproved: boolean; artifactRetentionSeconds: number | null;
  policyRevision: string | null; leaseSeconds: number | null; privacyCoverageVerified: boolean;
  maxPendingRuns?: number | null; maxResultBytes?: number | null; sourceVisibilityVerified?: boolean };
export const manualReportRequestInput = z.object({ templateId: z.uuid(), templateRevision: z.number().int().positive(), requestId: z.uuid() }).strict();
export const reportRemovalInput = z.object({ id: z.uuid(), revision: z.number().safe().int().positive() }).strict();
export const manualReportSnapshotSchema = z.object({ version: z.literal(1), asOf: z.iso.datetime(), templateId: z.uuid(), templateRevision: z.number().int().positive(), sourceFence: z.string().regex(/^[a-f0-9]{64}$/),
  definitionRevisionId:z.uuid().nullable().optional(),definitionContentHash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),definitionReferenceHash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  title: z.string().min(1).max(120), footer: z.string().max(200), queries: z.array(chartQuerySchema).min(1).max(4),
  includeAttention: z.boolean(), includeInterventions: z.boolean(),
  savedViews: z.array(z.object({ id: z.uuid(), revision: z.number().int().positive(), segmentId: z.uuid(), segmentRevision: z.number().int().positive() }).strict()).max(4),
}).strict();
export type ManualReportSnapshot = z.infer<typeof manualReportSnapshotSchema>;
export type ManualReportArtifact = { version: 1; asOf: string; templateRevision: number; sourceFence: string; title: string; footer: string; charts: ChartSpec[];
  summary: { openAttention: number | null; reviewsReady: number | null }; deliveryMode: "NONE" };
export function manualReportReadiness(profile?: ManualReportProfile) {
  const blockers: string[] = [];
  if (!profile?.enabled) blockers.push("MANUAL_REPORT_DISABLED");
  if (!profile?.artifactRetentionApproved || !profile.policyRevision || !Number.isSafeInteger(profile.artifactRetentionSeconds) || (profile.artifactRetentionSeconds ?? 0) <= 0)
    blockers.push("REPORT_ARTIFACT_RETENTION_REQUIRED");
  if (!Number.isSafeInteger(profile?.leaseSeconds) || (profile?.leaseSeconds ?? 0) <= 0) blockers.push("REPORT_RUNTIME_PROFILE_REQUIRED");
  if (!profile?.privacyCoverageVerified) blockers.push("REPORT_PRIVACY_COVERAGE_UNVERIFIED");
  if (!profile?.sourceVisibilityVerified) blockers.push("REPORT_SOURCE_VISIBILITY_UNVERIFIED");
  if (!Number.isSafeInteger(profile?.maxPendingRuns) || (profile?.maxPendingRuns ?? 0) <= 0 || !Number.isSafeInteger(profile?.maxResultBytes) || (profile?.maxResultBytes ?? 0) <= 0 || (profile?.maxResultBytes ?? Infinity) > 1048576)
    blockers.push("REPORT_BUDGET_PROFILE_REQUIRED");
  return { enabled: blockers.length === 0, blockers };
}
type ManualReportRun = { id: string; state: string; scheduled_at: Date; template_revision: number; requested_by_actor_hash: string | null;
  requested_by_actor_ciphertext: string | null; manual_input: unknown; result_payload: ManualReportArtifact | null; result_expires_at: Date | null; state_version: string | number; lease_token: string | null };
async function manualReportSourceFence(tx: Tx, s: Scope) {
  const cfg = await new SettingsService(tx).get(s), scope = await analysisChannelScope(tx, s, cfg);
  const recipes = (await sql`SELECT id,revision,definition_version FROM measurement_recipe_versions WHERE ${tenant(s)} ORDER BY id`.execute(tx)).rows;
  const head = (await sql`SELECT recipe_version_id FROM measurement_recipe_heads WHERE ${tenant(s)}`.execute(tx)).rows;
  return createHash("sha256").update(JSON.stringify({ settingsRevision: cfg.revision,
    channels: [...scope.channels].sort((a, b) => a.id.localeCompare(b.id)), actualChannelIds: [...scope.actualChannelIds].sort(), recipes, head })).digest("hex");
}
export const logoSchema = z
  .string()
  .max(140000)
  .nullable()
  .default(null)
  .refine((value) => {
    if (value === null) return true;
    try {
      const bytes = Buffer.from(value, "base64");
      return (
        bytes.toString("base64") === value &&
        bytes.length >= 24 &&
        bytes.length <= 100000 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR" &&
        bytes.readUInt32BE(16) <= 1024 &&
        bytes.readUInt32BE(20) <= 1024
      );
    } catch {
      return false;
    }
  }, "INVALID_PNG_LOGO");
const reportDefinitionFields = {
    title: z.string().trim().min(1).max(120),
    footer: z.string().max(200).default(""),
    logoBase64: logoSchema,
    queries: z.array(chartQuerySchema).max(4).default([]),
    viewIds: z.array(z.uuid()).max(4).default([]).transform(ids=>[...ids].sort()),
    includeAttention: z.boolean().default(true),
    includeInterventions: z.boolean().default(true),
};
const validChartCount = (input: {queries: unknown[];viewIds: string[]}) => input.queries.length + input.viewIds.length >= 1 && input.queries.length + input.viewIds.length <= 4 && new Set(input.viewIds).size === input.viewIds.length;
export const reportDefinitionSchema = z.object(reportDefinitionFields).strict().refine(validChartCount, "CHOOSE_ONE_TO_FOUR_CHARTS");
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;
export const reportTemplateInput = z
  .object({ id: z.uuid().optional(), revision: z.number().int().positive().optional(), ...reportDefinitionFields })
  .strict()
  .refine(
    validChartCount,
    "CHOOSE_ONE_TO_FOUR_CHARTS",
  );
const reportDefinitionHash = z.string().regex(/^[a-f0-9]{64}$/);
export const reportDraftCreateInput = z.object({draftId:z.uuid(),revisionId:z.uuid(),templateId:z.uuid(),liveVersion:z.string().min(1).max(128),definition:reportDefinitionSchema}).strict();
export const reportDraftEditInput = z.object({version:z.number().int().positive(),sourceRevisionId:z.uuid(),revisionId:z.uuid(),definition:reportDefinitionSchema}).strict();
export const reportDraftCommitInput = z.object({version:z.number().int().positive(),headRevisionId:z.uuid(),confirmationHash:reportDefinitionHash,liveVersion:z.string().min(1).max(128)}).strict();
type ReportReference = {id:string;revision:number;segmentId:string;segmentRevision:number};
type ReportDraftRow = {id:string;template_id:string;head_revision_id:string;version:number;base_template_revision:number;base_content_hash:string;base_reference_hash:string;state:"DRAFT"|"COMMITTED";committed_template_revision:number|null;commit_confirmation_hash:string|null;committed_live_version:string|null;created_at:Date;updated_at:Date;actor_hash:string|null};
type ReportRevisionRow = {id:string;template_id:string;ordinal:number;draft_id:string|null;draft_version:number|null;source_revision_id:string|null;definition:unknown;content_hash:string;reference_hash:string;reference_metadata:ReportReference[];actor_hash:string|null};
export interface ReportDefinitionCurrent {templateId:string;templateRevision:number;definitionRevisionId:string|null;definition:ReportDefinition;contentHash:string;referenceHash:string;references:ReportReference[];liveVersion:string;bindingVerified:boolean;}
export class Reports {
  constructor(private readonly db: Database, private readonly options: { manual?: ManualReportProfile; authorization?: MaintenanceAuthorizationProof } = {}) {}
  readiness() { return manualReportReadiness(this.options.manual); }
  private manualPolicy() { assert(this.readiness().enabled && this.options.manual, "REPORT_ARTIFACT_RETENTION_REQUIRED", 503); return this.options.manual; }
  private async definitionAccess(tx:Tx,s:Scope,actor:Actor,permission:"READ"|"CONFIGURE") {
    assertMaintenanceAuthorization(this.options.authorization,s,actor);
    await operationsAccess(tx,s,actor,permission,permission==="CONFIGURE"?"scheduled_reports":undefined);
    assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(tx)).rows.length,"RESOURCE_DELETED",410);
    const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
    assertMaintenanceAuthorization(this.options.authorization,s,actor,now);
  }
  private async definitionTransaction<T>(s:Scope,actor:Actor,permission:"READ"|"CONFIGURE",work:(tx:Tx)=>Promise<T>):Promise<T> {
    return this.db.transaction().execute(async tx=>{
      await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));await this.definitionAccess(tx,s,actor,permission);await operationsLock(tx,s);
      await this.definitionAccess(tx,s,actor,permission);const result=await work(tx);await this.definitionAccess(tx,s,actor,permission);return result;
    });
  }
  private async definitionReferences(tx:Tx,s:Scope,ids:readonly string[]):Promise<ReportReference[]> {
    const references:ReportReference[]=[];
    for(const id of [...ids].sort()){
      const row=(await sql<{id:string;revision:number;segment_id:string;segment_revision:number}>`SELECT v.id,v.revision,v.segment_id,g.revision AS segment_revision FROM saved_metric_views v JOIN operational_segments g ON g.organization_id=v.organization_id AND g.guild_id=v.guild_id AND g.id=v.segment_id WHERE v.organization_id=${s.organizationId}::uuid AND v.guild_id=${s.guildId} AND v.id=${id}::uuid`.execute(tx)).rows[0];
      assert(row,"SAVED_VIEW_NOT_FOUND",404);references.push({id:row.id,revision:row.revision,segmentId:row.segment_id,segmentRevision:row.segment_revision});
    }
    return references;
  }
  private definitionVersion(revision:number,contentHash:string,referenceHash:string){return `${revision}:${configHash({contentHash,referenceHash})}`;}
  /** Pure read for already scoped native writers/worker provenance capture.
   * lock=true obtains the native operations fence and parent target row before
   * any Suggestion/Draft locks. Missing legacy heads are never synthesized. */
  async currentDefinitionInTransaction(tx:Tx,s:Scope,id:string,lock=false):Promise<ReportDefinitionCurrent> {
    assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);z.uuid().parse(id);if(lock)await operationsLock(tx,s);
    const row=(await sql<{id:string;revision:number;definition_revision_id:string|null;title:string;footer:string;logo_base64:string|null;queries:unknown;include_attention:boolean;include_interventions:boolean}>`SELECT id,revision,definition_revision_id,title,footer,logo_base64,queries,include_attention,include_interventions FROM report_templates WHERE ${tenant(s)} AND id=${id}::uuid ${lock?sql`FOR UPDATE`:sql``}`.execute(tx)).rows[0];assert(row,"REPORT_TEMPLATE_NOT_FOUND",404);
    const viewIds=(await sql<{view_id:string}>`SELECT view_id FROM report_template_views WHERE ${tenant(s)} AND template_id=${id}::uuid ORDER BY view_id`.execute(tx)).rows.map(view=>view.view_id);
    const definition=reportDefinitionSchema.parse({title:row.title,footer:row.footer,logoBase64:row.logo_base64,queries:row.queries,viewIds,includeAttention:row.include_attention,includeInterventions:row.include_interventions}),references=await this.definitionReferences(tx,s,viewIds),contentHash=configHash(definition),referenceHash=configHash(references);
    const head=row.definition_revision_id?(await sql<{content_hash:string;reference_hash:string}>`SELECT content_hash,reference_hash FROM report_definition_revisions WHERE ${tenant(s)} AND template_id=${id}::uuid AND id=${row.definition_revision_id}::uuid`.execute(tx)).rows[0]:null;
    return {templateId:id,templateRevision:row.revision,definitionRevisionId:row.definition_revision_id,definition,contentHash,referenceHash,references,liveVersion:this.definitionVersion(row.revision,contentHash,referenceHash),bindingVerified:!!head&&head.content_hash===contentHash&&head.reference_hash===referenceHash};
  }
  private async appendDefinitionRevision(tx:Tx,s:Scope,actor:Actor,templateId:string,definition:ReportDefinition,options:{draftId?:string;draftVersion?:number;revisionId?:string;sourceRevisionId?:string}={}) {
    const references=await this.definitionReferences(tx,s,definition.viewIds),contentHash=configHash(definition),referenceHash=configHash(references),id=options.revisionId??randomUUID();
    const ordinal=(await sql<{n:number}>`SELECT COALESCE(max(ordinal),0)::integer+1 AS n FROM report_definition_revisions WHERE ${tenant(s)} AND template_id=${templateId}::uuid`.execute(tx)).rows[0]!.n;
    await sql`INSERT INTO report_definition_revisions(organization_id,guild_id,id,template_id,ordinal,draft_id,draft_version,source_revision_id,definition,content_hash,reference_hash,reference_metadata,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${templateId}::uuid,${ordinal},${options.draftId??null}::uuid,${options.draftVersion??null},${options.sourceRevisionId??null}::uuid,${json(definition)},${contentHash},${referenceHash},${json(references)},${actor.key})`.execute(tx);
    return {id,ordinal,contentHash,referenceHash};
  }
  private async definitionDraft(tx:Tx,s:Scope,id:string,lock=false){
    const row=(await sql<ReportDraftRow>`SELECT * FROM report_definition_drafts WHERE ${tenant(s)} AND id=${id}::uuid ${lock?sql`FOR UPDATE`:sql``}`.execute(tx)).rows[0];assert(row,"REPORT_DRAFT_NOT_FOUND",404);return row;
  }
  private async definitionRevision(tx:Tx,s:Scope,templateId:string,id:string){
    const row=(await sql<ReportRevisionRow>`SELECT * FROM report_definition_revisions WHERE ${tenant(s)} AND template_id=${templateId}::uuid AND id=${id}::uuid`.execute(tx)).rows[0];assert(row,"REPORT_DEFINITION_REVISION_NOT_FOUND",404);return row;
  }
  private draftDto(row:ReportDraftRow,revision:ReportRevisionRow){return {draftId:row.id,templateId:row.template_id,version:row.version,headRevisionId:row.head_revision_id,state:row.state,definition:reportDefinitionSchema.parse(revision.definition),contentHash:revision.content_hash,referenceHash:revision.reference_hash,baseLiveVersion:this.definitionVersion(row.base_template_revision,row.base_content_hash,row.base_reference_hash),committedTemplateRevision:row.committed_template_revision,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString()};}
  /** Adds only an immutable draft/header; never changes active configuration. */
  async draftInTransaction(tx:Tx,s:Scope,actor:Actor,templateId:string,liveVersion:string,input:unknown,identity:{draftId:string;revisionId:string}={draftId:randomUUID(),revisionId:randomUUID()},beforeWrite?:(tx:Tx)=>Promise<void>){
    assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);z.uuid().parse(identity.draftId);z.uuid().parse(identity.revisionId);const definition=reportDefinitionSchema.parse(input);
    await this.definitionAccess(tx,s,actor,"CONFIGURE");const current=await this.currentDefinitionInTransaction(tx,s,templateId,true);
    const existing=(await sql<ReportDraftRow>`SELECT * FROM report_definition_drafts WHERE ${tenant(s)} AND id=${identity.draftId}::uuid`.execute(tx)).rows[0];
    if(existing){const revision=await this.definitionRevision(tx,s,templateId,identity.revisionId);assert(existing.template_id===templateId&&revision.draft_id===existing.id&&revision.draft_version===1&&revision.actor_hash===actor.key&&revision.source_revision_id===null&&revision.content_hash===configHash(definition)&&this.definitionVersion(existing.base_template_revision,existing.base_content_hash,existing.base_reference_hash)===liveVersion,"REPORT_DRAFT_REQUEST_CONFLICT",409);return this.draftDto(existing,await this.definitionRevision(tx,s,templateId,existing.head_revision_id));}
    assert(current.liveVersion===liveVersion,"REPORT_DEFINITION_CONFLICT",412);await beforeWrite?.(tx);
    await this.appendDefinitionRevision(tx,s,actor,templateId,definition,{...identity,draftVersion:1});
    await sql`INSERT INTO report_definition_drafts(organization_id,guild_id,id,template_id,head_revision_id,base_template_revision,base_content_hash,base_reference_hash,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${identity.draftId}::uuid,${templateId}::uuid,${identity.revisionId}::uuid,${current.templateRevision},${current.contentHash},${current.referenceHash},${actor.key})`.execute(tx);
    await this.definitionAccess(tx,s,actor,"CONFIGURE");await beforeWrite?.(tx);await operationsAudit(tx,s,actor.key,"REPORT_DEFINITION_DRAFT_CREATED",templateId,1);await beforeWrite?.(tx);
    const draft=await this.definitionDraft(tx,s,identity.draftId);return this.draftDto(draft,await this.definitionRevision(tx,s,templateId,draft.head_revision_id));
  }
  async createDefinitionDraft(s:Scope,actor:Actor,raw:unknown){const data=reportDraftCreateInput.parse(raw);return this.definitionTransaction(s,actor,"CONFIGURE",tx=>this.draftInTransaction(tx,s,actor,data.templateId,data.liveVersion,data.definition,{draftId:data.draftId,revisionId:data.revisionId}));}
  async definitionCatalog(s:Scope,actor:Actor){return this.definitionTransaction(s,actor,"READ",async tx=>{
    const templates=(await sql<{id:string;title:string;revision:number}>`SELECT id,title,revision FROM report_templates WHERE ${tenant(s)} ORDER BY title,id LIMIT 100`.execute(tx)).rows;
    const drafts=(await sql<{id:string;template_id:string;version:number;state:string}>`SELECT id,template_id,version,state FROM report_definition_drafts WHERE ${tenant(s)} ORDER BY updated_at DESC,id LIMIT 100`.execute(tx)).rows;
    const views=await new EntitlementService(tx).can(s,"surface_breakdowns")?(await sql<{id:string;name:string}>`SELECT id,name FROM saved_metric_views WHERE ${tenant(s)} ORDER BY name,id LIMIT 100`.execute(tx)).rows:[];
    const permissions=await actorPermissions(tx,s,actor),featureAvailable=await new EntitlementService(tx).can(s,"scheduled_reports");
    return {templates,drafts,views,permissions,featureAvailable,canConfigure:permissions.includes("CONFIGURE")&&featureAvailable,deliveryMode:"NONE",purpose:"REPORT_DEFINITION"};
  });}
  async definitionDetail(s:Scope,actor:Actor,id:string){return this.definitionTransaction(s,actor,"READ",tx=>this.currentDefinitionInTransaction(tx,s,id));}
  async definitionDraftDetail(s:Scope,actor:Actor,id:string){z.uuid().parse(id);return this.definitionTransaction(s,actor,"READ",async tx=>{const row=await this.definitionDraft(tx,s,id);return this.draftDto(row,await this.definitionRevision(tx,s,row.template_id,row.head_revision_id));});}
  async editDefinitionDraft(s:Scope,actor:Actor,id:string,raw:unknown){z.uuid().parse(id);const data=reportDraftEditInput.parse(raw);return this.definitionTransaction(s,actor,"CONFIGURE",async tx=>{
    const observed=await this.definitionDraft(tx,s,id);await this.currentDefinitionInTransaction(tx,s,observed.template_id,true);const row=await this.definitionDraft(tx,s,id,true);
    const prior=(await sql<ReportRevisionRow>`SELECT * FROM report_definition_revisions WHERE ${tenant(s)} AND id=${data.revisionId}::uuid`.execute(tx)).rows[0];
    if(prior){assert(prior.draft_id===id&&prior.draft_version===data.version+1&&prior.template_id===row.template_id&&prior.source_revision_id===data.sourceRevisionId&&prior.actor_hash===actor.key&&prior.content_hash===configHash(data.definition),"REPORT_DRAFT_REQUEST_CONFLICT",409);return {...this.draftDto(row,await this.definitionRevision(tx,s,row.template_id,row.head_revision_id)),deduplicated:true};}
    assert(row.state==="DRAFT"&&row.version===data.version&&row.head_revision_id===data.sourceRevisionId,"REPORT_DRAFT_CONFLICT",412);
    await this.appendDefinitionRevision(tx,s,actor,row.template_id,data.definition,{draftId:id,draftVersion:data.version+1,revisionId:data.revisionId,sourceRevisionId:data.sourceRevisionId});
    await sql`UPDATE report_definition_drafts SET head_revision_id=${data.revisionId}::uuid,version=version+1,actor_hash=${actor.key},updated_at=clock_timestamp() WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
    await operationsAudit(tx,s,actor.key,"REPORT_DEFINITION_DRAFT_EDITED",row.template_id,row.version+1);const next=await this.definitionDraft(tx,s,id);return this.draftDto(next,await this.definitionRevision(tx,s,row.template_id,next.head_revision_id));
  });}
  private async previewDefinition(tx:Tx,s:Scope,row:ReportDraftRow,current:ReportDefinitionCurrent){
    const revision=await this.definitionRevision(tx,s,row.template_id,row.head_revision_id),definition=reportDefinitionSchema.parse(revision.definition),blockers:string[]=[];
    if(row.state!=="DRAFT")blockers.push("REPORT_DRAFT_ALREADY_COMMITTED");
    if(current.templateRevision!==row.base_template_revision||current.contentHash!==row.base_content_hash||current.referenceHash!==row.base_reference_hash)blockers.push("REPORT_DEFINITION_CONFLICT");
    try{if(configHash(await this.definitionReferences(tx,s,definition.viewIds))!==revision.reference_hash)blockers.push("REPORT_DRAFT_REFERENCE_CHANGED");}catch(error){if(!isDomainError(error))throw error;blockers.push(error.code);}
    const confirmationHash=configHash({draftId:row.id,version:row.version,headRevisionId:row.head_revision_id,contentHash:revision.content_hash,referenceHash:revision.reference_hash,baseLiveVersion:this.definitionVersion(row.base_template_revision,row.base_content_hash,row.base_reference_hash),currentLiveVersion:current.liveVersion});
    return {draft:this.draftDto(row,revision),current,changedFields:(Object.keys(reportDefinitionFields) as (keyof ReportDefinition)[]).filter(key=>configHash(current.definition[key])!==configHash(definition[key])),blockers,canCommit:blockers.length===0,confirmationHash,deliveryMode:"NONE"};
  }
  async previewDefinitionDraft(s:Scope,actor:Actor,id:string){z.uuid().parse(id);return this.definitionTransaction(s,actor,"READ",async tx=>{const row=await this.definitionDraft(tx,s,id),preview=await this.previewDefinition(tx,s,row,await this.currentDefinitionInTransaction(tx,s,row.template_id));return {...preview,canCommit:preview.canCommit&&(await actorPermissions(tx,s,actor)).includes("CONFIGURE")&&await new EntitlementService(tx).can(s,"scheduled_reports")};});}
  async commitDefinitionDraft(s:Scope,actor:Actor,id:string,raw:unknown){z.uuid().parse(id);const data=reportDraftCommitInput.parse(raw);return this.definitionTransaction(s,actor,"CONFIGURE",async tx=>{
    const observed=await this.definitionDraft(tx,s,id),current=await this.currentDefinitionInTransaction(tx,s,observed.template_id,true),row=await this.definitionDraft(tx,s,id,true);
    if(row.state==="COMMITTED"){assert(row.version===data.version+1&&row.head_revision_id===data.headRevisionId&&row.commit_confirmation_hash===data.confirmationHash&&row.committed_live_version===data.liveVersion,"REPORT_DRAFT_REQUEST_CONFLICT",409);return {templateId:row.template_id,templateRevision:row.committed_template_revision,draftId:id,headRevisionId:row.head_revision_id,state:row.state,deduplicated:true,deliveryMode:"NONE"};}
    assert(row.version===data.version&&row.head_revision_id===data.headRevisionId&&current.liveVersion===data.liveVersion,"REPORT_DRAFT_CONFLICT",412);
    const preview=await this.previewDefinition(tx,s,row,current);assert(preview.canCommit,"REPORT_DEFINITION_CONFLICT",412);assert(preview.confirmationHash===data.confirmationHash,"REPORT_PREVIEW_REQUIRED",409);
    const revision=await this.definitionRevision(tx,s,row.template_id,row.head_revision_id),definition=reportDefinitionSchema.parse(revision.definition);
    const saved=await this.saveTemplateInTransaction(tx,s,actor,{id:row.template_id,revision:current.templateRevision,...definition},revision);
    await sql`UPDATE report_definition_drafts SET state='COMMITTED',version=version+1,committed_template_revision=${saved.revision},committed_at=clock_timestamp(),commit_confirmation_hash=${data.confirmationHash},committed_live_version=${data.liveVersion},updated_at=clock_timestamp() WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
    await operationsAudit(tx,s,actor.key,"REPORT_DEFINITION_COMMITTED",row.template_id,saved.revision);return {templateId:row.template_id,templateRevision:saved.revision,draftId:id,headRevisionId:row.head_revision_id,state:"COMMITTED",deliveryMode:"NONE"};
  });}
  async discardDefinitionDraft(s:Scope,actor:Actor,id:string,version:number){z.uuid().parse(id);z.number().int().positive().parse(version);return this.definitionTransaction(s,actor,"CONFIGURE",async tx=>{
    const observed=await this.definitionDraft(tx,s,id);await this.currentDefinitionInTransaction(tx,s,observed.template_id,true);const row=await this.definitionDraft(tx,s,id,true);assert(row.state==="DRAFT"&&row.version===version,"REPORT_DRAFT_CONFLICT",412);
    await sql`DELETE FROM report_definition_drafts WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);await operationsAudit(tx,s,actor.key,"REPORT_DEFINITION_DRAFT_DELETED",row.template_id,version);return {draftId:id,deleted:true,deliveryMode:"NONE"};
  });}
  async requestGeneration(s: Scope, actor: Actor, input: unknown, now = new Date()) {
    const data = manualReportRequestInput.parse(input), profile = this.manualPolicy();
    assert(actor.encryptedUserId, "REPORT_CURRENT_AUTHORITY_REQUIRED", 503);
    assert(Number.isFinite(now.getTime()), "INVALID_REQUEST", 400);
    const expiresAt = new Date(now.getTime() + profile.artifactRetentionSeconds! * 1000);
    assert(Number.isFinite(expiresAt.getTime()), "REPORT_ARTIFACT_RETENTION_REQUIRED", 503);
    const fingerprint = createHash("sha256").update(JSON.stringify({ scope: s, actor: actor.key, ...data })).digest("hex");
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await operationsAccess(tx, s, actor, "ANALYZE", "scheduled_reports");
      await operationsLock(tx, s);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "ANALYZE", "scheduled_reports");
      const prior = (await sql<{ request_fingerprint: string; state: string; scheduled_at: Date; result_expires_at: Date | null }>`SELECT request_fingerprint,state,scheduled_at,result_expires_at FROM report_runs WHERE ${tenant(s)} AND id=${data.requestId}::uuid AND run_kind='MANUAL' FOR UPDATE`.execute(tx)).rows[0];
      if (prior) {
        assert(prior.request_fingerprint === fingerprint, "IDEMPOTENCY_CONFLICT", 409);
        assert(prior.result_expires_at && prior.result_expires_at > now, "REPORT_RESULT_EXPIRED", 410);
        return { id: data.requestId, state: prior.state, asOf: prior.scheduled_at.toISOString(), deliveryMode: "NONE" as const };
      }
      const pending = (await sql<{ count: number }>`SELECT count(*)::int AS count FROM report_runs WHERE ${tenant(s)} AND run_kind='MANUAL' AND state IN ('PENDING','RUNNING') AND result_expires_at>${now}`.execute(tx)).rows[0]!.count;
      assert(pending < profile.maxPendingRuns!, "REPORT_PENDING_LIMIT", 429);
      const template = (await sql<{ title: string; footer: string; queries: unknown; include_attention: boolean; include_interventions: boolean; revision: number }>`SELECT title,footer,queries,include_attention,include_interventions,revision FROM report_templates WHERE ${tenant(s)} AND id=${data.templateId}::uuid FOR SHARE`.execute(tx)).rows[0];
      assert(template, "REPORT_TEMPLATE_NOT_FOUND", 404);
      assert(template.revision === data.templateRevision, "REVISION_CONFLICT", 409);
      const queries = z.array(chartQuerySchema).max(4).parse(template.queries), savedViews: ManualReportSnapshot["savedViews"] = [];
      const views = (await sql<{ id: string; revision: number; metric_key: string; range_days: number; timezone: string; comparison: boolean; segment_id: string; segment_revision: number; filters: unknown }>`SELECT v.id,v.revision,v.metric_key,v.range_days,v.timezone,v.comparison,v.segment_id,g.revision AS segment_revision,g.filters FROM report_template_views t JOIN saved_metric_views v ON v.organization_id=t.organization_id AND v.guild_id=t.guild_id AND v.id=t.view_id JOIN operational_segments g ON g.organization_id=v.organization_id AND g.guild_id=v.guild_id AND g.id=v.segment_id WHERE t.organization_id=${s.organizationId}::uuid AND t.guild_id=${s.guildId} AND t.template_id=${data.templateId}::uuid ORDER BY v.id FOR SHARE OF v,g`.execute(tx)).rows;
      for (const view of views) {
        queries.push(chartQuerySchema.parse({ metric: view.metric_key, days: view.range_days, compare: view.comparison, timezone: view.timezone, filter: view.filters }));
        savedViews.push({ id: view.id, revision: view.revision, segmentId: view.segment_id, segmentRevision: view.segment_revision });
      }
      const binding=await this.currentDefinitionInTransaction(tx,s,data.templateId);
      const snapshot = manualReportSnapshotSchema.parse({ version: 1, asOf: now.toISOString(), templateId: data.templateId, templateRevision: template.revision, sourceFence: await manualReportSourceFence(tx, s),
        definitionRevisionId:binding.bindingVerified?binding.definitionRevisionId:null,definitionContentHash:binding.bindingVerified?binding.contentHash:null,definitionReferenceHash:binding.bindingVerified?binding.referenceHash:null,
        title: template.title, footer: template.footer, queries, includeAttention: template.include_attention, includeInterventions: template.include_interventions, savedViews });
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`INSERT INTO report_runs(organization_id,guild_id,id,schedule_id,scheduled_at,run_kind,manual_template_id,template_revision,requested_by_actor_hash,requested_by_actor_ciphertext,request_fingerprint,manual_input,result_expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${data.requestId}::uuid,NULL,${now},'MANUAL',${data.templateId}::uuid,${template.revision},${actor.key},${actor.encryptedUserId},${fingerprint},${json(snapshot)},${expiresAt})`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "REPORT_GENERATION_REQUESTED", data.templateId, template.revision);
      return { id: data.requestId, state: "PENDING", asOf: now.toISOString(), deliveryMode: "NONE" as const };
    });
  }
  async resultDetail(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async tx => {
      await operationsAccess(tx, s, actor, "READ", "scheduled_reports");
      const row = (await sql<ManualReportRun>`SELECT id,state,scheduled_at,template_revision,result_payload,result_expires_at,state_version FROM report_runs WHERE ${tenant(s)} AND id=${id}::uuid AND run_kind='MANUAL'`.execute(tx)).rows[0];
      assert(row, "REPORT_RESULT_NOT_FOUND", 404);
      const candidate = row.state === "SUCCEEDED" && row.result_payload !== null && row.result_expires_at !== null && row.result_expires_at.getTime() > Date.now();
      if (candidate) assertMaintenanceAuthorization(this.options.authorization, s, actor);
      const visible = candidate && this.options.manual?.sourceVisibilityVerified === true && row.result_payload!.sourceFence === await manualReportSourceFence(tx, s);
      const available = candidate && visible;
      if (available) {
        await operationsAccess(tx, s, actor, "READ", "scheduled_reports");
        assertMaintenanceAuthorization(this.options.authorization, s, actor);
      }
      return { id: row.id, state: row.state, revision: Number(row.state_version), asOf: row.scheduled_at.toISOString(), expiresAt: row.result_expires_at?.toISOString() ?? null,
        available, unavailableReason: available ? null : row.result_expires_at && row.result_expires_at.getTime() <= Date.now() ? "REPORT_RESULT_EXPIRED" : candidate ? "REPORT_SOURCE_VISIBILITY_CHANGED" : "REPORT_RESULT_UNAVAILABLE", artifact: available ? row.result_payload : null, deliveryMode: "NONE" as const };
    });
  }
  async deleteResult(s: Scope, actor: Actor, input: unknown) {
    const data = reportRemovalInput.parse(input);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s));
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      await operationsLock(tx, s);
      const row = (await sql<{ state_version: string | number }>`SELECT state_version FROM report_runs WHERE ${tenant(s)} AND id=${data.id}::uuid AND run_kind='MANUAL' FOR UPDATE`.execute(tx)).rows[0];
      assert(row, "REPORT_RESULT_NOT_FOUND", 404); assert(Number(row.state_version) === data.revision, "REVISION_CONFLICT", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`DELETE FROM report_runs WHERE ${tenant(s)} AND id=${data.id}::uuid AND run_kind='MANUAL'`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "REPORT_RESULT_DELETED", "report-artifact", data.revision);
      return { id: data.id, deleted: true as const };
    });
  }
  async removeTemplate(s: Scope, actor: Actor, input: unknown) {
    const data = reportRemovalInput.parse(input);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s)); await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports"); await operationsLock(tx, s);
      const row = (await sql<{ revision: number }>`SELECT revision FROM report_templates WHERE ${tenant(s)} AND id=${data.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row, "REPORT_TEMPLATE_NOT_FOUND", 404); assert(row.revision === data.revision, "REVISION_CONFLICT", 409);
      assert(!(await sql`SELECT id FROM report_schedules WHERE ${tenant(s)} AND template_id=${data.id}::uuid UNION ALL SELECT id FROM report_runs WHERE ${tenant(s)} AND manual_template_id=${data.id}::uuid LIMIT 1`.execute(tx)).rows.length, "REPORT_TEMPLATE_IN_USE", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`DELETE FROM report_templates WHERE ${tenant(s)} AND id=${data.id}::uuid`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "REPORT_TEMPLATE_DELETED", data.id, data.revision);
      return { id: data.id, deleted: true as const };
    });
  }
  async removeSchedule(s: Scope, actor: Actor, input: unknown) {
    const data = reportRemovalInput.parse(input);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s)); await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports"); await operationsLock(tx, s);
      const row = (await sql<{ revision: number }>`SELECT revision FROM report_schedules WHERE ${tenant(s)} AND id=${data.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row, "REPORT_NOT_FOUND", 404); assert(row.revision === data.revision, "REVISION_CONFLICT", 409);
      assert(!(await sql`SELECT id FROM report_runs WHERE ${tenant(s)} AND schedule_id=${data.id}::uuid LIMIT 1`.execute(tx)).rows.length, "REPORT_SCHEDULE_IN_USE", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await sql`DELETE FROM report_schedules WHERE ${tenant(s)} AND id=${data.id}::uuid`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "REPORT_SCHEDULE_DELETED", data.id, data.revision);
      return { id: data.id, deleted: true as const };
    });
  }
  async claimManual(s: Scope, id: string, actor: Actor, leaseToken: string, now = new Date()) {
    const policy = this.manualPolicy(); z.uuid().parse(id); z.uuid().parse(leaseToken);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s)); await operationsAccess(tx, s, actor, "ANALYZE", "scheduled_reports"); await operationsLock(tx, s);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "ANALYZE", "scheduled_reports");
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      return (await sql<ManualReportRun>`UPDATE report_runs SET state='RUNNING',lease_token=${leaseToken}::uuid,lease_until=${new Date(now.getTime() + policy.leaseSeconds! * 1000)},state_version=state_version+1 WHERE ${tenant(s)} AND id=${id}::uuid AND run_kind='MANUAL' AND requested_by_actor_hash=${actor.key} AND result_expires_at>${now} AND (state='PENDING' OR state='RUNNING' AND lease_until<=${now}) RETURNING *`.execute(tx)).rows[0] ?? null;
    });
  }
  async completeManual(s: Scope, id: string, actor: Actor, leaseToken: string, artifact: ManualReportArtifact, now = new Date(), currentAuthorityFence: () => void = () => {}) {
    const profile = this.manualPolicy();
    assert(artifact.version === 1 && artifact.deliveryMode === "NONE" && artifact.charts.length >= 1 && artifact.charts.length <= 4 && Buffer.byteLength(JSON.stringify(artifact)) <= profile.maxResultBytes!, "REPORT_ARTIFACT_INVALID", 422);
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s)); await operationsAccess(tx, s, actor, "ANALYZE", "scheduled_reports"); await operationsLock(tx, s);
      const row = (await sql<ManualReportRun>`SELECT * FROM report_runs WHERE ${tenant(s)} AND id=${id}::uuid AND run_kind='MANUAL' AND state='RUNNING' AND lease_token=${leaseToken}::uuid AND lease_until>${now} AND lease_until>clock_timestamp() AND result_expires_at>${now} AND result_expires_at>clock_timestamp() AND requested_by_actor_hash=${actor.key} FOR UPDATE`.execute(tx)).rows[0];
      if (!row) return false;
      const snapshot = manualReportSnapshotSchema.parse(row.manual_input);
      assert(snapshot.asOf === artifact.asOf && snapshot.templateRevision === artifact.templateRevision && snapshot.sourceFence === artifact.sourceFence, "REPORT_INPUT_CHANGED", 409);
      assert(snapshot.sourceFence === await manualReportSourceFence(tx, s), "REPORT_SOURCE_VISIBILITY_CHANGED", 409);
      assertMaintenanceAuthorization(this.options.authorization, s, actor);
      await operationsAccess(tx, s, actor, "ANALYZE", "scheduled_reports");
      currentAuthorityFence();
      const binding=await this.currentDefinitionInTransaction(tx,s,snapshot.templateId),generatedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
      assertMaintenanceAuthorization(this.options.authorization,s,actor,generatedAt);currentAuthorityFence();
      const verified=binding.bindingVerified&&!!snapshot.definitionRevisionId&&binding.definitionRevisionId===snapshot.definitionRevisionId&&binding.templateRevision===snapshot.templateRevision&&binding.contentHash===snapshot.definitionContentHash&&binding.referenceHash===snapshot.definitionReferenceHash;
      const sourceEnd=new Date(Math.min(generatedAt.getTime()+48*3600000,row.result_expires_at!.getTime()));if(sourceEnd<=generatedAt)return false;
      await sql`UPDATE report_runs SET state='SUCCEEDED',result_payload=${json(artifact)},manual_input=NULL,requested_by_actor_ciphertext=NULL,lease_token=NULL,lease_until=NULL,completed_at=${generatedAt},generated_at=${verified?generatedAt:null},generated_source_expires_at=${verified?sourceEnd:null},definition_revision_id=${verified?snapshot.definitionRevisionId:null}::uuid,definition_content_hash=${verified?snapshot.definitionContentHash:null},definition_reference_hash=${verified?snapshot.definitionReferenceHash:null},state_version=state_version+1 WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
      await minimalOperationAudit(tx, s, actor.key, "REPORT_GENERATED", snapshot.templateId, snapshot.templateRevision);
      return true;
    });
  }
  async failManual(s: Scope, id: string, leaseToken: string) {
    await this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s)); await operationsLock(tx, s);
      await sql`UPDATE report_runs SET state='FAILED',last_error='REPORT_GENERATION_UNAVAILABLE',manual_input=NULL,requested_by_actor_ciphertext=NULL,lease_token=NULL,lease_until=NULL,completed_at=clock_timestamp(),state_version=state_version+1 WHERE ${tenant(s)} AND id=${id}::uuid AND run_kind='MANUAL' AND state='RUNNING' AND lease_token=${leaseToken}::uuid`.execute(tx);
    });
  }
  async template(s: Scope, actor: Actor, input: unknown) {
    const data = reportTemplateInput.parse(input);
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
      return this.saveTemplateInTransaction(tx,s,actor,data);
    });
  }
  /** Native explicit save/commit only. Draft creation never enters this path. */
  private async saveTemplateInTransaction(tx:Tx,s:Scope,actor:Actor,data:z.infer<typeof reportTemplateInput>,immutable?:ReportRevisionRow) {
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      await operationsLock(tx, s);
      const definition=reportDefinitionSchema.parse({title:data.title,footer:data.footer,logoBase64:data.logoBase64,queries:data.queries,viewIds:data.viewIds,includeAttention:data.includeAttention,includeInterventions:data.includeInterventions});
      const references=await this.definitionReferences(tx,s,data.viewIds);
      if(data.id){const current=(await sql<{revision:number}>`SELECT revision FROM report_templates WHERE ${tenant(s)} AND id=${data.id}::uuid FOR UPDATE`.execute(tx)).rows[0];assert(current&&current.revision===data.revision,"REVISION_CONFLICT",409);}
      let row: { id: string; revision: number };
      if (data.id) {
        row = (
          await sql<{
            id: string;
            revision: number;
          }>`UPDATE report_templates SET title=${data.title},footer=${data.footer},logo_base64=${data.logoBase64},queries=${json(data.queries)},include_attention=${data.includeAttention},include_interventions=${data.includeInterventions},actor_hash=${actor.key},revision=revision+1 WHERE ${tenant(s)} AND id=${data.id}::uuid AND revision=${data.revision ?? 0} RETURNING id,revision`.execute(
            tx,
          )
        ).rows[0]!;
        assert(row, "REVISION_CONFLICT", 409);
        await sql`DELETE FROM report_template_views WHERE ${tenant(s)} AND template_id=${data.id}::uuid`.execute(
          tx,
        );
      } else
        row = (
          await sql<{
            id: string;
            revision: number;
          }>`INSERT INTO report_templates(organization_id,guild_id,title,footer,logo_base64,queries,include_attention,include_interventions,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${data.title},${data.footer},${data.logoBase64},${json(data.queries)},${data.includeAttention},${data.includeInterventions},${actor.key}) RETURNING id,revision`.execute(
            tx,
          )
        ).rows[0]!;
      for (const id of data.viewIds)
        await sql`INSERT INTO report_template_views VALUES(${s.organizationId}::uuid,${s.guildId},${row.id}::uuid,${id}::uuid)`.execute(
          tx,
        );
      const revision=immutable??await this.appendDefinitionRevision(tx,s,actor,row.id,definition);
      if(immutable)assert(immutable.template_id===row.id&&immutable.content_hash===configHash(definition)&&immutable.reference_hash===configHash(references),"REPORT_DRAFT_REFERENCE_CHANGED",412);
      await sql`UPDATE report_templates SET definition_revision_id=${revision.id}::uuid WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(tx);
      await sql`INSERT INTO report_template_definition_bindings(organization_id,guild_id,template_id,template_revision,definition_revision_id,content_hash,reference_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${row.id}::uuid,${row.revision},${revision.id}::uuid,${configHash(definition)},${configHash(references)})`.execute(tx);
      await operationsAudit(
        tx,
        s,
        actor.key,
        "REPORT_TEMPLATE_SAVED",
        row.id,
        row.revision,
      );
      return row;
  }
  async schedule(s: Scope, actor: Actor, input: unknown, now = new Date()) {
    const data = z
        .object({
          templateId: z.uuid(),
          destinationId: z.uuid(),
          clock: scheduleInput,
          format: z
            .enum(["DISCORD", "CSV", "JSON", "WEBHOOK"])
            .default("DISCORD"),
        })
        .strict()
        .parse(input),
      next = nextReportOccurrence(data.clock, now);
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      if (data.format !== "DISCORD")
        await new EntitlementService(tx).require(s, "recurring_exports");
      await operationsLock(tx, s);
      const destination = (
        await sql<{
          kind: string;
        }>`SELECT kind FROM integration_destinations WHERE ${tenant(s)} AND id=${data.destinationId}::uuid AND state='ENABLED'`.execute(
          tx,
        )
      ).rows[0];
      assert(
        destination &&
          (data.format === "WEBHOOK"
            ? destination.kind === "WEBHOOK"
            : destination.kind === "DISCORD"),
        "DESTINATION_KIND_MISMATCH",
        409,
      );
      const count = (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM report_schedules WHERE ${tenant(s)} AND state='ENABLED'`.execute(
          tx,
        )
      ).rows[0]!.n;
      assert(
        (await new EntitlementService(tx).limit(s, "scheduledReports", count))
          .allowed,
        "BILLING_LIMIT_REACHED",
        403,
      );
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO report_schedules(organization_id,guild_id,template_id,destination_id,cadence,timezone,day,hour,minute,next_at,format) VALUES(${s.organizationId}::uuid,${s.guildId},${data.templateId}::uuid,${data.destinationId}::uuid,${data.clock.cadence},${data.clock.timezone},${data.clock.day},${data.clock.hour},${data.clock.minute},${next},${data.format}) RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      await operationsAudit(
        tx,
        s,
        actor.key,
        "REPORT_SCHEDULE_CREATED",
        row.id,
        1,
      );
      return { ...row, nextAt: next.toISOString() };
    });
  }
  async setEnabled(
    s: Scope,
    actor: Actor,
    id: string,
    enabled: boolean,
    now = new Date(),
  ) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
      await operationsAccess(
        tx,
        s,
        actor,
        "CONFIGURE",
        enabled ? "scheduled_reports" : undefined,
      );
      await operationsLock(tx, s);
      const row = (
        await sql<{
          cadence: "WEEKLY" | "MONTHLY";
          timezone: string;
          day: number;
          hour: number;
          minute: number;
          format: string;
        }>`SELECT cadence,timezone,day,hour,minute,format FROM report_schedules WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "REPORT_NOT_FOUND", 404);
      if (enabled) {
        if (row.format !== "DISCORD")
          await new EntitlementService(tx).require(s, "recurring_exports");
        const count = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM report_schedules WHERE ${tenant(s)} AND state='ENABLED' AND id<>${id}::uuid`.execute(
            tx,
          )
        ).rows[0]!.n;
        assert(
          (await new EntitlementService(tx).limit(s, "scheduledReports", count))
            .allowed,
          "BILLING_LIMIT_REACHED",
          403,
        );
      }
      await sql`UPDATE report_schedules SET state=${enabled ? "ENABLED" : "DISABLED"},next_at=${nextReportOccurrence(row, now)},revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        enabled ? "REPORT_ENABLED" : "REPORT_DISABLED",
        id,
        null,
      );
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      return {
        manualGeneration: this.readiness(),
        templates: (
          await sql`SELECT id,title,footer,queries,include_attention,include_interventions,revision,logo_base64 IS NOT NULL AS branded_logo FROM report_templates WHERE ${tenant(s)} ORDER BY title LIMIT 100`.execute(
            tx,
          )
        ).rows,
        schedules: (
          await sql`SELECT * FROM report_schedules WHERE ${tenant(s)} ORDER BY next_at LIMIT 100`.execute(
            tx,
          )
        ).rows,
        runs: (
          await sql`SELECT id,schedule_id,scheduled_at,state,last_error,run_kind,state_version AS revision,result_expires_at FROM report_runs WHERE ${tenant(s)} ORDER BY scheduled_at DESC LIMIT 100`.execute(
            tx,
          )
        ).rows,
      };
    });
  }
}
export async function purgeManualReports(tx: Tx, s: Scope, all = false) {
  await sql`DELETE FROM report_runs WHERE ${tenant(s)} AND run_kind='MANUAL' AND (${all} OR result_expires_at<=clock_timestamp() OR completed_at<=clock_timestamp()-interval '7 days')`.execute(tx);
}
/** Conservative source invalidation: a report aggregate cannot prove that an
 * erased participant did not contribute to its chart. Never copy its payload. */
export async function purgeManualReportsActor(tx: Tx, s: Scope, _actorHash: string) {
  await purgeManualReports(tx, s, true);
}
/** Erase the new author linkage without deleting/disabling native report
 * configuration, breaking immutable definition FKs, or altering provenance. */
export async function purgeReportDefinitionActor(tx: Tx, s: Scope, actorHash: string) {
  assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);
  await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
  await sql`UPDATE report_definition_revisions SET actor_hash=NULL WHERE ${tenant(s)} AND actor_hash=${actorHash}`.execute(tx);
  await sql`UPDATE report_definition_drafts SET actor_hash=NULL WHERE ${tenant(s)} AND actor_hash=${actorHash}`.execute(tx);
}
export async function purgeManualReportsGuild(tx: Tx, s: Scope) {
  await purgeManualReports(tx, s, true);
}
export async function purgeExpiredManualReports(tx: Tx, s: Scope, now = new Date()) {
  await sql`DELETE FROM report_runs WHERE ${tenant(s)} AND run_kind='MANUAL' AND (result_expires_at<=${now} OR completed_at<=${new Date(now.getTime() - 7 * 86400000)})`.execute(tx);
}
/** Existing scoped retention transaction only. Remove the added evaluation
 * binding without deleting or extending the native Report execution record. */
export async function purgeExpiredReportGenerationEvidence(tx:Tx,s:Scope,now=new Date()) {
  assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);
  await sql`UPDATE report_runs SET generated_at=NULL,generated_source_expires_at=NULL,definition_revision_id=NULL,definition_content_hash=NULL,definition_reference_hash=NULL WHERE ${tenant(s)} AND generated_source_expires_at<=${now}`.execute(tx);
}
