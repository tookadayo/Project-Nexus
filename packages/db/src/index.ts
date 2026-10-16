import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { scopeSchema, type Scope } from "../../shared/src/index";
export type Database = Kysely<Record<string, never>>;
export type Tx = Database | Transaction<Record<string, never>>;
export { sql };
export function connect(url: string): Database {
  return new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: url,
        max: 10,
        connectionTimeoutMillis: 500,
      }),
    }),
  });
}
export async function migrate(
  db: Database,
  options: { throughVersion?: number } = {},
) {
  if (
    options.throughVersion !== undefined &&
    (!Number.isInteger(options.throughVersion) || options.throughVersion < 1)
  )
    throw new Error("INVALID_MIGRATION_TARGET");
  await db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(763201)`.execute(tx);
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY)`.execute(
      tx,
    );
    for (const [index, name] of [
      "001_foundation",
      "002_runtime",
      "003_telemetry",
      "004_lifecycle",
      "005_native",
      "006_activation",
      "007_operations",
      "008_measurement",
      "009_optimization",
      "010_durable_ingest",
      "011_activation_backfill",
      "012_retention",
      "013_experiment_outcomes",
      "014_weekly_summary",
      "015_suggestion_feedback",
      "016_member_journey",
      "017_interaction_health",
      "018_interaction_pairs",
      "019_weekly_phases",
      "020_audit_actor",
      "021_helper_alerts",
      "022_attention_items",
      "023_product_telemetry",
      "024_telemetry_sources",
      "025_server_verification",
      "026_adaptive_community",
      "027_member_observation",
      "028_collection_health",
      "029_measurement_recipes",
      "030_attention_operations",
      "031_typed_rollups",
      "032_worker_leases",
      "033_message_observations",
      "034_eligible_retention",
      "035_billing_foundation",
      "036_promotions",
      "037_billing_operations",
      "038_stripe_readiness",
      "039_billing_contract_hardening",
      "040_stripe_commerce",
      "041_explore_views",
      "042_community_operations",
      "043_organization_operations",
      "044_market_parity_plan_catalog",
      "045_owner_checkout_authority",
      "046_analysis_operations",
      "047_channel_scope_observation",
      "048_billing_external_phases_and_financial_authority",
      "049_analysis_stabilization",
      "050_location_population_coverage",
      "051_hosted_beta",
      "052_official_publications",
      "053_web_setup",
      "054_alpha15_automation",
      "055_alpha15_install_notices",
      "056_alpha15_role_policy",
      "057_alpha15_events",
      "058_alpha15_waits",
      "059_alpha15_schedule_reviews",
      "060_alpha16_rule_platform",
      "061_alpha16_operator_privacy",
      "062_alpha16_rule_runtime",
      "063_alpha16_publication",
      "064_alpha16_case_contexts",
      "065_alpha16_personalization",
      "066_alpha16_operations_completion",
      "067_alpha16_rollback",
      "068_alpha16_integrations",
      "069_alpha16_lifecycle_web_requests",
      "070_alpha16_organization_detach",
      "071_alpha16_report_definition_drafts",
      "072_alpha16_onboarding_flow_drafts",
      "073_alpha16_native_cohort_config",
      "074_alpha16_minimal_safety_state",
      "075_alpha16_native_runtime_permissions",
      "076_alpha16_rule_issue_registry",
      "077_alpha16_operational_case_context",
      "078_alpha16_rule_operating_profiles",
      "079_alpha16_role_access_observation",
      "080_alpha16_operational_native_context",
      "081_alpha16_source_metadata_contracts",
      "082_alpha16_case_metric_observations",
    ].entries()) {
      const version = index + 1;
      if (
        options.throughVersion !== undefined &&
        version > options.throughVersion
      )
        break;
      const done =
        await sql`SELECT version FROM schema_migrations WHERE version=${version}`.execute(
          tx,
        );
      if (!done.rows.length) {
        const source = await readFile(
          new URL(`../../../migrations/${name}.sql`, import.meta.url),
          "utf8",
        );
        await sql.raw(source).execute(tx);
        await sql`INSERT INTO schema_migrations VALUES(${version})`.execute(tx);
      }
    }
  });
}
export function tenant(s: Scope) {
  scopeSchema.parse(s);
  return sql`organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`;
}
export function json(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}
const heldReadFences = new AsyncLocalStorage<
  { keys: ReadonlySet<string>; active: boolean }[]
>();
export function hasHeldReadFence(key: string) {
  return (
    heldReadFences
      .getStore()
      ?.some((fence) => fence.active && fence.keys.has(key)) ?? false
  );
}
/** Only call after acquiring the listed session locks, and await all work before
 * releasing them. This carries an existing fence through nested service calls;
 * reacquiring it on another pooled connection can wait behind an exclusive
 * stop/delete request that is itself waiting for this worker. */
export async function withHeldReadFences<T>(
  keys: string[],
  work: () => Promise<T>,
) {
  const fence = { keys: new Set(keys), active: true };
  try {
    return await heldReadFences.run(
      [...(heldReadFences.getStore() ?? []), fence],
      work,
    );
  } finally {
    // Async descendants cannot keep claiming the fence after its owner exits.
    fence.active = false;
  }
}
export async function privacyReadLock(tx: Tx, s: Scope) {
  const key = "privacy:" + s.organizationId + ":" + s.guildId;
  if (hasHeldReadFence(key)) return;
  await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`.execute(
    tx,
  );
}
export async function ensureGuild(tx: Tx, s: Scope) {
  scopeSchema.parse(s);
  await sql`INSERT INTO organizations(id,name) VALUES(${s.organizationId}::uuid,'Discord community') ON CONFLICT DO NOTHING`.execute(
    tx,
  );
  await sql`INSERT INTO guilds(organization_id,guild_id) VALUES(${s.organizationId}::uuid,${s.guildId}) ON CONFLICT DO NOTHING`.execute(
    tx,
  );
  const result =
    await sql`SELECT guild_id FROM guilds WHERE ${tenant(s)}`.execute(tx);
  if (!result.rows.length) throw new Error("Tenant mismatch");
}
