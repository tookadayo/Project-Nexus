import { z } from "zod";
import { sql, tenant, json, type Database } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { chartQuerySchema } from "../../analytics/src/chart-spec";
import { operationsAccess, operationsAudit, operationsLock } from "./policy";
import { scheduleInput, nextReportOccurrence } from "./schedule";
export const logoSchema = z
  .string()
  .max(140000)
  .nullable()
  .default(null)
  .refine((value) => {
    if (value === null) return true;
    try {
      const bytes = Buffer.from(value, "base64");
      return (
        bytes.toString("base64") === value &&
        bytes.length >= 24 &&
        bytes.length <= 100000 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR" &&
        bytes.readUInt32BE(16) <= 1024 &&
        bytes.readUInt32BE(20) <= 1024
      );
    } catch {
      return false;
    }
  }, "INVALID_PNG_LOGO");
export const reportTemplateInput = z
  .object({
    id: z.uuid().optional(),
    revision: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(120),
    footer: z.string().max(200).default(""),
    logoBase64: logoSchema,
    queries: z.array(chartQuerySchema).max(4).default([]),
    viewIds: z.array(z.uuid()).max(4).default([]),
    includeAttention: z.boolean().default(true),
    includeInterventions: z.boolean().default(true),
  })
  .strict()
  .refine(
    (input) =>
      input.queries.length + input.viewIds.length >= 1 &&
      input.queries.length + input.viewIds.length <= 4,
    "CHOOSE_ONE_TO_FOUR_CHARTS",
  );
