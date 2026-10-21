import {modalTextInput} from "../../discord-panels/src/modal-primitives";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { acquireRuleScopeLocks,ruleScopeLockSet } from "../../rules/src/locks";
import { minimalOperationAudit } from "./alpha16-audit";
import { assertMaintenanceAuthorization, type MaintenanceAuthorizationProof } from "./maintenance-authorization";
import {automationLock} from "../../automation/src/quota";
import {redactWebhookEventSources} from "./webhooks";
import type { APIModalInteractionResponseCallbackData } from "discord-api-types/v10";
import {
  sql,
  tenant,
  json,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { metricEvidence } from "../../shared/src/metric-evidence";
import type { Actor } from "../../settings/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import type { IdentityVault } from "../../identity/src/index";
import type { DiscordPort } from "../../discord/src/rest";
import type { Components } from "../../security/src/index";
import { enqueue } from "../../discord/src/outbox";
import { operationsAccess, operationsAudit, operationsLock } from "./policy";
const defaultFields = [
  { key: "issue", label: "Operations issue", required: true, maxLength: 1000 },
  {
    key: "context",
    label: "Workflow context (optional)",
    required: false,
    maxLength: 1000,
  },
];
export const intakeInput = z
  .object({
    id: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(50),
    destinationId: z.uuid().nullable().default(null),
    fields: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/),
            label: z.string().min(1).max(45),
            required: z.boolean(),
            maxLength: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(5)
      .default(defaultFields),
  })
  .strict()
  .refine(
    (panel) =>
      new Set(panel.fields.map((field) => field.key)).size ===
      panel.fields.length,
    "DUPLICATE_FIELD",
  );
