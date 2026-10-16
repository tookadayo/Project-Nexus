import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import { assert, isDomainError, type Scope } from "../../shared/src/index";
import { SettingsService, type Actor } from "../../settings/src/index";
import { betaAccess } from "../../security/src/hosted-beta";
import { operationsAccess } from "../../operations/src/policy";
import { automationLock } from "./quota";
import { validateFlowDefinition } from "./definition";
import { scratchNumericOptions } from "./scratch-math-server";
import { validateEventTriggerInputs } from "./event-contract";
import type { AutomationService } from "./service";
import type { FlowDefinition, EvaluatedValue, JsonValue } from "./types";

export interface AutomationEventRow {
  organization_id: string;
  guild_id: string;
  source: "INTERNAL" | "INTERACTION";
  event_id: string;
  flow_id: string;
  revision: number;
  generation: number;
  kind: "ticketCreated" | "ticketUpdated" | "interaction";
  ticket_id: string | null;
  ticket_state: string | null;
  ticket_version: number | null;
  channel_id: string | null;
  actor_hash: string | null;
  actor_ciphertext: string | null;
  beta_generation: number | null;
  occurred_at: Date;
  created_at: Date;
  deadline_at: Date;
  state: "PENDING" | "STARTED" | "SKIPPED";
  run_id: string | null;
  reason: string | null;
}
export interface EventFlowRow {
  id: string;
  name: string;
  draft_revision: number;
  active_revision: number | null;
  state: "DRAFT" | "ACTIVE" | "DISABLED" | "DELETED";
  generation: number;
  activator_hash: string | null;
  activator_ciphertext: string | null;
  beta_generation: number | null;
  updated_at: Date;
}
export type EventAuthorizer = (
  s: Scope,
  identity: { hash: string; ciphertext: string },
  requestId: string,
) => Promise<{ actor: Actor; userId: string; checkedAt: number }>;
type Access = (tx: Tx, s: Scope, actor: Actor) => Promise<unknown>;

/** Registered metadata only. Never receives a domain-event JSON object, message
 * body, evidence, raw Discord fields, or a browser-supplied actor. */
export function automationEventValues(
  definition: FlowDefinition,
  event: AutomationEventRow,
  guildId: string,
  userId?: string,
): Record<string, EvaluatedValue> {
  const trigger = definition.trigger;
  assert(
    (trigger.kind === "internal" || trigger.kind === "interaction") &&
      validateEventTriggerInputs(trigger),
    "AUTOMATION_EVENT_INPUT_INVALID",
  );
  assert(
    trigger.kind === "internal"
      ? event.source === "INTERNAL" && trigger.event === event.kind
      : event.source === "INTERACTION" && event.kind === "interaction",
    "AUTOMATION_EVENT_KIND_INVALID",
  );
  const metadata: Record<string, JsonValue> = {
    "event.ticket": { id: event.ticket_id ?? "", guildId },
    "event.state": event.ticket_state,
    "event.version": event.ticket_version,
    "event.occurredAt": event.occurred_at.toISOString(),
    "interaction.member": { id: userId ?? "", guildId },
    "interaction.channel": { id: event.channel_id ?? "", guildId },
    "interaction.occurredAt": event.occurred_at.toISOString(),
  };
  return Object.fromEntries(
    trigger.inputs.map((input) => [
      input.id,
      {
        type: input.type,
        value: metadata[input.id]!,
        provenance: [{ source: "service", guildId, resumable: true }],
      },
    ]),
  );
}

/** Each source event/revision is terminally admitted once. A permission outage,
 * capacity rejection, disabled flow or changed revision cannot create backlog
 * runs after recovery. DB commit uncertainty is reconciled by this same key. */