export class Reports {
  constructor(private readonly db: Database) {}
  async template(s: Scope, actor: Actor, input: unknown) {
    const data = reportTemplateInput.parse(input);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      await operationsLock(tx, s);
      for (const id of data.viewIds)
        assert(
          (
            await sql`SELECT id FROM saved_metric_views WHERE ${tenant(s)} AND id=${id}::uuid`.execute(
              tx,
            )
          ).rows.length,
          "SAVED_VIEW_NOT_FOUND",
          404,
        );
      let row: { id: string; revision: number };
      if (data.id) {
        row = (
          await sql<{
            id: string;
            revision: number;
          }>`UPDATE report_templates SET title=${data.title},footer=${data.footer},logo_base64=${data.logoBase64},queries=${json(data.queries)},include_attention=${data.includeAttention},include_interventions=${data.includeInterventions},actor_hash=${actor.key},revision=revision+1 WHERE ${tenant(s)} AND id=${data.id}::uuid AND revision=${data.revision ?? 0} RETURNING id,revision`.execute(
            tx,
          )
        ).rows[0]!;
        assert(row, "REVISION_CONFLICT", 409);
        await sql`DELETE FROM report_template_views WHERE ${tenant(s)} AND template_id=${data.id}::uuid`.execute(
          tx,
        );
      } else
        row = (
          await sql<{
            id: string;
            revision: number;
          }>`INSERT INTO report_templates(organization_id,guild_id,title,footer,logo_base64,queries,include_attention,include_interventions,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${data.title},${data.footer},${data.logoBase64},${json(data.queries)},${data.includeAttention},${data.includeInterventions},${actor.key}) RETURNING id,revision`.execute(
            tx,
          )
        ).rows[0]!;
      for (const id of data.viewIds)
        await sql`INSERT INTO report_template_views VALUES(${s.organizationId}::uuid,${s.guildId},${row.id}::uuid,${id}::uuid)`.execute(
          tx,
        );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "REPORT_TEMPLATE_SAVED",
        row.id,
        row.revision,
      );
      return row;
    });
  }
  async schedule(s: Scope, actor: Actor, input: unknown, now = new Date()) {
    const data = z
        .object({
          templateId: z.uuid(),
          destinationId: z.uuid(),
          clock: scheduleInput,
          format: z
            .enum(["DISCORD", "CSV", "JSON", "WEBHOOK"])
            .default("DISCORD"),
        })
        .strict()
        .parse(input),
      next = nextReportOccurrence(data.clock, now);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "scheduled_reports");
      if (data.format !== "DISCORD")
        await new EntitlementService(tx).require(s, "recurring_exports");
      await operationsLock(tx, s);
      const destination = (
        await sql<{
          kind: string;
        }>`SELECT kind FROM integration_destinations WHERE ${tenant(s)} AND id=${data.destinationId}::uuid AND state='ENABLED'`.execute(
          tx,
        )
      ).rows[0];
      assert(
        destination &&
          (data.format === "WEBHOOK"
            ? destination.kind === "WEBHOOK"
            : destination.kind === "DISCORD"),
        "DESTINATION_KIND_MISMATCH",
        409,
      );
      const count = (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM report_schedules WHERE ${tenant(s)} AND state='ENABLED'`.execute(
          tx,
        )
      ).rows[0]!.n;
      assert(
        (await new EntitlementService(tx).limit(s, "scheduledReports", count))
          .allowed,
        "BILLING_LIMIT_REACHED",
        403,
      );
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO report_schedules(organization_id,guild_id,template_id,destination_id,cadence,timezone,day,hour,minute,next_at,format) VALUES(${s.organizationId}::uuid,${s.guildId},${data.templateId}::uuid,${data.destinationId}::uuid,${data.clock.cadence},${data.clock.timezone},${data.clock.day},${data.clock.hour},${data.clock.minute},${next},${data.format}) RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      await operationsAudit(
        tx,
        s,
        actor.key,
        "REPORT_SCHEDULE_CREATED",
        row.id,
        1,
      );
      return { ...row, nextAt: next.toISOString() };
    });
  }
  async setEnabled(
    s: Scope,
    actor: Actor,
    id: string,
    enabled: boolean,
    now = new Date(),
  ) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(
        tx,
        s,
        actor,
        "CONFIGURE",
        enabled ? "scheduled_reports" : undefined,
      );
      await operationsLock(tx, s);
      const row = (
        await sql<{
          cadence: "WEEKLY" | "MONTHLY";
          timezone: string;
          day: number;
          hour: number;
          minute: number;
          format: string;
        }>`SELECT cadence,timezone,day,hour,minute,format FROM report_schedules WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "REPORT_NOT_FOUND", 404);
      if (enabled) {
        if (row.format !== "DISCORD")
          await new EntitlementService(tx).require(s, "recurring_exports");
        const count = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM report_schedules WHERE ${tenant(s)} AND state='ENABLED' AND id<>${id}::uuid`.execute(
            tx,
          )
        ).rows[0]!.n;
        assert(
          (await new EntitlementService(tx).limit(s, "scheduledReports", count))
            .allowed,
          "BILLING_LIMIT_REACHED",
          403,
        );
      }
      await sql`UPDATE report_schedules SET state=${enabled ? "ENABLED" : "DISABLED"},next_at=${nextReportOccurrence(row, now)},revision=revision+1 WHERE ${tenant(s)} AND id=${id}::uuid`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        enabled ? "REPORT_ENABLED" : "REPORT_DISABLED",
        id,
        null,
      );
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      return {
        templates: (
          await sql`SELECT id,title,footer,queries,include_attention,include_interventions,revision,logo_base64 IS NOT NULL AS branded_logo FROM report_templates WHERE ${tenant(s)} ORDER BY title LIMIT 100`.execute(
            tx,
          )
        ).rows,
        schedules: (
          await sql`SELECT * FROM report_schedules WHERE ${tenant(s)} ORDER BY next_at LIMIT 100`.execute(
            tx,
          )
        ).rows,
        runs: (
          await sql`SELECT id,schedule_id,scheduled_at,state,last_error FROM report_runs WHERE ${tenant(s)} ORDER BY scheduled_at DESC LIMIT 100`.execute(
            tx,
          )
        ).rows,
      };
    });
  }
}
