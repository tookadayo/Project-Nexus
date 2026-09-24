import {Kysely,PostgresDialect,sql,type Transaction} from 'kysely';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {scopeSchema,type Scope} from '../../shared/src/index.js';
export type Database=Kysely<Record<string,never>>;
export type Tx=Database|Transaction<Record<string,never>>;
export {sql};
export function connect(url:string):Database {
  return new Kysely({dialect:new PostgresDialect({pool:new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:500})})});
}
export async function migrate(db:Database){
 await db.transaction().execute(async tx=>{
  await sql`SELECT pg_advisory_xact_lock(763201)`.execute(tx);
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY)`.execute(tx);
  for(const [index,name] of ['001_foundation','002_runtime','003_telemetry','004_lifecycle','005_native','006_activation','007_operations','008_measurement','009_optimization','010_durable_ingest','011_activation_backfill','012_retention','013_experiment_outcomes','014_weekly_summary','015_suggestion_feedback'].entries()){
  const version=index+1;
  const done=await sql`SELECT version FROM schema_migrations WHERE version=${version}`.execute(tx);
  if(!done.rows.length){
   const source=await readFile(new URL(`../../../migrations/${name}.sql`,import.meta.url),'utf8');
   await sql.raw(source).execute(tx);
   await sql`INSERT INTO schema_migrations VALUES(${version})`.execute(tx);
  }
  }
 });
}
export function tenant(s:Scope){scopeSchema.parse(s);return sql`organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`;}
export function json(value:unknown){return sql`${JSON.stringify(value)}::jsonb`;}
export async function privacyReadLock(tx:Tx,s:Scope){await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'privacy:'+s.organizationId+':'+s.guildId},0))`.execute(tx);}
export async function ensureGuild(tx:Tx,s:Scope){
 scopeSchema.parse(s);
 await sql`INSERT INTO organizations(id,name) VALUES(${s.organizationId}::uuid,'Discord community') ON CONFLICT DO NOTHING`.execute(tx);
 await sql`INSERT INTO guilds(organization_id,guild_id) VALUES(${s.organizationId}::uuid,${s.guildId}) ON CONFLICT DO NOTHING`.execute(tx);
 const result=await sql`SELECT guild_id FROM guilds WHERE ${tenant(s)}`.execute(tx);
 if(!result.rows.length) throw new Error('Tenant mismatch');
}
