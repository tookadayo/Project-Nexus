import {afterAll,beforeAll,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {isolatedPostgres} from "../fixtures/postgres";
import {connect,ensureGuild,migrate,sql,tenant,type Database} from "../../packages/db/src/index";
import {scopeForGuild} from "../../packages/security/src/scoping";
import {EventOperations} from "../../packages/operations/src/events";
import {OperationsIntake} from "../../packages/operations/src/intake";
import {InterventionReview} from "../../packages/operations/src/intervention-review";
import {purgePersonalizationActor} from "../../packages/operations/src/alpha16-personalization";
import type {Actor} from "../../packages/settings/src/index";
import type {IdentityVault} from "../../packages/identity/src/index";
import type {DiscordPort} from "../../packages/discord/src/rest";
import type {Components} from "../../packages/security/src/index";
let infra:Awaited<ReturnType<typeof isolatedPostgres>>,db:Database,serial=985200000000000000n;
const actor:Actor={key:'maintenance-fixture-admin',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic'};
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(plan:'STARTER'|'GROWTH'='STARTER'){const s=scopeForGuild(String(serial++));await ensureGuild(db,s);await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active')`.execute(db);return s;}
const proof=(scope:ReturnType<typeof scopeForGuild>,expiresAt=new Date(Date.now()+60000))=>({scope,actorHash:actor.key,expiresAt});
it('requires current post-lock authorization and a matching event revision',async()=>{
 const s=await fixture(),id=randomUUID();await sql`INSERT INTO event_operation_templates(organization_id,guild_id,id,title,timezone,starts_at,duration_minutes,recurrence,location,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,'Fixture','UTC',now(),30,'ONCE','',${actor.key})`.execute(db);
 await expect(new EventOperations(db).remove(s,actor,{id,revision:1})).rejects.toThrow('CURRENT_AUTHORIZATION_REQUIRED');
 await expect(new EventOperations(db,proof(s,new Date(0))).remove(s,actor,{id,revision:1})).rejects.toThrow('CURRENT_AUTHORIZATION_REQUIRED');
 const service=new EventOperations(db,proof(s));await expect(service.remove(s,actor,{id,revision:2})).rejects.toThrow('REVISION_CONFLICT');
 expect(await service.remove(s,actor,{id,revision:1})).toMatchObject({deleted:true,externalEffect:'NONE'});
 const audit=(await sql<{expires_at:Date;occurred_at:Date}>`SELECT expires_at,occurred_at FROM operations_audit_events WHERE ${tenant(s)} AND retention_class='ALPHA16_MINIMAL_OPERATION'`.execute(db)).rows[0]!;
 expect(audit.expires_at.getTime()-audit.occurred_at.getTime()).toBe(14*86400000);
});
it('erases request values before panel removal and leaves no body in the minimal audit',async()=>{
 const s=await fixture(),panel=randomUUID(),request=randomUUID(),key='intake:'+request;
 await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${panel}::uuid,'Synthetic','help',${actor.key})`.execute(db);
 await sql`INSERT INTO attention_items(organization_id,guild_id,message_id,channel_id,item_type,reason,status,version,detected_at) VALUES(${s.organizationId}::uuid,${s.guildId},${key},'','OPERATIONS_REQUEST','REQUEST','OPEN',0,now())`.execute(db);
 await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key) VALUES(${s.organizationId}::uuid,${s.guildId},${request}::uuid,${panel}::uuid,'synthetic-digest','participant','private-category','synthetic-private-values',${key})`.execute(db);
 const intake=new OperationsIntake(db,{} as IdentityVault,{} as DiscordPort,{} as Components,proof(s));
 await expect(intake.removePanel(s,actor,{id:panel,version:1})).rejects.toThrow('INTAKE_PANEL_HAS_REQUESTS');
 await intake.removeRequest(s,actor,{id:request,version:0});
 expect((await sql`SELECT id FROM operations_domain_events WHERE ${tenant(s)}`.execute(db)).rows).toEqual([]);
 expect((await sql`SELECT fields_ciphertext,actor_hash,category,state FROM operations_requests WHERE ${tenant(s)} AND id=${request}::uuid`.execute(db)).rows[0]).toEqual({fields_ciphertext:'',actor_hash:'erased-request',category:'',state:'DELETED'});
 expect(JSON.stringify((await sql`SELECT * FROM operations_audit_events WHERE ${tenant(s)}`.execute(db)).rows)).not.toContain('synthetic-private-values');
 await intake.removePanel(s,actor,{id:panel,version:1});expect((await sql`SELECT id FROM operations_requests WHERE ${tenant(s)}`.execute(db)).rows).toEqual([]);
});
it('ends an improvement review without rewriting its observation baseline',async()=>{
 const s=await fixture('GROWTH'),id=randomUUID(),service=new InterventionReview(db,proof(s));
 await sql`INSERT INTO operations_interventions(organization_id,guild_id,id,title,metric_query,started_at,review_at,baseline,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,'Synthetic','{}'::jsonb,now(),now()+interval '7 days','{"fixture":"fixed"}'::jsonb,${actor.key})`.execute(db);
 await service.update(s,actor,{id,revision:1,title:'Renamed',teamId:null});await expect(service.end(s,actor,{id,revision:1})).rejects.toThrow('REVISION_CONFLICT');
 await service.end(s,actor,{id,revision:2});
 expect((await sql`SELECT state,revision,baseline FROM operations_interventions WHERE ${tenant(s)} AND id=${id}::uuid`.execute(db)).rows[0]).toEqual({state:'ARCHIVED',revision:3,baseline:{fixture:'fixed'}});
 await expect(service.update(s,actor,{id,revision:3,title:'Restart',teamId:null})).rejects.toThrow('INTERVENTION_ENDED');
});
it('erases every template revision referring to a deleted member and invalidates another actors prepared copy',async()=>{
 const s=await fixture(),template=randomUUID(),key=randomUUID(),member='123456789012345679';
 await sql`INSERT INTO automation_template_definitions(organization_id,guild_id,id,version,name,state,created_at,updated_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${template}::uuid,1,'Synthetic','ACTIVE',now(),now(),now()+interval '1 hour')`.execute(db);
 await sql`INSERT INTO automation_template_revisions(organization_id,guild_id,template_id,version,definition,definition_hash,created_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${template}::uuid,1,${JSON.stringify({body:[{memberId:member}]})}::jsonb,${'a'.repeat(64)},now(),now()+interval '1 hour')`.execute(db);
 await sql`INSERT INTO personalization_requests(organization_id,guild_id,id,actor_hash,operation,fingerprint,resource_id,state,created_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${key}::uuid,'other-actor','TEMPLATE_COPY',${'b'.repeat(64)},${template}::uuid,'PREPARED',now(),now()+interval '1 hour')`.execute(db);
 await db.transaction().execute(tx=>purgePersonalizationActor(tx,s,'deleted-actor',member));
 expect((await sql`SELECT id FROM automation_template_definitions WHERE ${tenant(s)}`.execute(db)).rows).toEqual([]);
 expect((await sql`SELECT template_id FROM automation_template_revisions WHERE ${tenant(s)}`.execute(db)).rows).toEqual([]);
 expect((await sql`SELECT id FROM personalization_requests WHERE ${tenant(s)}`.execute(db)).rows).toEqual([]);
});