export class AutomationEvents {
  constructor(
    readonly db: Database,
    readonly service: AutomationService,
    readonly authorize: EventAuthorizer,
    readonly now: () => Date = () => new Date(),
    readonly access: Access = (tx, s, actor) =>
      operationsAccess(tx, s, actor, "CONFIGURE"),
  ) {}
  private async row(
    tx: Tx,
    s: Scope,
    event: Pick<
      AutomationEventRow,
      "source" | "event_id" | "flow_id" | "revision"
    >,
  ) {
    return (
      await sql<AutomationEventRow>`SELECT * FROM automation_event_inbox WHERE ${tenant(s)} AND source=${event.source} AND event_id=${event.event_id} AND flow_id=${event.flow_id} AND revision=${event.revision} FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
  }
  async dispatch(event: AutomationEventRow) {
    const s = {
      organizationId: event.organization_id,
      guildId: event.guild_id,
    };
    const initial = (
      await sql<EventFlowRow>`SELECT * FROM automation_flows WHERE ${tenant(s)} AND id=${event.flow_id}`.execute(
        this.db,
      )
    ).rows[0];
    if (event.state !== "PENDING")
      return { state: event.state, id: event.run_id };
    let authorization: Awaited<ReturnType<EventAuthorizer>> | undefined;
    try {
      const identity =
        event.source === "INTERACTION"
          ? { hash: event.actor_hash, ciphertext: event.actor_ciphertext }
          : {
              hash: initial?.activator_hash,
              ciphertext: initial?.activator_ciphertext,
            };
      assert(
        identity.hash && identity.ciphertext,
        "AUTOMATION_ACTOR_UNAVAILABLE",
        403,
      );
      authorization = await this.authorize(
        s,
        { hash: identity.hash, ciphertext: identity.ciphertext },
        event.event_id,
      );
      assert(
        authorization.actor.key === identity.hash &&
          authorization.actor.encryptedUserId,
        "AUTOMATION_ACTOR_UNAVAILABLE",
        403,
      );
    } catch {
      return this.skip(s, event, "AUTHORIZATION_UNAVAILABLE");
    }
    try {
      return await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await betaAccess(tx, s, "work", event.beta_generation);
        await automationLock(tx, s);
        const current = await this.row(tx, s, event);
        if (!current) return { state: "REMOVED" };
        if (current.state !== "PENDING")
          return { state: current.state, id: current.run_id };
        const now = this.now();
        assert(
          now.getTime() - authorization.checkedAt >= 0 &&
            now.getTime() - authorization.checkedAt <= 10000,
          "AUTHORIZATION_EXPIRED",
          403,
        );
        await this.access(tx, s, authorization.actor);
        assert(
          current.deadline_at > now &&
            current.occurred_at.getTime() <= now.getTime() + 5000,
          "AUTOMATION_EVENT_EXPIRED",
          409,
        );
        assert(
          (await new SettingsService(tx).get(s)).enabled,
          "AUTOMATION_STOPPED",
          409,
        );
        const flow = (
          await sql<EventFlowRow>`SELECT * FROM automation_flows WHERE ${tenant(s)} AND id=${current.flow_id}`.execute(
            tx,
          )
        ).rows[0];
        assert(
          flow?.state === "ACTIVE" &&
            flow.active_revision === current.revision &&
            flow.generation === current.generation,
          "AUTOMATION_EVENT_STALE",
          409,
        );
        if (current.source === "INTERNAL")
          assert(
            flow.activator_hash === authorization.actor.key,
            "AUTOMATION_EVENT_STALE",
            409,
          );
        await betaAccess(tx, s, "work", flow.beta_generation);
        const revision = (
          await sql<{
            revision: number;
            definition: FlowDefinition;
            semantic_hash: string;
            complete: boolean;
          }>`SELECT * FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${flow.id} AND revision=${current.revision}`.execute(
            tx,
          )
        ).rows[0];
        assert(revision, "AUTOMATION_EVENT_STALE", 409);
        const checked = validateFlowDefinition(revision.definition, {...await scratchNumericOptions(revision.definition),temporalResolution:'fixed'});
        assert(checked.plan, "AUTOMATION_DEFINITION_INVALID");
        this.service.requireCapabilities(checked.plan);
        // MemberRef is derived from the freshly verified current identity by the
        // production authorizer. It is never inferred from the flow enabler.
        const values = automationEventValues(
          revision.definition,
          current,
          s.guildId,
          authorization.userId,
        );
        const run = await this.service.acceptRun(
          tx,
          s,
          {
            ...flow,
            activator_hash: authorization.actor.key,
            activator_ciphertext: authorization.actor.encryptedUserId!,
          },
          revision,
          `event:${current.source}:${current.event_id}:${flow.id}:${current.revision}`,
          values,
        );
        await sql`UPDATE automation_event_inbox SET state='STARTED',run_id=${run.id}::uuid,finished_at=${now},ticket_id=NULL,ticket_state=NULL,ticket_version=NULL,channel_id=NULL,actor_ciphertext=NULL WHERE ${tenant(s)} AND source=${current.source} AND event_id=${current.event_id} AND flow_id=${flow.id} AND revision=${current.revision}`.execute(
          tx,
        );
        return { state: "STARTED", id: run.id };
      });
    } catch (error) {
      if (!isDomainError(error)) throw error;
      return this.skip(s, event, error.code);
    }
  }
  private async skip(s: Scope, event: AutomationEventRow, reason: string) {
    return this.db.transaction().execute(async (tx) => {
      const row = await this.row(tx, s, event);
      if (!row) return { state: "REMOVED" };
      if (row.state !== "PENDING") return { state: row.state, id: row.run_id };
      await sql`UPDATE automation_event_inbox SET state='SKIPPED',reason=${reason},finished_at=${this.now()},ticket_id=NULL,ticket_state=NULL,ticket_version=NULL,channel_id=NULL,actor_ciphertext=NULL WHERE ${tenant(s)} AND source=${row.source} AND event_id=${row.event_id} AND flow_id=${row.flow_id} AND revision=${row.revision}`.execute(
        tx,
      );
      return { state: "SKIPPED", reason };
    });
  }
}

export async function sweepAutomationEventRetention(
  db: Database,
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - 7 * 86400000);
  const events =
    await sql`DELETE FROM automation_event_inbox WHERE created_at<=${cutoff} RETURNING event_id`.execute(
      db,
    );
  const instances =
    await sql`DELETE FROM automation_interaction_instances WHERE expires_at<=${now} RETURNING id`.execute(
      db,
    );
  await sql`DELETE FROM component_tokens WHERE expires_at<=${now} AND intent->>'action'='automationTrigger'`.execute(
    db,
  );
  return {
    deletedEvents: events.rows.length,
    deletedInstances: instances.rows.length,
  };
}
export async function purgeAutomationEventActor(
  tx: Tx,
  s: Scope,
  actorHash: string,
) {
  await sql`DELETE FROM component_tokens WHERE ${tenant(s)} AND actor_hash=${actorHash} AND intent->>'action'='automationTrigger'`.execute(
    tx,
  );
  await sql`DELETE FROM automation_interaction_instances WHERE ${tenant(s)} AND actor_hash=${actorHash}`.execute(
    tx,
  );
  await sql`DELETE FROM automation_event_inbox WHERE ${tenant(s)} AND actor_hash=${actorHash}`.execute(
    tx,
  );
}
