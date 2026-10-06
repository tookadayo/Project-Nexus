import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql, tenant, json, type Database, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { ExploreService } from "../../analytics/src/explore";
import {
  chartQuerySchema,
  type ChartSpec,
} from "../../analytics/src/chart-spec";
import type { MetricEvidence } from "../../shared/src/metric-evidence";
import { operationsAccess, operationsAudit, operationsLock } from "./policy";
export const attentionTypes = [
  "TEXT_NEWCOMER",
  "FORUM_SUPPORT",
  "LFG_RESPONSE",
  "EVENT_OPERATION",
  "INTEGRATION_HEALTH",
  "OPERATIONS_REQUEST",
] as const;
export const playbookDefinition = z
  .object({
    trigger: z.discriminatedUnion("kind", [
      z
        .object({ kind: z.literal("ATTENTION"), type: z.enum(attentionTypes) })
        .strict(),
      z
        .object({
          kind: z.literal("TREND"),
          query: chartQuerySchema,
          mode: z.enum([
            "THRESHOLD",
            "WEEK_OVER_WEEK",
            "PERIOD_OVER_PERIOD",
            "RELATIVE_CHANGE",
          ]),
          direction: z.enum(["ABOVE", "BELOW"]),
          threshold: z.number().finite().min(-1000000000).max(1000000000),
        })
        .strict(),
    ]),
    condition: z
      .object({
        minimumSample: z.number().int().min(0).max(1000000).default(1),
      })
      .strict()
      .default({ minimumSample: 1 }),
    destinations: z
      .array(z.uuid())
      .min(1)
      .max(5)
      .transform((v) => [...new Set(v)]),
    escalation: z
      .object({
        afterMinutes: z.number().int().min(15).max(10080),
        destinationId: z.uuid(),
      })
      .strict()
      .nullable()
      .default(null),
    measurement: z.object({ query: chartQuerySchema }).strict(),
  })
  .strict();
