import { sql, tenant, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { assertIntakeAvailable } from "./intake";
/** The final boundary is held through the external request. Configuration
 * disable/edit and privacy deletion serialize against these shared locks. */
export async function deliveryFence(
  tx: Tx,
  s: Scope,
  kind: "PLAYBOOK" | "REPORT" | "INTAKE" | "INTAKE_NOTIFY",
  id: string,
) {
  const ent = new EntitlementService(tx),
    state = await ent.effective(s);
  assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
  if (kind === "PLAYBOOK") {
    await ent.require(s, "playbooks");
    const row = (
      await sql<{
        attention_key: string | null;
        approval_required: boolean;
        position: number;
      }>`SELECT e.attention_key,p.approval_required,(SELECT count(*)::int FROM playbooks selected WHERE selected.organization_id=p.organization_id AND selected.guild_id=p.guild_id AND selected.state='ACTIVE' AND selected.id<=p.id) AS position FROM playbook_action_runs a JOIN playbook_executions e ON e.organization_id=a.organization_id AND e.guild_id=a.guild_id AND e.id=a.execution_id JOIN playbooks p ON p.organization_id=e.organization_id AND p.guild_id=e.guild_id AND p.id=e.playbook_id JOIN integration_destinations d ON d.organization_id=a.organization_id AND d.guild_id=a.guild_id AND d.id=a.destination_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.id=${id}::uuid AND a.state IN ('PENDING','QUEUED') AND p.state='ACTIVE' AND p.head_id=e.revision_id AND d.state='ENABLED' FOR SHARE OF a,e,p,d`.execute(
        tx,
      )
    ).rows[0];
    assert(row, "PLAYBOOK_CONFIGURATION_CHANGED", 409);
    assert(
      state.limits.automationRules === null ||
        row.position <= state.limits.automationRules,
      "PLAN_REQUIRED",
      403,
    );
    if (row.approval_required) await ent.require(s, "approval_workflow");
    if (row.attention_key)
      assert(
        (
          await sql`SELECT message_id FROM attention_items WHERE ${tenant(s)} AND message_id=${row.attention_key} AND status='OPEN' FOR SHARE`.execute(
            tx,
          )
        ).rows.length,
        "ATTENTION_NOT_ACTIVE",
        409,
      );
  } else if (kind === "REPORT") {
    const row = (
      await sql<{
        format: string;
        position: number;
      }>`SELECT c.format,(SELECT count(*)::int FROM report_schedules selected WHERE selected.organization_id=c.organization_id AND selected.guild_id=c.guild_id AND selected.state='ENABLED' AND selected.id<=c.id) AS position FROM report_runs r JOIN report_schedules c ON c.organization_id=r.organization_id AND c.guild_id=r.guild_id AND c.id=r.schedule_id JOIN report_templates t ON t.organization_id=c.organization_id AND t.guild_id=c.guild_id AND t.id=c.template_id JOIN integration_destinations d ON d.organization_id=c.organization_id AND d.guild_id=c.guild_id AND d.id=c.destination_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.id=${id}::uuid AND r.state='QUEUED' AND c.state='ENABLED' AND d.state='ENABLED' AND c.revision=r.schedule_revision AND t.revision=r.template_revision FOR SHARE OF r,c,t,d`.execute(
        tx,
      )
    ).rows[0];
    assert(row, "REPORT_CONFIGURATION_CHANGED", 409);
    await ent.require(s, "scheduled_reports");
    if (row.format !== "DISCORD") await ent.require(s, "recurring_exports");
    assert(
      state.limits.scheduledReports === null ||
        row.position <= state.limits.scheduledReports,
      "PLAN_REQUIRED",
      403,
    );
  } else if (kind === "INTAKE") await assertIntakeAvailable(tx, s, id);
  else {
    await ent.require(s, "surface_breakdowns");
    assert(
      (
        await sql`SELECT r.id FROM operations_requests r JOIN operations_intake_panels p ON p.organization_id=r.organization_id AND p.guild_id=r.guild_id AND p.id=r.panel_id JOIN integration_destinations d ON d.organization_id=p.organization_id AND d.guild_id=p.guild_id AND d.id=p.destination_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.id=${id}::uuid AND d.state='ENABLED' FOR SHARE OF r,p,d`.execute(
          tx,
        )
      ).rows.length,
      "INTAKE_REQUEST_UNAVAILABLE",
      409,
    );
  }
}
