import {
  sql,
  tenant,
  json,
  privacyReadLock,
  type Database,
} from "../../../packages/db/src/index";
import type { Scope } from "../../../packages/shared/src/index";
import { assert, isDomainError } from "../../../packages/shared/src/index";
import { deliveryFence } from "../../../packages/operations/src/delivery-policy";
import { EntitlementService } from "../../../packages/settings/src/billing/entitlements";
import {
  playbookDefinition,
  trendQuery,
  evaluateTrend,
  type PlaybookHead,
} from "../../../packages/operations/src/playbooks";
import {
  operationsLock,
  operationsEvent,
} from "../../../packages/operations/src/policy";
import { ExploreService } from "../../../packages/analytics/src/explore";
import type { MetricEvidence } from "../../../packages/shared/src/metric-evidence";
import { enqueue } from "../../../packages/discord/src/outbox";
import type { IntegrationDestination } from "../../../packages/operations/src/destinations";
import { InterventionReview } from "../../../packages/operations/src/intervention-review";
type Match = {
  key: string;
  attentionKey: string | null;
  evidence: MetricEvidence | null;
  triggered: boolean;
  suppressed: boolean;
};
export class PlaybookWorker {
  constructor(private readonly db: Database) {}
  async tick(s: Scope, now = new Date()) {
    if (!(await new EntitlementService(this.db).can(s, "playbooks")))
      return false;
    await this.sync(s);
    if (await this.action(s, now)) return true;
    const book = await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await new EntitlementService(tx).require(s, "playbooks");
      const row = (
        await sql<PlaybookHead>`SELECT p.*,r.definition,r.revision FROM playbooks p JOIN playbook_revisions r ON r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.id=p.head_id WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.state='ACTIVE' AND (p.last_evaluated_at IS NULL OR p.last_evaluated_at<${new Date(now.getTime() - 900000)}) ORDER BY p.last_evaluated_at NULLS FIRST,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`.execute(
          tx,
        )
      ).rows[0];
      if (row)
        await sql`UPDATE playbooks SET last_evaluated_at=${now} WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
          tx,
        );
      return row;
    });
    if (!book) return false;
    const definition = playbookDefinition.parse(book.definition),
      matches: Match[] = [];
    if (definition.trigger.kind === "TREND") {
      const spec = await new ExploreService(this.db).chart(
          s,
          trendQuery(definition.trigger),
          now,
        ),
        evaluation = evaluateTrend(
          definition.trigger,
          spec,
          definition.condition.minimumSample,
        );
      matches.push({
        key: "trend:" + spec.range.to,
        attentionKey: null,
        evidence: evaluation.evidence,
        triggered: evaluation.triggered,
        suppressed: evaluation.suppressed,
      });
    } else {
      const rows = await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await new EntitlementService(tx).require(s, "playbooks");
        return (
          await sql<{
            message_id: string;
            opened_at: Date;
            evidence: MetricEvidence | null;
          }>`SELECT message_id,opened_at,evidence FROM attention_items WHERE ${tenant(s)} AND item_type=${definition.trigger.kind === "ATTENTION" ? definition.trigger.type : ""} AND status='OPEN' AND opened_at>=${new Date(now.getTime() - 7 * 86400000)} ORDER BY opened_at,message_id LIMIT 20`.execute(
            tx,
          )
        ).rows;
      });
      for (const item of rows) {
        const suppressed =
          !item.evidence ||
          item.evidence.coverageState !== "COMPLETE" ||
          item.evidence.value === null ||
          item.evidence.sampleSize < definition.condition.minimumSample;
        matches.push({
          key:
            "attention:" + item.message_id + ":" + item.opened_at.toISOString(),
          attentionKey: item.message_id,
          evidence: item.evidence,
          triggered: !suppressed,
          suppressed,
        });
      }
    }
    for (const match of matches)
      await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await new EntitlementService(tx).require(s, "playbooks");
        await operationsLock(tx, s);
        if (
          !(
            await sql`SELECT id FROM playbooks WHERE ${tenant(s)} AND id=${book.id}::uuid AND state='ACTIVE' AND head_id=${book.head_id}::uuid`.execute(
              tx,
            )
          ).rows.length
        )
          return;
        let attentionKey = match.attentionKey;
        // A measured trend enters the same reviewable Inbox lifecycle as other
        // findings. Daily/revision identity deduplicates overlap and preserves
        // acknowledgement/dismissal; a rerun never reopens a staff-closed item.
        if (definition.trigger.kind === "TREND" && match.triggered) {
          attentionKey =
            "trend:" + book.head_id + ":" + match.key.slice("trend:".length);
          await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,evidence,updated_at,last_actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},'',${attentionKey},${now},'OPEN','METRIC_TREND','AGGREGATE_METRIC','MEASURED_METRIC_CHANGE',${now},${json(match.evidence)},${now},'system') ON CONFLICT(organization_id,guild_id,message_id) DO NOTHING`.execute(
            tx,
          );
        }
        const inserted = (
          await sql<{
            id: string;
          }>`INSERT INTO playbook_executions(organization_id,guild_id,playbook_id,revision_id,dedupe_key,state,evidence,attention_key) VALUES(${s.organizationId}::uuid,${s.guildId},${book.id}::uuid,${book.head_id}::uuid,${match.key},${match.triggered ? "QUEUED" : "SUPPRESSED"},${json({ metric: match.evidence, triggered: match.triggered, suppressedDueToCoverage: match.suppressed })},${attentionKey}) ON CONFLICT DO NOTHING RETURNING id`.execute(
            tx,
          )
        ).rows[0];
        if (!inserted || !match.triggered) return;
        for (const destinationId of definition.destinations)
          await sql`INSERT INTO playbook_action_runs(organization_id,guild_id,execution_id,destination_id,step,due_at) VALUES(${s.organizationId}::uuid,${s.guildId},${inserted.id}::uuid,${destinationId}::uuid,'ACTION',${now}) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
        if (definition.escalation)
          await sql`INSERT INTO playbook_action_runs(organization_id,guild_id,execution_id,destination_id,step,due_at) VALUES(${s.organizationId}::uuid,${s.guildId},${inserted.id}::uuid,${definition.escalation.destinationId}::uuid,'ESCALATION',${new Date(now.getTime() + definition.escalation.afterMinutes * 60000)}) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
      });
    return true;
  }
  private async action(s: Scope, now: Date) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await new EntitlementService(tx).require(s, "playbooks");
      await operationsLock(tx, s);
      const row = (
        await sql<
          {
            id: string;
            execution_id: string;
            step: string;
            attention_key: string | null;
            definition: unknown;
            name: string;
            evidence: { metric: MetricEvidence | null };
          } & IntegrationDestination
        >`SELECT a.id,a.execution_id,a.step,e.attention_key,e.evidence,p.name,r.definition,d.kind,d.channel_id,d.role_id,d.endpoint_id,d.team_id,d.state,d.revision FROM playbook_action_runs a JOIN playbook_executions e ON e.organization_id=a.organization_id AND e.guild_id=a.guild_id AND e.id=a.execution_id JOIN playbooks p ON p.organization_id=e.organization_id AND p.guild_id=e.guild_id AND p.id=e.playbook_id JOIN playbook_revisions r ON r.organization_id=e.organization_id AND r.guild_id=e.guild_id AND r.id=e.revision_id JOIN integration_destinations d ON d.organization_id=a.organization_id AND d.guild_id=a.guild_id AND d.id=a.destination_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.state='PENDING' AND a.due_at<=${now} ORDER BY a.due_at,a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED`.execute(
          tx,
        )
      ).rows[0];
      if (!row) return false;
      const item = row.attention_key
        ? (
            await sql<{
              status: string;
            }>`SELECT status FROM attention_items WHERE ${tenant(s)} AND message_id=${row.attention_key}`.execute(
              tx,
            )
          ).rows[0]
        : null;
      if (
        row.state !== "ENABLED" ||
        (row.attention_key && item?.status !== "OPEN")
      ) {
        await sql`UPDATE playbook_action_runs SET state='SUPPRESSED' WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
          tx,
        );
        return true;
      }
      try {
        await deliveryFence(tx, s, "PLAYBOOK", row.id);
      } catch (error) {
        if (!isDomainError(error)) throw error;
        await sql`UPDATE playbook_action_runs SET state='SUPPRESSED' WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
          tx,
        );
        return true;
      }
      if (row.kind === "DISCORD") {
        const metric = row.evidence.metric,
          body = {
            content: `${row.role_id ? "<@&" + row.role_id + "> " : ""}**${row.name}** · ${row.step}\n${metric?.definition ?? "Operational attention"}\nObserved: ${metric?.value ?? "UNKNOWN"} · Coverage: ${metric?.coverageState ?? "UNKNOWN"}\nNEXUS reports an observation; it does not establish a cause.`,
            allowed_mentions: {
              parse: [] as never[],
              roles: row.role_id ? [row.role_id] : [],
            },
          },
          actionId = await enqueue(
            tx,
            s,
            "playbook:" + row.id,
            "OPERATIONS_NOTIFY",
            {
              channelId: row.channel_id,
              roleId: row.role_id,
              body,
              playbookRunId: row.id,
            },
          );
        await sql`UPDATE playbook_action_runs SET state='QUEUED',action_id=${actionId}::uuid WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
          tx,
        );
      } else if (row.kind === "TEAM") {
        await new EntitlementService(tx).require(s, "team_assignment");
        const assigned = row.attention_key
          ? (
              await sql`UPDATE attention_items SET assigned_team_id=${row.team_id}::uuid,version=version+1,updated_at=${now} WHERE ${tenant(s)} AND message_id=${row.attention_key} RETURNING message_id`.execute(
                tx,
              )
            ).rows.length
          : 0;
        await sql`UPDATE playbook_action_runs SET state=${assigned ? "SUCCEEDED" : "SUPPRESSED"} WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
          tx,
        );
      } else {
        await new EntitlementService(tx).require(s, "webhooks");
        const endpoint = (
          await sql<{
            secret_version: number;
          }>`SELECT secret_version FROM webhook_endpoints WHERE ${tenant(s)} AND id=${row.endpoint_id}::uuid AND state='ENABLED'`.execute(
            tx,
          )
        ).rows[0];
        assert(endpoint, "WEBHOOK_NOT_FOUND", 404);
        const eventId = await operationsEvent(
          tx,
          s,
          "playbook.executed",
          "playbook-action:" + row.id,
          {
            executionId: row.execution_id,
            step: row.step,
            evidence: row.evidence.metric,
            action: "WEBHOOK_NOTIFICATION",
          },
        );
        await sql`UPDATE operations_domain_events SET expanded_at=${now} WHERE ${tenant(s)} AND id=${eventId}::uuid`.execute(
          tx,
        );
        const delivery = (
          await sql<{
            id: string;
          }>`INSERT INTO webhook_deliveries(organization_id,guild_id,endpoint_id,event_id,secret_version,available_at) VALUES(${s.organizationId}::uuid,${s.guildId},${row.endpoint_id}::uuid,${eventId}::uuid,${endpoint.secret_version},${now}) ON CONFLICT(organization_id,guild_id,endpoint_id,event_id) DO UPDATE SET event_id=EXCLUDED.event_id RETURNING id`.execute(
            tx,
          )
        ).rows[0]!;
        await sql`UPDATE playbook_action_runs SET state='QUEUED',delivery_id=${delivery.id}::uuid WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
          tx,
        );
      }
      return true;
    });
  }
  private async sync(s: Scope) {
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await new EntitlementService(tx).require(s, "playbooks");
      await sql`UPDATE playbook_action_runs r SET state=q.state FROM action_outbox q WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND q.organization_id=r.organization_id AND q.guild_id=r.guild_id AND q.id=r.action_id AND r.state='QUEUED' AND q.state IN ('SUCCEEDED','FAILED','UNKNOWN')`.execute(
        tx,
      );
      await sql`UPDATE playbook_action_runs r SET state=q.state FROM webhook_deliveries q WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND q.organization_id=r.organization_id AND q.guild_id=r.guild_id AND q.id=r.delivery_id AND r.state='QUEUED' AND q.state IN ('SUCCEEDED','FAILED')`.execute(
        tx,
      );
      const done = (
        await sql<{
          id: string;
          state: string;
        }>`UPDATE playbook_executions e SET state=CASE WHEN EXISTS(SELECT 1 FROM playbook_action_runs a WHERE a.organization_id=e.organization_id AND a.guild_id=e.guild_id AND a.execution_id=e.id AND a.state='UNKNOWN') THEN 'UNKNOWN' WHEN EXISTS(SELECT 1 FROM playbook_action_runs a WHERE a.organization_id=e.organization_id AND a.guild_id=e.guild_id AND a.execution_id=e.id AND a.state='FAILED') THEN 'FAILED' WHEN NOT EXISTS(SELECT 1 FROM playbook_action_runs a WHERE a.organization_id=e.organization_id AND a.guild_id=e.guild_id AND a.execution_id=e.id AND a.state='SUCCEEDED') THEN 'SUPPRESSED' ELSE 'SUCCEEDED' END WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.state='QUEUED' AND NOT EXISTS(SELECT 1 FROM playbook_action_runs a WHERE a.organization_id=e.organization_id AND a.guild_id=e.guild_id AND a.execution_id=e.id AND a.state IN ('PENDING','QUEUED','PAUSED_PLAN_LIMIT')) RETURNING e.id,e.state`.execute(
          tx,
        )
      ).rows;
      for (const execution of done)
        if (execution.state === "SUCCEEDED")
          await operationsEvent(
            tx,
            s,
            "playbook.executed",
            "playbook-result:" + execution.id,
            { executionId: execution.id },
          );
    });
    const measured = (
      await sql<{
        id: string;
        definition: unknown;
        name: string;
      }>`SELECT e.id,r.definition,p.name FROM playbook_executions e JOIN playbook_revisions r ON r.organization_id=e.organization_id AND r.guild_id=e.guild_id AND r.id=e.revision_id JOIN playbooks p ON p.organization_id=e.organization_id AND p.guild_id=e.guild_id AND p.id=e.playbook_id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND EXISTS(SELECT 1 FROM playbook_action_runs a WHERE a.organization_id=e.organization_id AND a.guild_id=e.guild_id AND a.execution_id=e.id AND a.state='SUCCEEDED') AND NOT EXISTS(SELECT 1 FROM operations_interventions i WHERE i.organization_id=e.organization_id AND i.guild_id=e.guild_id AND i.execution_id=e.id) ORDER BY e.created_at LIMIT 1`.execute(
        this.db,
      )
    ).rows[0];
    if (measured)
      await new InterventionReview(this.db).create(
        s,
        {
          key: "system",
          permissions: "8",
          roles: [],
          source: "SYSTEM",
          requestId: "playbook-measurement",
        },
        {
          title: measured.name,
          query: playbookDefinition.parse(measured.definition).measurement
            .query,
          executionId: measured.id,
        },
      );
  }
}