export type PlaybookDefinition = z.infer<typeof playbookDefinition>;
export const workflowTemplates = [
  {
    key: "newcomer-response",
    name: "Newcomer response",
    type: "TEXT_NEWCOMER",
  },
  {
    key: "support-first-response",
    name: "Support first response",
    type: "FORUM_SUPPORT",
  },
  { key: "lfg-response", name: "LFG response", type: "LFG_RESPONSE" },
  { key: "event-follow-up", name: "Event follow-up", type: "EVENT_OPERATION" },
  {
    key: "coverage-degradation",
    name: "Coverage degradation",
    type: "INTEGRATION_HEALTH",
  },
] as const;
export function evaluateTrend(
  definition: Extract<PlaybookDefinition["trigger"], { kind: "TREND" }>,
  spec: ChartSpec,
  minimumSample: number,
) {
  const comparable =
      definition.mode === "THRESHOLD" || spec.comparison?.comparable === true,
    known =
      spec.evidence.value !== null &&
      spec.evidence.coverageState === "COMPLETE" &&
      spec.evidence.observationState === "OBSERVED" &&
      spec.evidence.sampleSize >= minimumSample;
  const value =
    definition.mode === "THRESHOLD"
      ? spec.evidence.value
      : definition.mode === "RELATIVE_CHANGE"
        ? spec.comparison?.relativeChange
        : spec.comparison?.absoluteChange;
  const suppressed =
    !known || !comparable || value === null || value === undefined;
  return {
    triggered:
      !suppressed &&
      (definition.direction === "ABOVE"
        ? value! > definition.threshold
        : value! < definition.threshold),
    suppressed,
    evidence: spec.evidence,
    value: value ?? null,
    reason: suppressed ? "EVIDENCE_NOT_COMPARABLE" : null,
  };
}
export type PlaybookHead = {
  id: string;
  name: string;
  state: string;
  head_id: string;
  version: number;
  approval_required: boolean;
  creator_hash: string;
  approved_by: string | null;
  definition: unknown;
  revision: number;
  last_evaluated_at: Date | null;
};
export class Playbooks {
  constructor(private readonly db: Database) {}
  async save(s: Scope, actor: Actor, input: unknown) {
    const data = z
      .object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(80),
        version: z.number().int().positive().optional(),
        approvalRequired: z.boolean().default(false),
        definition: playbookDefinition,
      })
      .strict()
      .parse(input);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "playbooks");
      await operationsLock(tx, s);
      if (data.approvalRequired)
        await new EntitlementService(tx).require(s, "approval_workflow");
      const previous = data.id
        ? (
            await sql<PlaybookHead>`SELECT * FROM playbooks WHERE ${tenant(s)} AND id=${data.id}::uuid FOR UPDATE`.execute(
              tx,
            )
          ).rows[0]
        : null;
      assert(!data.id || previous, "PLAYBOOK_NOT_FOUND", 404);
      assert(
        !previous || previous.version === data.version,
        "REVISION_CONFLICT",
        409,
      );
      if (!previous) {
        const count = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM playbooks WHERE ${tenant(s)} AND state<>'ARCHIVED'`.execute(
            tx,
          )
        ).rows[0]!.n;
        assert(
          (await new EntitlementService(tx).limit(s, "automationRules", count))
            .allowed,
          "BILLING_LIMIT_REACHED",
          403,
        );
      }
      await validateRoutes(tx, s, data.definition);
      const id = previous?.id ?? randomUUID(),
        headId = randomUUID(),
        version = (previous?.version ?? 0) + 1,
        revision = (
          await sql<{
            revision: number;
          }>`SELECT COALESCE(max(revision),0)+1 AS revision FROM playbook_revisions WHERE ${tenant(s)} AND playbook_id=${id}::uuid`.execute(
            tx,
          )
        ).rows[0]!.revision;
      if (!previous)
        await sql`INSERT INTO playbooks(organization_id,guild_id,id,name,creator_hash,approval_required) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${data.name},${actor.key},${data.approvalRequired})`.execute(
          tx,
        );
      await sql`INSERT INTO playbook_revisions(organization_id,guild_id,id,playbook_id,revision,definition,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${headId}::uuid,${id}::uuid,${revision},${json(data.definition)},${actor.key})`.execute(
        tx,
      );
      await sql`UPDATE playbooks SET head_id=${headId}::uuid,name=${data.name},state='DRAFT',approved_by=NULL,approval_required=${data.approvalRequired},version=${version},creator_hash=${actor.key},last_evaluated_at=NULL WHERE ${tenant(s)} AND id=${id}::uuid`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "PLAYBOOK_REVISION_CREATED",
        id,
        revision,
      );
      return { id, headId, version, revision, state: "DRAFT" };
    });
  }
  async transition(s: Scope, actor: Actor, input: unknown) {
    const data = z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        state: z.enum(["SUBMITTED", "APPROVED", "ACTIVE", "ARCHIVED"]),
        teamId: z.uuid().nullable().optional(),
      })
      .strict()
      .parse(input);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(
        tx,
        s,
        actor,
        data.state === "APPROVED" ? "GOVERN" : "CONFIGURE",
        "playbooks",
      );
      await operationsLock(tx, s);
      const row = (
        await sql<PlaybookHead>`SELECT p.*,r.definition,r.revision FROM playbooks p JOIN playbook_revisions r ON r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.id=p.head_id WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.id=${data.id}::uuid FOR UPDATE OF p`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "PLAYBOOK_NOT_FOUND", 404);
      assert(row.version === data.version, "REVISION_CONFLICT", 409);
      if (data.state === "SUBMITTED")
        assert(row.state === "DRAFT", "INVALID_APPROVAL_STATE", 409);
      if (data.state === "APPROVED") {
        await new EntitlementService(tx).require(s, "approval_workflow");
        assert(
          row.state === "SUBMITTED" && row.creator_hash !== actor.key,
          "INDEPENDENT_APPROVER_REQUIRED",
          409,
        );
      }
      if (data.state === "ACTIVE") {
        assert(
          row.approval_required
            ? row.state === "APPROVED"
            : ["DRAFT", "APPROVED"].includes(row.state),
          "APPROVAL_REQUIRED",
          409,
        );
        await validateRoutes(tx, s, playbookDefinition.parse(row.definition));
      }
      if (data.teamId !== undefined)
        await new EntitlementService(tx).require(s, "team_assignment");
      await sql`UPDATE playbooks SET state=${data.state},version=version+1,approved_by=CASE WHEN ${data.state === "APPROVED"} THEN ${actor.key} ELSE approved_by END,review_team_id=CASE WHEN ${data.teamId !== undefined} THEN ${data.teamId ?? null}::uuid ELSE review_team_id END WHERE ${tenant(s)} AND id=${data.id}::uuid`.execute(
        tx,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "PLAYBOOK_" + data.state,
        data.id,
        row.revision,
      );
      return { id: data.id, state: data.state, version: row.version + 1 };
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      return (
        await sql<PlaybookHead>`SELECT p.*,r.definition,r.revision FROM playbooks p JOIN playbook_revisions r ON r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.id=p.head_id WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} ORDER BY p.name,p.id LIMIT 100`.execute(
          tx,
        )
      ).rows;
    });
  }
  async dryRun(
    s: Scope,
    actor: Actor,
    id: string,
    days: number,
    now = new Date(),
  ) {
    z.uuid().parse(id);
    assert(
      Number.isInteger(days) && days >= 1 && days <= 30,
      "INVALID_SIMULATION_RANGE",
    );
    let row: PlaybookHead;
    await this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "ANALYZE", "automation_sandbox");
      row = (
        await sql<PlaybookHead>`SELECT p.*,r.definition,r.revision FROM playbooks p JOIN playbook_revisions r ON r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.id=p.head_id WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.id=${id}::uuid`.execute(
          tx,
        )
      ).rows[0]!;
      assert(row, "PLAYBOOK_NOT_FOUND", 404);
    });
    const definition = playbookDefinition.parse(row!.definition),
      result = {
        revision: row!.revision,
        wouldTrigger: 0,
        wouldNotify: 0,
        wouldEscalate: 0,
        suppressedDueToCoverage: 0,
        actualActions: 0,
      };
    if (definition.trigger.kind === "TREND")
      for (let i = days - 1; i >= 0; i--) {
        const at = new Date(now.getTime() - i * 86400000),
          query = trendQuery(definition.trigger),
          spec = await new ExploreService(this.db).chart(s, query, at),
          evaluation = evaluateTrend(
            definition.trigger,
            spec,
            definition.condition.minimumSample,
          );
        if (evaluation.suppressed) result.suppressedDueToCoverage++;
        if (evaluation.triggered) {
          result.wouldTrigger++;
          result.wouldNotify += definition.destinations.length;
          if (definition.escalation) result.wouldEscalate++;
        }
      }
    else {
      const type = definition.trigger.type,
        observations = await this.db.transaction().execute(async (tx) => {
          await operationsAccess(tx, s, actor, "ANALYZE", "automation_sandbox");
          return (
            await sql<{
              evidence: MetricEvidence | null;
              acknowledged_at: Date | null;
              resolved_at: Date | null;
              opened_at: Date;
            }>`SELECT evidence,acknowledged_at,resolved_at,opened_at FROM attention_items WHERE ${tenant(s)} AND item_type=${type} AND opened_at>=${new Date(now.getTime() - days * 86400000)} AND opened_at<${now} ORDER BY opened_at,message_id`.execute(
              tx,
            )
          ).rows;
        });
      for (const observation of observations) {
        if (
          !observation.evidence ||
          observation.evidence.coverageState !== "COMPLETE" ||
          observation.evidence.sampleSize < definition.condition.minimumSample
        ) {
          result.suppressedDueToCoverage++;
          continue;
        }
        result.wouldTrigger++;
        result.wouldNotify += definition.destinations.length;
        if (definition.escalation) {
          const cutoff =
            observation.opened_at.getTime() +
            definition.escalation.afterMinutes * 60000;
          if (
            cutoff < now.getTime() &&
            (!observation.acknowledged_at ||
              observation.acknowledged_at.getTime() > cutoff) &&
            (!observation.resolved_at ||
              observation.resolved_at.getTime() > cutoff)
          )
            result.wouldEscalate++;
        }
      }
    }
    // Simulation does not enqueue, update last_evaluated_at, or call a provider.
    await this.db
      .transaction()
      .execute((tx) =>
        operationsAccess(tx, s, actor, "ANALYZE", "automation_sandbox"),
      );
    return result;
  }
}
export function trendQuery(
  trigger: Extract<PlaybookDefinition["trigger"], { kind: "TREND" }>,
) {
  return {
    ...trigger.query,
    days: trigger.mode === "WEEK_OVER_WEEK" ? (7 as const) : trigger.query.days,
    compare: trigger.mode !== "THRESHOLD",
  };
}
export async function validateRoutes(
  tx: Tx,
  s: Scope,
  definition: PlaybookDefinition,
) {
  const ids = [
    ...definition.destinations,
    ...(definition.escalation ? [definition.escalation.destinationId] : []),
  ];
  for (const id of ids)
    assert(
      (
        await sql`SELECT id FROM integration_destinations WHERE ${tenant(s)} AND id=${id}::uuid AND state='ENABLED'`.execute(
          tx,
        )
      ).rows.length,
      "DESTINATION_NOT_FOUND",
      404,
    );
}
