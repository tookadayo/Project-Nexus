import {sql,type Tx} from "../../db/src/index";
import {assert} from "../../shared/src/index";
import {acquireRuleScopeLocks} from "../../rules/src/locks";
import {ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION,ALPHA16_RESTORE_SOURCE_TABLES} from "./alpha16-retention";

const scopeColumns={organization_id:"uuid",guild_id:"text"};
const timestamp="timestamp with time zone";
/** A column inventory complements the migration marker. 081's native metadata
 * keeps its existing sent_at/guild-collection lifecycle, not a new 48-hour TTL. */
const sourceColumns:Readonly<Record<string,Readonly<Record<string,string>>>>={
  rule_operational_contexts:{...scopeColumns,id:"uuid",created_at:timestamp,observed_at:timestamp,expires_at:timestamp,source_configs:"jsonb"},
  rule_operational_fields:{...scopeColumns,context_id:"uuid",observed_at:timestamp,expires_at:timestamp,source_metadata:"jsonb"},
  rule_operational_case_profiles:{...scopeColumns,created_at:timestamp,expires_at:timestamp},
  rule_operational_requests:{...scopeColumns,created_at:timestamp,expires_at:timestamp},
  rule_role_access_observations:{...scopeColumns,context_id:"uuid",observed_at:timestamp,expires_at:timestamp,metadata:"jsonb"},
  rule_operational_native_captures:{...scopeColumns,context_id:"uuid",first_captured_at:timestamp,expires_at:timestamp,fields:"jsonb",role_expires_at:timestamp},
  rule_operational_filter_configs:{...scopeColumns,context_id:"uuid",configured_at:timestamp,first_captured_at:timestamp,expires_at:timestamp},
  rule_case_metric_observations:{...scopeColumns,id:"uuid",context_id:"uuid",captured_at:timestamp,expires_at:timestamp},
  rule_case_metric_values:{...scopeColumns,observation_id:"uuid",source_expires_at:timestamp,metadata:"jsonb"},
  location_post_observations:{...scopeColumns,sent_at:timestamp,reference_contract_version:"text",mention_everyone:"boolean",role_mention_count:"integer",mention_contract_version:"text",reply_provenance_erased:"boolean"},
  location_population_collection:{...scopeColumns,bot_reference_started_at:timestamp,bot_reference_observed_at:timestamp},
  rule_config_versions:{...scopeColumns,operating_profile_expires_at:timestamp,operating_profile_revision:"text",operating_profile_hash:"text",source_config_version:"integer"},
};
export type RestoredSourceRetentionCoverage=Readonly<{schemaVersion:82;tableInventoryVerified:true;originalExpiryPurged:true;checkedAt:string;nextExpiry:string|null}>;

export async function assertAlpha16RestoredSourceSchema(tx:Tx){
  const versions=(await sql<{version:number}>`SELECT version FROM schema_migrations WHERE version>=77`.execute(tx)).rows;
  assert(versions.length===ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION-76&&versions.every(value=>value.version<=ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION),"RESTORE_SOURCE_SCHEMA_REQUIRED",503);
  // Resolve each name exactly as the following native SQL will resolve it;
  // current_schema() alone can miss public tables later in the search path.
  const columns=(await sql<{table_name:string;column_name:string;data_type:string;is_not_null:boolean}>`SELECT names.table_name,attribute.attname AS column_name,pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) AS data_type,attribute.attnotnull AS is_not_null
    FROM unnest(${Object.keys(sourceColumns)}::text[]) names(table_name)
    JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=to_regclass(names.table_name) AND attribute.attnum>0 AND NOT attribute.attisdropped`.execute(tx)).rows;
  for(const [table,expected] of Object.entries(sourceColumns))for(const [column,type] of Object.entries(expected))
    assert(columns.some(value=>value.table_name===table&&value.column_name===column&&value.data_type===type),"RESTORE_SOURCE_SCHEMA_REQUIRED",503);
  assert(ALPHA16_RESTORE_SOURCE_TABLES.every(value=>Object.hasOwn(sourceColumns,value.table)),"RESTORE_SOURCE_INVENTORY_INCOMPLETE",500);
  for(const table of ALPHA16_RESTORE_SOURCE_TABLES){
    const required=["organization_id","guild_id",...("anchor" in table?[table.anchor,table.expiry]:[]),...(table.table==="rule_case_metric_values"?["source_expires_at"]:[])];
    for(const column of required)assert(columns.some(value=>value.table_name===table.table&&value.column_name===column&&value.is_not_null),"RESTORE_SOURCE_SCHEMA_REQUIRED",503);
  }
  assert(columns.some(value=>value.table_name==="location_post_observations"&&value.column_name==="reply_provenance_erased"&&value.is_not_null),"RESTORE_SOURCE_SCHEMA_REQUIRED",503);
}

/** The containing context is the same immutable evaluation copy. Removing an
 * expired native header alone would leave its EAV value/sourceMetadata behind.
 * Delete the containing finite copy and let all source/EAV FKs cascade. */
