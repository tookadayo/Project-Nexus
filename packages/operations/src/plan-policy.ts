import { createHash } from "node:crypto";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
} from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { featureAvailability } from "../../settings/src/plan-registry";
import { operationsLock } from "./policy";
export async function enforceOperationsPlan(db: Database, s: Scope) {
  return db.transaction().execute(async (tx) => {
    await privacyReadLock(tx, s);
    const entitlements = new EntitlementService(tx),
      state = await entitlements.effective(s),
      fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            state.features,
            featureAvailability,
            state.limits,
            state.privacyDeleted,
          ]),
        )
        .digest("hex");
    await operationsLock(tx, s);
    const previous = (
      await sql<{
        fingerprint: string;
      }>`SELECT fingerprint FROM operations_plan_heads WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows[0];
    if (previous?.fingerprint === fingerprint) return state;
    const api = await entitlements.can(s, "api"),
      advanced = await entitlements.can(s, "advanced_api"),
      playbooks = await entitlements.can(s, "playbooks"),
      reports = await entitlements.can(s, "scheduled_reports"),
      webhooks = await entitlements.can(s, "webhooks"),
      scale = await entitlements.can(s, "multi_guild"),
      filters = await entitlements.can(s, "surface_breakdowns"),
      routing = await entitlements.can(s, "team_routing"),
      exports = await entitlements.can(s, "recurring_exports");
    if (!api)
      await sql`UPDATE api_credentials SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED'`.execute(
        tx,
      );
    else if (!advanced)
      await sql`UPDATE api_credentials SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED' AND (kind='SERVICE_ACCOUNT' OR scopes&&ARRAY['attention:write','organization:read'])`.execute(
        tx,
      );
    if (!webhooks) {
      await sql`UPDATE webhook_endpoints SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED'`.execute(
        tx,
      );
      await sql`UPDATE webhook_deliveries SET state='PAUSED_PLAN_LIMIT',lease_until=NULL,lease_token=NULL WHERE ${tenant(s)} AND state IN ('PENDING','RUNNING')`.execute(
        tx,
      );
    } else
      await sql`UPDATE webhook_endpoints SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED' AND id IN (SELECT id FROM (SELECT id,row_number() OVER(ORDER BY created_at,id) AS position FROM webhook_endpoints WHERE ${tenant(s)} AND state='ENABLED') selected WHERE position>${state.limits.webhooks ?? 2147483647})`.execute(
        tx,
      );
    await sql`UPDATE integration_destinations SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED' AND ((kind='WEBHOOK' AND NOT ${webhooks}) OR (kind='TEAM' AND NOT ${scale}) OR (role_id IS NOT NULL AND NOT ${routing}))`.execute(
      tx,
    );
    if (!playbooks) {
      await sql`UPDATE playbooks SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ACTIVE'`.execute(
        tx,
      );
      await sql`UPDATE playbook_action_runs SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state IN ('PENDING','QUEUED')`.execute(
        tx,
      );
    } else
      await sql`UPDATE playbooks SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ACTIVE' AND (id IN (SELECT id FROM (SELECT id,row_number() OVER(ORDER BY id) AS position FROM playbooks WHERE ${tenant(s)} AND state='ACTIVE') selected WHERE position>${state.limits.automationRules ?? 2147483647}) OR (approval_required AND NOT ${scale}))`.execute(
        tx,
      );
    await sql`UPDATE report_schedules SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED' AND (NOT ${reports} OR format<>'DISCORD' AND NOT ${exports} OR id IN (SELECT id FROM (SELECT id,row_number() OVER(ORDER BY id) AS position FROM report_schedules WHERE ${tenant(s)} AND state='ENABLED') selected WHERE position>${state.limits.scheduledReports ?? 2147483647}))`.execute(
      tx,
    );
    if (!reports)
      await sql`UPDATE report_runs SET state='PAUSED_PLAN_LIMIT',lease_until=NULL WHERE ${tenant(s)} AND state IN ('PENDING','RUNNING','QUEUED')`.execute(
        tx,
      );
    if (!(await entitlements.can(s, "improvement_tracking")))
      await sql`UPDATE operations_interventions SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='MEASURING'`.execute(
        tx,
      );
    if (!(await entitlements.can(s, "event_operations")))
      await sql`UPDATE event_operation_templates SET state='PAUSED_PLAN_LIMIT' WHERE ${tenant(s)} AND state='ENABLED'`.execute(
        tx,
      );
    await sql`UPDATE operations_intake_panels p SET state='PAUSED_PLAN_LIMIT' WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.state IN ('DRAFT','PUBLISHING','PUBLISHED') AND (p.id IN (SELECT id FROM (SELECT id,row_number() OVER(ORDER BY created_at,id) AS position FROM operations_intake_panels WHERE ${tenant(s)} AND state IN ('DRAFT','PUBLISHING','PUBLISHED')) selected WHERE position>${state.limits.intakePanels ?? 2147483647}) OR NOT ${filters} AND (p.requires_advanced))`.execute(
      tx,
    );
    if (!scale)
      await sql`UPDATE operations_org_guilds SET state='REQUIRES_REVIEW' WHERE root_organization_id=${s.organizationId}::uuid AND organization_id<>root_organization_id AND state='ACTIVE'`.execute(
        tx,
      );
    await sql`INSERT INTO operations_plan_heads VALUES(${s.organizationId}::uuid,${s.guildId},${fingerprint}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint`.execute(
      tx,
    );
    return state;
  });
}
