import { createHash, randomUUID } from "node:crypto";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
} from "../../../packages/db/src/index";
import {
  assert,
  isDomainError,
  type Scope,
} from "../../../packages/shared/src/index";
import { EntitlementService } from "../../../packages/settings/src/billing/entitlements";
import {
  scheduleInput,
  nextReportOccurrence,
} from "../../../packages/operations/src/schedule";
import {
  operationsEvent,
  operationsLock,
} from "../../../packages/operations/src/policy";
import { ExploreService } from "../../../packages/analytics/src/explore";
import {
  chartQuerySchema,
  chartCsv,
  type ChartQuery,
  type ChartSpec,
} from "../../../packages/analytics/src/chart-spec";
import { renderChartPng } from "../../../packages/analytics/src/chart-renderer";
import {
  chartLocale,
  chartSummary,
  chartCaveat,
} from "../../../packages/analytics/src/chart-language";
import { SettingsService } from "../../../packages/settings/src/index";
import { resolveLocale } from "../../../packages/discord-panels/src/i18n";
import { enqueue } from "../../../packages/discord/src/outbox";
export class ReportWorker {
  constructor(private readonly db: Database) {}
  async tick(s: Scope, now = new Date()) {
    if (!(await new EntitlementService(this.db).can(s, "scheduled_reports")))
      return false;
    const leaseToken = randomUUID(),
      run = await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await operationsLock(tx, s);
        await new EntitlementService(tx).require(s, "scheduled_reports");
        await sql`UPDATE report_runs r SET state=q.state FROM action_outbox q WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND q.organization_id=r.organization_id AND q.guild_id=r.guild_id AND q.id=r.action_id AND r.state='QUEUED' AND q.state IN ('SUCCEEDED','FAILED','UNKNOWN')`.execute(
          tx,
        );
        await sql`UPDATE report_runs r SET state=q.state FROM webhook_deliveries q WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND q.organization_id=r.organization_id AND q.guild_id=r.guild_id AND q.id=r.delivery_id AND r.state='QUEUED' AND q.state IN ('SUCCEEDED','FAILED')`.execute(
          tx,
        );
        await sql`UPDATE report_runs SET state='PENDING',lease_until=NULL,lease_token=NULL WHERE ${tenant(s)} AND state='RUNNING' AND lease_until<=${now}`.execute(
          tx,
        );
        const due = (
          await sql<{
            id: string;
            next_at: Date;
            cadence: "WEEKLY" | "MONTHLY";
            timezone: string;
            day: number;
            hour: number;
            minute: number;
            revision: number;
          }>`SELECT id,next_at,cadence,timezone,day,hour,minute,revision FROM report_schedules WHERE ${tenant(s)} AND state='ENABLED' AND next_at<=${now} ORDER BY next_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`.execute(
            tx,
          )
        ).rows[0];
        if (due) {
          await sql`INSERT INTO report_runs(organization_id,guild_id,schedule_id,scheduled_at,schedule_revision) VALUES(${s.organizationId}::uuid,${s.guildId},${due.id}::uuid,${due.next_at},${due.revision}) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
          await sql`UPDATE report_schedules SET next_at=${nextReportOccurrence(scheduleInput.parse({ cadence: due.cadence, timezone: due.timezone, day: due.day, hour: due.hour, minute: due.minute }), now)} WHERE ${tenant(s)} AND id=${due.id}::uuid`.execute(
            tx,
          );
        }
        const row = (
          await sql<{
            id: string;
            schedule_id: string;
            scheduled_at: Date;
            schedule_revision: number;
          }>`SELECT id,schedule_id,scheduled_at,schedule_revision FROM report_runs WHERE ${tenant(s)} AND state='PENDING' ORDER BY scheduled_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`.execute(
            tx,
          )
        ).rows[0];
        if (row)
          await sql`UPDATE report_runs SET state='RUNNING',lease_until=${new Date(now.getTime() + 120000)},lease_token=${leaseToken}::uuid WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
            tx,
          );
        return row;
      });
    if (!run) return false;
    try {
      const template = (
        await sql<{
          template_id: string;
          destination_id: string;
          format: "DISCORD" | "CSV" | "JSON" | "WEBHOOK";
          title: string;
          footer: string;
          logo_base64: string | null;
          queries: ChartQuery[];
          include_attention: boolean;
          include_interventions: boolean;
          kind: string;
          channel_id: string | null;
          role_id: string | null;
          endpoint_id: string | null;
          revision: number;
          state: string;
        }>`SELECT t.id AS template_id,c.destination_id,c.format,t.title,t.footer,t.logo_base64,t.queries,t.include_attention,t.include_interventions,t.revision,d.kind,d.channel_id,d.role_id,d.endpoint_id,d.state FROM report_schedules c JOIN report_templates t ON t.organization_id=c.organization_id AND t.guild_id=c.guild_id AND t.id=c.template_id JOIN integration_destinations d ON d.organization_id=c.organization_id AND d.guild_id=c.guild_id AND d.id=c.destination_id WHERE c.organization_id=${s.organizationId}::uuid AND c.guild_id=${s.guildId} AND c.id=${run.schedule_id}::uuid AND c.state='ENABLED'`.execute(
          this.db,
        )
      ).rows[0];
      assert(template && template.state === "ENABLED", "REPORT_DISABLED", 409);
      if (template.format !== "DISCORD")
        await new EntitlementService(this.db).require(s, "recurring_exports");
      const explore = new ExploreService(this.db),
        charts: ChartSpec[] = [];
      for (const query of template.queries)
        charts.push(
          await explore.chart(
            s,
            chartQuerySchema.parse(query),
            run.scheduled_at,
          ),
        );
      const views = (
        await sql<{
          view_id: string;
        }>`SELECT view_id FROM report_template_views WHERE ${tenant(s)} AND template_id=${template.template_id}::uuid ORDER BY view_id`.execute(
          this.db,
        )
      ).rows;
      for (const view of views)
        charts.push(await explore.saved(s, view.view_id, run.scheduled_at));
      assert(
        charts.length >= 1 && charts.length <= 4,
        "REPORT_CHART_LIMIT",
        409,
      );
      const summary = await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await new EntitlementService(tx).require(s, "scheduled_reports");
        return (
          await sql<{
            open_attention: number;
            reviews_ready: number;
          }>`SELECT (SELECT count(*)::int FROM attention_items WHERE ${tenant(s)} AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')) AS open_attention,(SELECT count(*)::int FROM operations_interventions WHERE ${tenant(s)} AND state='REVIEW_READY') AS reviews_ready`.execute(
            tx,
          )
        ).rows[0]!;
      });
      const locale = chartLocale(
        resolveLocale((await new SettingsService(this.db).get(s)).uiLanguage),
      );
      const files: { filename: string; dataBase64: string }[] = [];
      if (template.format !== "WEBHOOK")
        for (let i = 0; i < charts.length; i++) {
          const chart = charts[i]!;
          if (template.format === "DISCORD") {
            chart.branding = {
              title: template.title,
              footer: template.footer,
              logoBase64: template.logo_base64,
            };
            chart.cacheKey = createHash("sha256")
              .update(chart.cacheKey + JSON.stringify(chart.branding))
              .digest("hex");
            files.push({
              filename: `nexus-report-${i}.png`,
              dataBase64: (await renderChartPng(chart, locale)).toString(
                "base64",
              ),
            });
          } else
            files.push({
              filename: `nexus-report-${i}.${template.format.toLowerCase()}`,
              dataBase64: Buffer.from(
                template.format === "CSV"
                  ? chartCsv(chart)
                  : JSON.stringify(chart),
              ).toString("base64"),
            });
        }
      await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await operationsLock(tx, s);
        await new EntitlementService(tx).require(
          s,
          template.format === "DISCORD"
            ? "scheduled_reports"
            : "recurring_exports",
        );
        if (
          !(
            await sql`SELECT id FROM report_runs WHERE ${tenant(s)} AND id=${run.id}::uuid AND state='RUNNING' AND lease_token=${leaseToken}::uuid AND lease_until>now() FOR UPDATE`.execute(
              tx,
            )
          ).rows.length
        )
          return;
        const enabled = (
          await sql`SELECT c.id FROM report_schedules c JOIN report_templates t ON t.organization_id=c.organization_id AND t.guild_id=c.guild_id AND t.id=c.template_id JOIN integration_destinations d ON d.organization_id=c.organization_id AND d.guild_id=c.guild_id AND d.id=c.destination_id WHERE c.organization_id=${s.organizationId}::uuid AND c.guild_id=${s.guildId} AND c.id=${run.schedule_id}::uuid AND c.state='ENABLED' AND c.revision=${run.schedule_revision} AND d.state='ENABLED' AND t.revision=${template.revision}`.execute(
            tx,
          )
        ).rows.length;
        assert(enabled, "REPORT_CONFIGURATION_CHANGED", 409);
        if (template.format === "WEBHOOK") {
          assert(template.kind === "WEBHOOK", "DESTINATION_KIND_MISMATCH", 409);
          await new EntitlementService(tx).require(s, "webhooks");
          const endpoint = (
            await sql<{
              secret_version: number;
            }>`SELECT secret_version FROM webhook_endpoints WHERE ${tenant(s)} AND id=${template.endpoint_id}::uuid AND state='ENABLED'`.execute(
              tx,
            )
          ).rows[0];
          assert(endpoint, "WEBHOOK_DISABLED", 409);
          const eventId = await operationsEvent(
            tx,
            s,
            "aggregate.export",
            "report-export:" + run.id,
            { reportRunId: run.id, title: template.title, charts, summary },
          );
          await sql`UPDATE operations_domain_events SET expanded_at=now() WHERE ${tenant(s)} AND id=${eventId}::uuid`.execute(
            tx,
          );
          const delivery = (
            await sql<{
              id: string;
            }>`INSERT INTO webhook_deliveries(organization_id,guild_id,endpoint_id,event_id,secret_version) VALUES(${s.organizationId}::uuid,${s.guildId},${template.endpoint_id}::uuid,${eventId}::uuid,${endpoint.secret_version}) ON CONFLICT(organization_id,guild_id,endpoint_id,event_id) DO UPDATE SET event_id=EXCLUDED.event_id RETURNING id`.execute(
              tx,
            )
          ).rows[0]!;
          await sql`UPDATE report_runs SET state='QUEUED',delivery_id=${delivery.id}::uuid,template_revision=${template.revision},lease_until=NULL,lease_token=NULL WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(
            tx,
          );
        } else {
          assert(template.kind === "DISCORD", "DESTINATION_KIND_MISMATCH", 409);
          const body = {
              content:
                `${template.role_id ? "<@&" + template.role_id + "> " : ""}**${template.title}**\n${run.scheduled_at.toISOString()}\n${charts.map((chart) => chartSummary(chart, locale)).join("\n\n")}\n${chartCaveat(locale)}\n${template.include_attention ? (locale === "ja" ? "要確認の記録: " : "Open review records: ") + summary.open_attention + "\n" : ""}${template.include_interventions ? (locale === "ja" ? "振り返り可能な対応記録: " : "Follow-up records ready for review: ") + summary.reviews_ready + "\n" : ""}${template.footer}`.slice(
                  0,
                  2000,
                ),
              allowed_mentions: {
                parse: [] as never[],
                roles: template.role_id ? [template.role_id] : [],
              },
              ...(template.format === "DISCORD"
                ? {
                    embeds: files.map((file) => ({
                      color: 0x2758ca,
                      image: { url: "attachment://" + file.filename },
                    })),
                  }
                : {}),
            },
            actionId = await enqueue(
              tx,
              s,
              "report:" + run.id,
              "REPORT_PUBLISH",
              {
                channelId: template.channel_id,
                roleId: template.role_id,
                body,
                files,
                export: template.format !== "DISCORD",
                reportRunId: run.id,
              },
            );
          await sql`UPDATE report_runs SET state='QUEUED',action_id=${actionId}::uuid,template_revision=${template.revision},lease_until=NULL,lease_token=NULL WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(
            tx,
          );
        }
      });
    } catch (error) {
      await sql`UPDATE report_runs SET state='FAILED',last_error=${isDomainError(error) ? error.code : "REPORT_RENDER_FAILED"},lease_until=NULL WHERE ${tenant(s)} AND id=${run.id}::uuid AND state='RUNNING' AND lease_token=${leaseToken}::uuid`.execute(
        this.db,
      );
    }
    return true;
  }
}