const expiredContexts=(now:Date)=>sql`
 SELECT c.organization_id,c.guild_id,c.id FROM rule_operational_contexts c WHERE
 c.expires_at<=${now} OR c.created_at>${now} OR c.expires_at>c.created_at+interval '48 hours'
 OR EXISTS(SELECT 1 FROM rule_operational_fields f WHERE f.organization_id=c.organization_id AND f.guild_id=c.guild_id AND f.context_id=c.id AND f.expires_at<=${now})
 OR EXISTS(SELECT 1 FROM rule_role_access_observations r WHERE r.organization_id=c.organization_id AND r.guild_id=c.guild_id AND r.context_id=c.id AND
   (r.expires_at<=${now} OR r.observed_at>${now} OR r.expires_at>r.observed_at+interval '48 hours'))
 OR EXISTS(SELECT 1 FROM rule_operational_native_captures n WHERE n.organization_id=c.organization_id AND n.guild_id=c.guild_id AND n.context_id=c.id AND
   (n.expires_at<=${now} OR n.first_captured_at>${now} OR n.expires_at>n.first_captured_at+interval '48 hours' OR n.role_expires_at<=${now}
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(n.fields) f(value) WHERE jsonb_typeof(f.value->'expiresAt') IS DISTINCT FROM 'string' OR (f.value->>'expiresAt')::timestamptz<=${now})))
 OR EXISTS(SELECT 1 FROM rule_operational_filter_configs f WHERE f.organization_id=c.organization_id AND f.guild_id=c.guild_id AND f.context_id=c.id AND
   (f.expires_at<=${now} OR f.first_captured_at>${now} OR f.expires_at>f.first_captured_at+interval '48 hours'))
 OR EXISTS(SELECT 1 FROM rule_case_metric_observations m WHERE m.organization_id=c.organization_id AND m.guild_id=c.guild_id AND m.context_id=c.id AND
   (m.expires_at<=${now} OR m.captured_at>${now} OR m.expires_at>m.captured_at+interval '48 hours'
    OR EXISTS(SELECT 1 FROM rule_case_metric_values v WHERE v.organization_id=m.organization_id AND v.guild_id=m.guild_id AND v.observation_id=m.id AND v.source_expires_at<=${now})))`;

async function readCoverage(tx:Tx,now:Date):Promise<RestoredSourceRetentionCoverage>{
  const remaining=(await sql`SELECT 1 FROM (${expiredContexts(now)}) expired LIMIT 1`.execute(tx)).rows.length;
  const other=(await sql`SELECT 1 FROM rule_operational_case_profiles WHERE expires_at<=${now} OR created_at>${now} OR expires_at>created_at+interval '48 hours'
    UNION ALL SELECT 1 FROM rule_operational_requests WHERE expires_at<=${now} OR created_at>${now} OR expires_at>created_at+interval '48 hours' LIMIT 1`.execute(tx)).rows.length;
  assert(!remaining&&!other,"RESTORE_SOURCE_EXPIRY_PURGE_REQUIRED",503);
  const deadline=(await sql<{next:Date|null}>`SELECT MIN(expires_at) AS next FROM (
    SELECT expires_at FROM rule_operational_contexts UNION ALL SELECT expires_at FROM rule_operational_fields WHERE expires_at IS NOT NULL
    UNION ALL SELECT expires_at FROM rule_operational_case_profiles UNION ALL SELECT expires_at FROM rule_operational_requests
    UNION ALL SELECT expires_at FROM rule_role_access_observations UNION ALL SELECT expires_at FROM rule_operational_native_captures
    UNION ALL SELECT role_expires_at FROM rule_operational_native_captures WHERE role_expires_at IS NOT NULL
    UNION ALL SELECT (field.value->>'expiresAt')::timestamptz FROM rule_operational_native_captures n CROSS JOIN LATERAL jsonb_array_elements(n.fields) field(value)
    UNION ALL SELECT expires_at FROM rule_operational_filter_configs UNION ALL SELECT expires_at FROM rule_case_metric_observations
    UNION ALL SELECT source_expires_at FROM rule_case_metric_values) clocks`.execute(tx)).rows[0]?.next??null;
  assert(!deadline||deadline>now,"RESTORE_SOURCE_EXPIRY_PURGE_REQUIRED",503);
  return Object.freeze({schemaVersion:82,tableInventoryVerified:true,originalExpiryPurged:true,checkedAt:now.toISOString(),nextExpiry:deadline?.toISOString()??null});
}

/** Isolated restore only, with no application processes running. This global
 * expiry cleanup is never reachable from an individual deletion route. It
 * removes finite copies and never extends an expiry or changes native config. */
export async function purgeAlpha16RestoredSourceSnapshots(tx:Tx):Promise<RestoredSourceRetentionCoverage>{
  assert(tx.isTransaction,"RESTORE_TRANSACTION_REQUIRED",500);
  await acquireRuleScopeLocks(tx,[{kind:"GLOBAL",mode:"exclusive"}]);
  await assertAlpha16RestoredSourceSchema(tx);
  const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
  await sql`DELETE FROM rule_operational_contexts c WHERE EXISTS(SELECT 1 FROM (${expiredContexts(now)}) e WHERE e.organization_id=c.organization_id AND e.guild_id=c.guild_id AND e.id=c.id)`.execute(tx);
  await sql`DELETE FROM rule_operational_case_profiles WHERE expires_at<=${now} OR created_at>${now} OR expires_at>created_at+interval '48 hours'`.execute(tx);
  await sql`DELETE FROM rule_operational_requests WHERE expires_at<=${now} OR created_at>${now} OR expires_at>created_at+interval '48 hours'`.execute(tx);
  return readCoverage(tx,(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now);
}

/** Read back again at final restore admission after lock waits/rebuild work.
 * Crossing an original child deadline aborts completion and needs cleanup;
 * there is no automatic storage restore repeat. Caller holds GLOBAL exclusive. */
export async function assertAlpha16RestoredSourceRetention(tx:Tx):Promise<RestoredSourceRetentionCoverage>{
  assert(tx.isTransaction,"RESTORE_TRANSACTION_REQUIRED",500);await assertAlpha16RestoredSourceSchema(tx);
  return readCoverage(tx,(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now);
}