type Field = {
  field_key: string;
  label: string;
  required: boolean;
  max_length: number;
  position: number;
};
export class OperationsIntake {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly discord: DiscordPort,
    private readonly components: Components,
    private readonly maintenanceProof?:MaintenanceAuthorizationProof,
  ) {}
  async save(s: Scope, actor: Actor, input: unknown) {
    const data = intakeInput.parse(input);
    const requiresAdvanced =
      Boolean(data.destinationId) ||
      JSON.stringify(data.fields) !== JSON.stringify(defaultFields);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "intake_panels");
      await operationsLock(tx, s);
      if (
        data.destinationId ||
        JSON.stringify(data.fields) !== JSON.stringify(defaultFields)
      )
        await new EntitlementService(tx).require(s, "surface_breakdowns");
      if (data.destinationId)
        assert(
          (
            await sql`SELECT id FROM integration_destinations WHERE ${tenant(s)} AND id=${data.destinationId}::uuid AND state='ENABLED'`.execute(
              tx,
            )
          ).rows.length,
          "DESTINATION_NOT_FOUND",
          404,
        );
      {
        const count = (
          await sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM operations_intake_panels WHERE ${tenant(s)} AND state IN ('DRAFT','PUBLISHING','PUBLISHED') AND (${data.id ?? null}::uuid IS NULL OR id<>${data.id ?? null}::uuid)`.execute(
            tx,
          )
        ).rows[0]!.n;
        assert(
          (await new EntitlementService(tx).limit(s, "intakePanels", count))
            .allowed,
          "BILLING_LIMIT_REACHED",
          403,
        );
      }
      const row = data.id
        ? (
            await sql<{
              id: string;
              version: number;
            }>`UPDATE operations_intake_panels SET title=${data.title},category=${data.category},destination_id=${data.destinationId}::uuid,requires_advanced=${requiresAdvanced},state='DRAFT',version=version+1 WHERE ${tenant(s)} AND id=${data.id}::uuid AND version=${data.version ?? 0} RETURNING id,version`.execute(
              tx,
            )
          ).rows[0]
        : (
            await sql<{
              id: string;
              version: number;
            }>`INSERT INTO operations_intake_panels(organization_id,guild_id,title,category,destination_id,requires_advanced,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${data.title},${data.category},${data.destinationId}::uuid,${requiresAdvanced},${actor.key}) RETURNING id,version`.execute(
              tx,
            )
          ).rows[0];
      assert(row, "REVISION_CONFLICT", 409);
      await sql`DELETE FROM operations_intake_fields WHERE ${tenant(s)} AND panel_id=${row.id}::uuid`.execute(
        tx,
      );
      for (let position = 0; position < data.fields.length; position++) {
        const field = data.fields[position]!;
        await sql`INSERT INTO operations_intake_fields VALUES(${s.organizationId}::uuid,${s.guildId},${row.id}::uuid,${field.key},${field.label},${field.required},${field.maxLength},${position})`.execute(
          tx,
        );
      }
      await operationsAudit(
        tx,
        s,
        actor.key,
        "INTAKE_PANEL_SAVED",
        row.id,
        row.version,
      );
      return row;
    });
  }
  async publish(
    s: Scope,
    actor: Actor,
    id: string,
    version: number,
    channelId: string,
  ) {
    z.uuid().parse(id);
    z.string()
      .regex(/^\d{17,20}$/)
      .parse(channelId);
    await this.discord.checkChannel(s.guildId, channelId);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE", "intake_panels");
      await operationsLock(tx, s);
      await assertIntakeAvailable(tx, s, id);
      const panel = (
        await sql<{
          title: string;
        }>`UPDATE operations_intake_panels SET state='PUBLISHING',channel_id=${channelId} WHERE ${tenant(s)} AND id=${id}::uuid AND version=${version} AND state='DRAFT' RETURNING title`.execute(
          tx,
        )
      ).rows[0];
      assert(panel, "REVISION_CONFLICT", 409);
      const customId = await this.components.issue(
          tx,
          s,
          { action: "intakeOpen", panelId: id, version },
          null,
          31536000,
        ),
        body = {
          content: `**${panel.title}**\nReport an operations issue, request community support, or flag a workflow problem. Only fields you submit are stored; no ticket transcript is collected.`,
          allowed_mentions: { parse: [] as never[] },
          components: [
            {
              type: 1 as const,
              components: [
                {
                  type: 2 as const,
                  style: 1 as const,
                  label: "Report an operations issue",
                  custom_id: customId,
                },
              ],
            },
          ],
        };
      const actionId = await enqueue(
        tx,
        s,
        "intake-publish:" + id + ":" + version,
        "INTAKE_PUBLISH",
        { channelId, body, intakePanelId: id, intakePanelVersion: version },
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "INTAKE_PANEL_PUBLICATION_REQUESTED",
        id,
        version,
      );
      return { state: "PUBLISHING", actionId };
    });
  }
  async modal(
    s: Scope,
    userId: string,
    intent: Record<string, unknown>,
  ): Promise<APIModalInteractionResponseCallbackData> {
    const id = z.uuid().parse(intent.panelId),
      version = z.number().int().positive().parse(intent.version);
    const member = await this.discord.member(s.guildId, userId);
    assert(!member.bot, "GUILD_MEMBER_REQUIRED", 403);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await new EntitlementService(tx).require(s, "intake_panels");
      await assertIntakeAvailable(tx, s, id);
      const panel = (
        await sql<{
          title: string;
        }>`SELECT title FROM operations_intake_panels WHERE ${tenant(s)} AND id=${id}::uuid AND state='PUBLISHED' AND version=${version}`.execute(
          tx,
        )
      ).rows[0];
      assert(panel, "INTAKE_PANEL_UNAVAILABLE", 409);
      const fields = await intakeFields(tx, s, id),
        customId = await this.components.issue(
          tx,
          s,
          { action: "intakeSubmit", panelId: id, version },
          this.vault.hash(s, userId),
          300,
        );
      return {
        title: panel.title.slice(0, 45),
        custom_id: customId,
        components: fields.map((field) => modalTextInput(field.label, field.field_key, {paragraph:true,required:field.required,maxLength:field.max_length})),
      };
    });
  }
  async submit(
    s: Scope,
    actor: Actor,
    userId: string,
    interactionId: string,
    intent: Record<string, unknown>,
    input: unknown,
  ) {
    assert(actor.key === this.vault.hash(s, userId), "ACTOR_MISMATCH", 403);
    const fields = z.record(z.string(), z.string().max(1000)).parse(input),
      id = z.uuid().parse(intent.panelId),
      version = z.number().int().positive().parse(intent.version),
      interactionDigest = this.vault.digest(
        "operations-intake-interaction",
        s.organizationId + ":" + s.guildId + ":" + interactionId,
      );
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await new EntitlementService(tx).require(s, "intake_panels");
      await operationsLock(tx, s);
      const duplicate = (
        await sql<{
          id: string;
        }>`SELECT id FROM operations_requests WHERE ${tenant(s)} AND interaction_digest=${interactionDigest}`.execute(
          tx,
        )
      ).rows[0];
      if (duplicate) return { id: duplicate.id, duplicate: true };
      await assertIntakeAvailable(tx, s, id);
      const panel = (
        await sql<{
          category: string;
          title: string;
          destination_id: string | null;
        }>`SELECT category,title,destination_id FROM operations_intake_panels WHERE ${tenant(s)} AND id=${id}::uuid AND version=${version} AND state='PUBLISHED' FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(panel, "INTAKE_PANEL_UNAVAILABLE", 409);
      const definition = await intakeFields(tx, s, id);
      assert(
        Object.keys(fields).every((key) =>
          definition.some((field) => field.field_key === key),
        ),
        "UNEXPECTED_FORM_FIELD",
      );
      for (const field of definition)
        assert(
          (!field.required || Boolean(fields[field.field_key]?.trim())) &&
            (fields[field.field_key]?.length ?? 0) <= field.max_length,
          "INVALID_FORM_FIELD",
        );
      const requestId = randomUUID(),
        attentionKey = "intake:" + requestId,
        now = new Date(),
        evidence = metricEvidence({
          metricKey: "operations.request",
          definitionVersion: "explicit-intake-v1",
          definition:
            "Explicitly submitted operations request. This is not a Discord message transcript.",
          value: 1,
          numerator: 1,
          denominator: null,
          sampleSize: 1,
          minimumSample: 0,
          coverageState: "COMPLETE",
          requiredSurfaces: ["EXPLICIT_INTAKE_FORM"],
          evidenceSources: ["operations_requests"],
          coverageReasons: [],
          windowStart: now.toISOString(),
          windowEnd: now.toISOString(),
          collectionEpochIds: [],
        });
      await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,evidence,updated_at,last_actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},'',${attentionKey},${now},'OPEN','OPERATIONS_REQUEST','INTAKE_FORM',${panel.category},${now},${json(evidence)},${now},${actor.key})`.execute(
        tx,
      );
      await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key) VALUES(${s.organizationId}::uuid,${s.guildId},${requestId}::uuid,${id}::uuid,${interactionDigest},${actor.key},${panel.category},${this.vault.seal(s, JSON.stringify({ version, fields, labels: definition.map((field) => ({ key: field.field_key, label: field.label })) }))},${attentionKey})`.execute(
        tx,
      );
      if (panel.destination_id) {
        const destination = (
          await sql<{
            kind: string;
            channel_id: string;
            role_id: string | null;
            team_id: string | null;
          }>`SELECT kind,channel_id,role_id,team_id FROM integration_destinations WHERE ${tenant(s)} AND id=${panel.destination_id}::uuid AND state='ENABLED'`.execute(
            tx,
          )
        ).rows[0];
        if (destination?.kind === "DISCORD")
          await enqueue(tx, s, "intake-notify:" + requestId, "INTAKE_NOTIFY", {
            channelId: destination.channel_id,
            roleId: destination.role_id,
            body: {
              content: `${destination.role_id ? "<@&" + destination.role_id + "> " : ""}New operations request · ${panel.category}\nReview the explicit form in NEXUS. No message transcript was collected.`,
              allowed_mentions: {
                parse: [],
                roles: destination.role_id ? [destination.role_id] : [],
              },
            },
            intakeRequestId: requestId,
          });
        if (
          destination?.kind === "TEAM" &&
          (await new EntitlementService(tx).can(s, "team_assignment"))
        )
          await sql`UPDATE attention_items SET assigned_team_id=${destination.team_id}::uuid WHERE ${tenant(s)} AND message_id=${attentionKey}`.execute(
            tx,
          );
      }
      await operationsAudit(
        tx,
        s,
        actor.key,
        "OPERATIONS_REQUEST_SUBMITTED",
        requestId,
        version,
      );
      return { id: requestId, duplicate: false };
    });
  }
  async disable(s: Scope, actor: Actor, id: string, version: number) {
    z.uuid().parse(id);
    z.number().int().positive().parse(version);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      await operationsLock(tx, s);
      assert(
        (
          await sql`UPDATE operations_intake_panels SET state='DISABLED',version=version+1 WHERE ${tenant(s)} AND id=${id}::uuid AND version=${version} RETURNING id`.execute(
            tx,
          )
        ).rows.length,
        "REVISION_CONFLICT",
        409,
      );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "INTAKE_PANEL_DISABLED",
        id,
        version + 1,
      );
    });
  }
  async list(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      return {
        panels: (
          await sql`SELECT p.id,p.title,p.category,p.destination_id,p.state,p.channel_id,p.message_id,p.version,(SELECT jsonb_agg(jsonb_build_object('key',field_key,'label',label,'required',required,'maxLength',max_length) ORDER BY position) FROM operations_intake_fields f WHERE f.organization_id=p.organization_id AND f.guild_id=p.guild_id AND f.panel_id=p.id) AS fields FROM operations_intake_panels p WHERE ${tenant(s)} ORDER BY p.created_at,p.id LIMIT 100`.execute(
            tx,
          )
        ).rows,
        requests: (
          await sql`SELECT r.id,r.panel_id,r.category,r.attention_key,a.channel_id,a.status,a.version,r.created_at FROM operations_requests r JOIN attention_items a ON a.organization_id=r.organization_id AND a.guild_id=r.guild_id AND a.message_id=r.attention_key WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.state<>'DELETED' ORDER BY r.created_at DESC LIMIT 100`.execute(
            tx,
          )
        ).rows,
      };
    });
  }
  async read(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "OPERATE");
      const row = (
        await sql<{
          fields_ciphertext: string;
        }>`SELECT fields_ciphertext FROM operations_requests WHERE ${tenant(s)} AND id=${id}::uuid AND state<>'DELETED'`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "REQUEST_NOT_FOUND", 404);
      await operationsAudit(
        tx,
        s,
        actor.key,
        "OPERATIONS_REQUEST_VIEWED",
        id,
        null,
      );
      return JSON.parse(this.vault.open(s, row.fields_ciphertext)) as {
        fields: Record<string, string>;
        labels: { key: string; label: string }[];
        version: number;
      };
    });
  }
  async removeRequest(s:Scope,actor:Actor,input:unknown){
    const data=z.object({id:z.uuid(),version:z.number().int().nonnegative()}).strict().parse(input);
    return this.db.transaction().execute(async tx=>{
      await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));await automationLock(tx,s);await operationsAccess(tx,s,actor,"CONFIGURE");await operationsLock(tx,s);
      const request=(await sql<{attention_key:string;state:string}>`SELECT attention_key,state FROM operations_requests WHERE ${tenant(s)} AND id=${data.id}::uuid FOR UPDATE`.execute(tx)).rows[0];assert(request,"REQUEST_NOT_FOUND",404);
      const item=(await sql<{version:number}>`SELECT version FROM attention_items WHERE ${tenant(s)} AND message_id=${request.attention_key} FOR UPDATE`.execute(tx)).rows[0];assert(item,"REQUEST_NOT_FOUND",404);
      assertMaintenanceAuthorization(this.maintenanceProof,s,actor);
      if(request.state==='DELETED')return {id:data.id,deleted:true};
      assert(item.version===data.version,"REVISION_CONFLICT",412);
      const notifications=(await sql<{id:string;state:string}>`SELECT id,state FROM action_outbox WHERE ${tenant(s)} AND payload->>'intakeRequestId'=${data.id} ORDER BY id FOR UPDATE`.execute(tx)).rows;
      assert(notifications.every(n=>n.state!=='RUNNING'),"REQUEST_NOTIFICATION_IN_PROGRESS",409);
      await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND payload->>'intakeRequestId'=${data.id} AND state='PENDING'`.execute(tx);
      const events=(await sql<{id:string}>`SELECT id FROM operations_domain_events WHERE ${tenant(s)} AND data->>'attentionKey'=${request.attention_key} ORDER BY id`.execute(tx)).rows.map(r=>r.id);
      await redactWebhookEventSources(tx,s,events);
      // Source erasure cannot become a synthetic ticket transition or allow a
      // waiting/queued continuation to consume the removed request again.
      await sql`UPDATE automation_runs r SET cancel_requested_at=COALESCE(cancel_requested_at,now()),wake_at=now(),updated_at=now() WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.ended_at IS NULL AND (EXISTS(SELECT 1 FROM automation_event_inbox e WHERE e.organization_id=r.organization_id AND e.guild_id=r.guild_id AND e.run_id=r.id AND e.ticket_id=${request.attention_key}) OR EXISTS(SELECT 1 FROM automation_event_waits w WHERE w.organization_id=r.organization_id AND w.guild_id=r.guild_id AND w.run_id=r.id AND w.ticket_id=${request.attention_key}))`.execute(tx);
      await sql`UPDATE automation_event_inbox SET state=CASE WHEN state='PENDING' THEN 'SKIPPED' ELSE state END,reason='SOURCE_REQUEST_DELETED',finished_at=COALESCE(finished_at,now()),ticket_id=NULL,ticket_state=NULL,ticket_version=NULL,channel_id=NULL,actor_ciphertext=NULL WHERE ${tenant(s)} AND ticket_id=${request.attention_key}`.execute(tx);
      await sql`UPDATE automation_event_waits SET state='CANCELLED',ticket_id=NULL,matched_cursor=NULL,matched_state=NULL,matched_version=NULL,occurred_at=NULL WHERE ${tenant(s)} AND ticket_id=${request.attention_key} AND state IN ('PENDING','MATCHED')`.execute(tx);
      // Keep only the existing bounded receipt identity for duplicate Discord
      // submissions; erase the explicit form values and the participant link.
      await operationsAccess(tx,s,actor,"CONFIGURE");assertMaintenanceAuthorization(this.maintenanceProof,s,actor);
      await sql`UPDATE operations_requests SET fields_ciphertext='',category='',actor_hash='erased-request',state='DELETED',erased_at=now() WHERE ${tenant(s)} AND id=${data.id}::uuid`.execute(tx);
      await sql`UPDATE attention_items SET status='DISMISSED',reason='REQUEST_DELETED',evidence=NULL,last_actor_hash=NULL,snooze_until=NULL,resolved_at=COALESCE(resolved_at,now()),resolution_reason='REQUEST_DELETED',version=version+1,updated_at=now() WHERE ${tenant(s)} AND message_id=${request.attention_key}`.execute(tx);
      await minimalOperationAudit(tx,s,actor.key,"INTAKE_REQUEST_DELETED",data.id,data.version);
      return {id:data.id,deleted:true,externalEffect:"NONE"};
    });
  }
  async removePanel(s:Scope,actor:Actor,input:unknown){
    const data=z.object({id:z.uuid(),version:z.number().int().positive()}).strict().parse(input);
    return this.db.transaction().execute(async tx=>{
      await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));await operationsAccess(tx,s,actor,"CONFIGURE","intake_panels");await operationsLock(tx,s);
      const panel=(await sql<{version:number}>`SELECT version FROM operations_intake_panels WHERE ${tenant(s)} AND id=${data.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assertMaintenanceAuthorization(this.maintenanceProof,s,actor);assert(panel,"INTAKE_PANEL_NOT_FOUND",404);assert(panel.version===data.version,"REVISION_CONFLICT",412);
      assert(!(await sql`SELECT id FROM operations_requests WHERE ${tenant(s)} AND panel_id=${data.id}::uuid AND state<>'DELETED' LIMIT 1`.execute(tx)).rows.length,"INTAKE_PANEL_HAS_REQUESTS",409);
      const pending=(await sql<{state:string}>`SELECT state FROM action_outbox WHERE ${tenant(s)} AND payload->>'intakePanelId'=${data.id} ORDER BY id FOR UPDATE`.execute(tx)).rows;
      await operationsAccess(tx,s,actor,"CONFIGURE","intake_panels");assertMaintenanceAuthorization(this.maintenanceProof,s,actor);
      assert(pending.every(r=>!['RUNNING','UNKNOWN'].includes(r.state)),"INTAKE_PANEL_DELIVERY_UNRESOLVED",409);
      await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND payload->>'intakePanelId'=${data.id} AND state='PENDING'`.execute(tx);
      await sql`DELETE FROM component_tokens WHERE ${tenant(s)} AND intent->>'panelId'=${data.id}`.execute(tx);
      await sql`DELETE FROM operations_intake_panels WHERE ${tenant(s)} AND id=${data.id}::uuid`.execute(tx);
      await minimalOperationAudit(tx,s,actor.key,"INTAKE_PANEL_DELETED",data.id,data.version);
      return {id:data.id,deleted:true,externalEffect:"NONE",publishedMessageDeleted:false};
    });
  }
}
async function intakeFields(tx: Tx, s: Scope, id: string) {
  return (
    await sql<Field>`SELECT field_key,label,required,max_length,position FROM operations_intake_fields WHERE ${tenant(s)} AND panel_id=${id}::uuid ORDER BY position`.execute(
      tx,
    )
  ).rows;
}
export async function assertIntakeAvailable(tx: Tx, s: Scope, id: string) {
  z.uuid().parse(id);
  const ent = new EntitlementService(tx),
    state = await ent.effective(s);
  await ent.require(s, "intake_panels");
  const panel = (
    await sql<{
      destination_id: string | null;
      position: number;
    }>`SELECT p.destination_id,(SELECT count(*)::int FROM operations_intake_panels selected WHERE selected.organization_id=p.organization_id AND selected.guild_id=p.guild_id AND selected.state IN ('DRAFT','PUBLISHING','PUBLISHED') AND (selected.created_at,selected.id)<=(p.created_at,p.id)) AS position FROM operations_intake_panels p WHERE ${tenant(s)} AND id=${id}::uuid AND state IN ('DRAFT','PUBLISHING','PUBLISHED') FOR SHARE`.execute(
      tx,
    )
  ).rows[0];
  assert(panel, "INTAKE_PANEL_UNAVAILABLE", 409);
  assert(
    state.limits.intakePanels === null ||
      panel.position <= state.limits.intakePanels,
    "BILLING_LIMIT_REACHED",
    403,
  );
  if (!(await ent.can(s, "surface_breakdowns"))) {
    const fields = (await intakeFields(tx, s, id)).map((field) => ({
      key: field.field_key,
      label: field.label,
      required: field.required,
      maxLength: field.max_length,
    }));
    assert(
      !panel.destination_id &&
        JSON.stringify(fields) === JSON.stringify(defaultFields),
      "PLAN_REQUIRED",
      403,
    );
  }
}
