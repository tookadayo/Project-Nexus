/** Prepared source-only acceptance cases; no runtime/source approval is implied. */
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,migrate,sql,tenant,type Database} from "../../packages/db/src/index";
import {isolatedPostgres} from "../fixtures/postgres";
import {analysisFixture,analysisVault} from "../fixtures/analysis";
import {Reports} from "../../packages/operations/src/reports";
import {PrivacyService} from "../../packages/security/src/privacy";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "../../packages/rules/src/locks";
let infra:Awaited<ReturnType<typeof isolatedPostgres>>,db:Database;
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(){
 const f=await analysisFixture(db,"SCALE",false),proof={scope:f.s,actorHash:f.actor.key,expiresAt:new Date(Date.now()+60000)},reports=new Reports(db,{authorization:proof});
 const template=await reports.template(f.s,f.actor,{title:"Existing report",queries:[{metric:"reply"}]});
 const current=await reports.definitionDetail(f.s,f.actor,template.id);return {...f,reports,proof,template,current};
}
it("keeps active template and delivery unchanged while immutable draft edits share the native allocator",async()=>{
 const f=await fixture(),input={draftId:randomUUID(),revisionId:randomUUID(),templateId:f.template.id,liveVersion:f.current.liveVersion,definition:{...f.current.definition,title:"Draft report"}};
 const first=await f.reports.createDefinitionDraft(f.s,f.actor,input);
 expect(await f.reports.createDefinitionDraft(f.s,f.actor,input)).toEqual(first);
 expect(await f.reports.definitionDetail(f.s,f.actor,f.template.id)).toEqual(f.current);
 const edit={version:first.version,sourceRevisionId:first.headRevisionId,revisionId:randomUUID(),definition:{...first.definition,footer:"Reviewed configuration"}};
 const changed=await f.reports.editDefinitionDraft(f.s,f.actor,first.draftId,edit);
 expect(changed.version).toBe(2);expect((await f.reports.editDefinitionDraft(f.s,f.actor,first.draftId,edit))).toMatchObject({headRevisionId:changed.headRevisionId,deduplicated:true});
 await expect(sql`UPDATE report_definition_revisions SET content_hash=${"a".repeat(64)} WHERE ${tenant(f.s)} AND id=${first.headRevisionId}::uuid`.execute(db)).rejects.toThrow();
 const preview=await f.reports.previewDefinitionDraft(f.s,f.actor,first.draftId);expect(preview.canCommit).toBe(true);expect(preview.changedFields).toContain("title");
 const commit={version:changed.version,headRevisionId:changed.headRevisionId,confirmationHash:preview.confirmationHash,liveVersion:preview.current.liveVersion};
 const committed=await f.reports.commitDefinitionDraft(f.s,f.actor,first.draftId,commit);expect(committed.templateRevision).toBe(2);
 expect(await f.reports.commitDefinitionDraft(f.s,f.actor,first.draftId,commit)).toMatchObject({templateRevision:2,deduplicated:true});
 const active=await f.reports.definitionDetail(f.s,f.actor,f.template.id);expect(active.definition.title).toBe("Draft report");expect(active.definitionRevisionId).toBe(changed.headRevisionId);expect(active.bindingVerified).toBe(true);
 const binding=(await sql<{template_revision:number;definition_revision_id:string;ordinal:number}>`SELECT b.template_revision,b.definition_revision_id,r.ordinal FROM report_template_definition_bindings b JOIN report_definition_revisions r ON r.organization_id=b.organization_id AND r.guild_id=b.guild_id AND r.id=b.definition_revision_id WHERE b.organization_id=${f.s.organizationId}::uuid AND b.guild_id=${f.s.guildId} AND b.template_id=${f.template.id}::uuid AND b.template_revision=2`.execute(db)).rows[0];expect(binding).toEqual({template_revision:2,definition_revision_id:changed.headRevisionId,ordinal:3});
 await f.reports.template(f.s,f.actor,{id:f.template.id,revision:active.templateRevision,...active.definition,title:"Normal native save"});
 const ordinals=(await sql<{ordinal:number}>`SELECT ordinal FROM report_definition_revisions WHERE ${tenant(f.s)} AND template_id=${f.template.id}::uuid ORDER BY ordinal`.execute(db)).rows.map(row=>row.ordinal);expect(ordinals).toEqual([1,2,3,4]);
 for(const table of ["report_runs","report_schedules","action_outbox"])expect((await sql`SELECT 1 FROM ${sql.table(table)} WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
});
it("rolls native draft rows back with the surrounding Suggestion/link transaction",async()=>{
 const f=await fixture(),identity={draftId:randomUUID(),revisionId:randomUUID()};
 await expect(db.transaction().execute(async tx=>{
  await acquireRuleScopeLocks(tx,ruleScopeLockSet(f.s));await f.reports.currentDefinitionInTransaction(tx,f.s,f.template.id,true);
  await f.reports.draftInTransaction(tx,f.s,f.actor,f.template.id,f.current.liveVersion,{...f.current.definition,title:"Rolled back"},identity);
  throw new Error("LINK_STORAGE_FAILED");
 })).rejects.toThrow("LINK_STORAGE_FAILED");
 expect((await sql`SELECT id FROM report_definition_drafts WHERE ${tenant(f.s)} AND id=${identity.draftId}::uuid`.execute(db)).rows).toHaveLength(0);
 expect((await sql`SELECT id FROM report_definition_revisions WHERE ${tenant(f.s)} AND id=${identity.revisionId}::uuid`.execute(db)).rows).toHaveLength(0);
 expect((await f.reports.definitionDetail(f.s,f.actor,f.template.id)).liveVersion).toBe(f.current.liveVersion);
});
it("fails closed on a stale active version, stale preview, tenant mismatch and expired current proof",async()=>{
 const f=await fixture(),draft=await f.reports.createDefinitionDraft(f.s,f.actor,{draftId:randomUUID(),revisionId:randomUUID(),templateId:f.template.id,liveVersion:f.current.liveVersion,definition:{...f.current.definition,title:"Stale draft"}});
 const preview=await f.reports.previewDefinitionDraft(f.s,f.actor,draft.draftId);
 await f.reports.template(f.s,f.actor,{id:f.template.id,revision:1,...f.current.definition,title:"Changed elsewhere"});
 expect((await f.reports.previewDefinitionDraft(f.s,f.actor,draft.draftId)).blockers).toContain("REPORT_DEFINITION_CONFLICT");
 await expect(f.reports.commitDefinitionDraft(f.s,f.actor,draft.draftId,{version:draft.version,headRevisionId:draft.headRevisionId,confirmationHash:preview.confirmationHash,liveVersion:preview.current.liveVersion})).rejects.toThrow("REPORT_DRAFT_CONFLICT");
 const other=await fixture();await expect(other.reports.definitionDraftDetail(other.s,other.actor,draft.draftId)).rejects.toThrow("REPORT_DRAFT_NOT_FOUND");
 const expired=new Reports(db,{authorization:{...f.proof,expiresAt:new Date(0)}});await expect(expired.definitionDraftDetail(f.s,f.actor,draft.draftId)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
 await f.reports.discardDefinitionDraft(f.s,f.actor,draft.draftId,draft.version);
 expect((await sql`SELECT id FROM report_definition_revisions WHERE ${tenant(f.s)} AND draft_id=${draft.draftId}::uuid`.execute(db)).rows).toHaveLength(0);
});
it("erases only new author linkage on individual privacy deletion while preserving native report configuration and immutable bindings",async()=>{
 const f=await fixture(),input={draftId:randomUUID(),revisionId:randomUUID(),templateId:f.template.id,liveVersion:f.current.liveVersion,definition:{...f.current.definition,title:"Author redaction fixture"}};
 const draft=await f.reports.createDefinitionDraft(f.s,f.actor,input);
 const before=(await sql`SELECT id,template_id,ordinal,draft_id,draft_version,source_revision_id,definition,content_hash,reference_hash,reference_metadata,created_at FROM report_definition_revisions WHERE ${tenant(f.s)} ORDER BY ordinal`.execute(db)).rows;
 const templateBefore=(await sql`SELECT id,revision,title,footer,queries,definition_revision_id FROM report_templates WHERE ${tenant(f.s)} AND id=${f.template.id}::uuid`.execute(db)).rows;
 const settingsBefore=(await sql`SELECT revision,settings FROM guild_settings WHERE ${tenant(f.s)}`.execute(db)).rows;
 await new PrivacyService(db,analysisVault,f.settings).delete(f.s,f.user,f.actor);
 expect((await sql`SELECT id,template_id,ordinal,draft_id,draft_version,source_revision_id,definition,content_hash,reference_hash,reference_metadata,created_at FROM report_definition_revisions WHERE ${tenant(f.s)} ORDER BY ordinal`.execute(db)).rows).toEqual(before);
 expect((await sql<{actor_hash:string|null}>`SELECT actor_hash FROM report_definition_revisions WHERE ${tenant(f.s)}`.execute(db)).rows.every(row=>row.actor_hash===null)).toBe(true);
 expect((await sql`SELECT actor_hash FROM report_definition_drafts WHERE ${tenant(f.s)} AND id=${draft.draftId}::uuid`.execute(db)).rows[0]).toEqual({actor_hash:null});
 expect((await sql`SELECT id,revision,title,footer,queries,definition_revision_id FROM report_templates WHERE ${tenant(f.s)} AND id=${f.template.id}::uuid`.execute(db)).rows).toEqual(templateBefore);
 expect((await sql`SELECT revision,settings FROM guild_settings WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual(settingsBefore);
 await expect(sql`UPDATE report_definition_revisions SET actor_hash=${f.actor.key} WHERE ${tenant(f.s)} AND id=${draft.headRevisionId}::uuid`.execute(db)).rejects.toThrow("Report definition revisions are immutable");
 await expect(sql`UPDATE report_definition_revisions SET definition='{}'::jsonb WHERE ${tenant(f.s)} AND id=${draft.headRevisionId}::uuid`.execute(db)).rejects.toThrow("Report definition revisions are immutable");
 await expect(f.reports.createDefinitionDraft(f.s,f.actor,input)).rejects.toThrow(/RESOURCE_DELETED|PRIVACY_DELETED/);
});
