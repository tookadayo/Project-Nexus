import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,expect,it } from "vitest";
import { connect,migrate,sql,tenant,type Database } from "../../packages/db/src/index";
import { isolatedPostgres } from "../fixtures/postgres";
import { analysisFixture } from "../fixtures/analysis";
import { RulePlatform } from "../../packages/rules/src/service";
import { digest } from "../../packages/rules/src/domain";
let infrastructure:Awaited<ReturnType<typeof isolatedPostgres>>,db:Database;
beforeAll(async()=>{infrastructure=await isolatedPostgres();db=connect(infrastructure.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infrastructure?.stop();});
it("preserves the existing domain and refuses unapproved new persistence",async()=>{
 const f=await analysisFixture(db,"STARTER"),service=new RulePlatform(db,undefined,undefined,[],{scope:f.s,actorHash:f.actor.key,expiresAt:new Date(Date.now()+60000)});
 const before=(await sql`SELECT * FROM guilds WHERE ${tenant(f.s)}`.execute(db)).rows;
 expect((await service.readiness(f.s,f.actor)).enabled).toBe(false);
 await expect(service.enqueue(f.s,f.actor,randomUUID(),{configVersion:1,inputs:[{kind:"FACT",id:randomUUID(),revision:"1"}],reason:"MANUAL"})).rejects.toThrow("RETENTION_NOT_APPROVED");
 expect((await sql`SELECT * FROM rule_evaluation_jobs WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual([]);
 expect((await sql`SELECT * FROM guilds WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual(before);
});
it("enforces guild compound FK and sealed definition immutability",async()=>{
 const f=await analysisFixture(db,"STARTER"),definition={fixture:true};
 await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,approved_at,expires_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},1,'DRAFT','fixture',${JSON.stringify(definition)}::jsonb,${digest(definition)},now(),NULL,now()+interval '1 hour')`.execute(db);
 await expect(sql`UPDATE rule_config_versions SET definition='{}'::jsonb WHERE ${tenant(f.s)} AND version=1`.execute(db)).rejects.toThrow("RULE_IMMUTABLE_PAYLOAD");
 await expect(sql`INSERT INTO rule_suggestion_user_states(organization_id,guild_id,suggestion_id,actor_hash,expires_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,'fixture',now()+interval '1 hour')`.execute(db)).rejects.toThrow();
});
it("checks privacy on reads and replays before revealing status",async()=>{
 const f=await analysisFixture(db,"STARTER"),service=new RulePlatform(db,undefined,undefined,[],{scope:f.s,actorHash:f.actor.key,expiresAt:new Date(Date.now()+60000)});
 await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${f.actor.key},now())`.execute(db);
 await expect(service.readiness(f.s,f.actor)).rejects.toThrow(/RESOURCE_DELETED|PRIVACY_DELETED/);
 await expect(service.job(f.s,f.actor,randomUUID())).rejects.toThrow(/RESOURCE_DELETED|PRIVACY_DELETED/);
});
