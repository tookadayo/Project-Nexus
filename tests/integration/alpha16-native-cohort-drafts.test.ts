/** Acceptance source only; execution remains behind the parent verification gate. */
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,ensureGuild,migrate,sql,tenant,type Database} from "../../packages/db/src/index";
import {isolatedPostgres} from "../fixtures/postgres";
import {draftNativeCohortConfig,listNativeCohortConfigs,readNativeCohortRevision,reviseNativeCohortConfig,type NativeCohortDefinition} from "../../packages/rules/src/native-cohort-config";
let infra:Awaited<ReturnType<typeof isolatedPostgres>>,db:Database;
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(){
 const s={organizationId:randomUUID(),guildId:"111111111111111111"},sourceId=randomUUID(),now=new Date(),end=new Date(now.getTime()+600000);
 await ensureGuild(db,s);
 const definition:NativeCohortDefinition={kind:"ENGAGEMENT_CONTINUATION_COHORT",settingsRevision:1,campaignClass:"baseline",timeZone:"UTC",channelIds:["933333333333333330"],signals:["message.sent"],windowDays:7};
 const input={sourceId,revisionId:randomUUID(),baseVersion:0,enabled:true,definition};
 const current=await db.transaction().execute(tx=>reviseNativeCohortConfig(tx,s,input,now,end));
 return {s,sourceId,now,end,definition,current};
}
it("shares native ordinals while retaining head identity, base CAS and retry identity",async()=>{
 const f=await fixture(),request={sourceId:f.sourceId,revisionId:randomUUID(),baseVersion:1,definition:{...f.definition,campaignClass:"candidate"}};
 const draft=await db.transaction().execute(tx=>draftNativeCohortConfig(tx,f.s,request,f.now,new Date(f.end.getTime()+600000)));
 expect(draft).toMatchObject({version:2,baseVersion:1,draftParentRevisionId:f.current.revisionId,enabled:true,expiresAt:f.current.expiresAt});
 expect((await listNativeCohortConfigs(db,f.s,f.now,f.sourceId))[0]).toMatchObject({revisionId:f.current.revisionId,version:1,enabled:true,definition:f.definition,expiresAt:f.current.expiresAt});
 const native={sourceId:f.sourceId,revisionId:randomUUID(),baseVersion:1,enabled:false,definition:f.definition};
 const saved=await db.transaction().execute(tx=>reviseNativeCohortConfig(tx,f.s,native,f.now,f.end));
 expect(saved).toMatchObject({version:3,baseVersion:1,draftParentRevisionId:null,enabled:false});
 expect(await db.transaction().execute(tx=>reviseNativeCohortConfig(tx,f.s,native,f.now,f.end))).toMatchObject({revisionId:saved.revisionId,version:3,baseVersion:1,deduplicated:true});
 expect((await readNativeCohortRevision(db,f.s,f.sourceId,draft.revisionId,f.now))!.revisionId).toBe(draft.revisionId);
 await expect(db.transaction().execute(tx=>reviseNativeCohortConfig(tx,f.s,{...native,revisionId:draft.revisionId,enabled:true,definition:request.definition},f.now,f.end))).rejects.toThrow("IDEMPOTENCY_KEY_REUSED");
 await expect(sql`UPDATE rule_native_cohort_revisions SET definition='{}'::jsonb WHERE ${tenant(f.s)} AND id=${draft.revisionId}::uuid`.execute(db)).rejects.toThrow();
});
it("rolls the native row back if the surrounding Suggestion/link write fails",async()=>{
 const f=await fixture(),revisionId=randomUUID();let calls=0;
 await expect(db.transaction().execute(async tx=>{
  await draftNativeCohortConfig(tx,f.s,{sourceId:f.sourceId,revisionId,baseVersion:1,definition:f.definition},f.now,f.end,async()=>{if(++calls===2)throw new Error("LINK_STORAGE_FAILED");});
 })).rejects.toThrow("LINK_STORAGE_FAILED");
 expect(await readNativeCohortRevision(db,f.s,f.sourceId,revisionId,f.now)).toBeNull();
 expect((await listNativeCohortConfigs(db,f.s,f.now,f.sourceId))[0]!.revisionId).toBe(f.current.revisionId);
});
it("rejects stale head, changed source kind, expired source and cross-tenant identity",async()=>{
 const f=await fixture(),request={sourceId:f.sourceId,revisionId:randomUUID(),baseVersion:1,definition:f.definition};
 await expect(db.transaction().execute(tx=>draftNativeCohortConfig(tx,f.s,{...request,baseVersion:2},f.now,f.end))).rejects.toThrow("RULE_COHORT_CONFIG_VERSION_MISMATCH");
 const other:NativeCohortDefinition={kind:"EVENT_RSVP_ATTENDANCE_COHORT",settingsRevision:1,campaignClass:"baseline",timeZone:"UTC",eventIds:["444444444444444444"],channelIds:["933333333333333330"],confirmation:"DISCORD_SUBSCRIPTION_AT_EVENT_START",attendance:"OBSERVED_VOICE_STAGE",windowDays:28};
 await expect(db.transaction().execute(tx=>draftNativeCohortConfig(tx,f.s,{...request,definition:other},f.now,f.end))).rejects.toThrow("RULE_COHORT_CONFIG_KIND_MISMATCH");
 await expect(db.transaction().execute(tx=>reviseNativeCohortConfig(tx,f.s,{...request,definition:other,enabled:true},f.now,f.end))).rejects.toThrow("RULE_COHORT_CONFIG_KIND_MISMATCH");
 await expect(db.transaction().execute(tx=>draftNativeCohortConfig(tx,f.s,request,new Date(f.end.getTime()+1),new Date(f.end.getTime()+600000)))).rejects.toThrow("RULE_COHORT_CONFIG_EXPIRED");
 const otherScope={...f.s,organizationId:randomUUID()};await ensureGuild(db,otherScope);
 await expect(db.transaction().execute(tx=>draftNativeCohortConfig(tx,otherScope,request,f.now,f.end))).rejects.toThrow("TARGET_NOT_FOUND");
});
