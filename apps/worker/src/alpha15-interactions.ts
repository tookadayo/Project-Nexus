import { randomUUID } from "node:crypto";
import {
  ButtonStyle,
  ComponentType,
  type APIButtonComponentWithCustomId,
} from "discord-api-types/v10";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
} from "../../../packages/db/src/index";
import { assert, type Scope } from "../../../packages/shared/src/index";
import type { IdentityVault } from "../../../packages/identity/src/index";
import { Components } from "../../../packages/security/src/index";
import { betaAccess } from "../../../packages/security/src/hosted-beta";
import { operationsAccess } from "../../../packages/operations/src/policy";
import type { GuildAuthorizationSnapshot } from "../../../packages/security/src/server-authorization";
import { SettingsService } from "../../../packages/settings/src/index";
import {
  AutomationService,
  type AutomationServiceOptions,
} from "../../../packages/automation/src/service";
import { validateFlowDefinition } from "../../../packages/automation/src/definition";
import {
  ALPHA15_ADOPTED_ACTIONS,
  ALPHA15_BETA_ADMISSION,
} from "../../../packages/automation/src/admission";
import { automationLock } from "../../../packages/automation/src/quota";
import { validateEventTriggerInputs } from "../../../packages/automation/src/event-contract";
import type {
  AutomationEventRow,
  EventFlowRow,
} from "../../../packages/automation/src/events";
import type { FlowDefinition } from "../../../packages/automation/src/types";
import {
  nexusPanel,
  callout,
  divider,
  escapeUserText,
  type ActionRow,
  type Panel,
  type UiLocale,
} from "../../../packages/discord-panels/src/index";
import type { InteractionJob } from "../../interaction/src/server";

const snowflake = /^\d{17,20}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Accepts an ID into the encrypted job table, never an HTTP/browser event
 * object. The existing Discord edge checked signature/application/guild first,
 * acknowledged immediately, then atomically saved its receipt and diagnostic. */
export async function trustedAutomationInteraction(
  db: Database,
  s: Scope,
  id: string,
  vault: IdentityVault,
  now = new Date(),
) {
  assert(snowflake.test(id), "AUTOMATION_INTERACTION_INVALID", 403);
  const row = (
    await sql<{
      encrypted_payload: string;
      received_at: Date;
      acknowledged_at: Date;
    }>`SELECT j.encrypted_payload,d.received_at,d.acknowledged_at FROM interaction_jobs j JOIN interaction_diagnostics d ON d.organization_id=j.organization_id AND d.guild_id=j.guild_id AND d.interaction_hash=${vault.hash(s, id)} WHERE j.organization_id=${s.organizationId}::uuid AND j.guild_id=${s.guildId} AND j.id=${id}`.execute(
      db,
    )
  ).rows[0];
  assert(row, "AUTOMATION_DISCORD_PROOF_REQUIRED", 403);
  const job = JSON.parse(
      vault.open(s, row.encrypted_payload),
    ) as InteractionJob,
    proof = job.discordProof;
  assert(
    job.id === id &&
      proof &&
      ["SIGNED_HTTP", "AUTHENTICATED_GATEWAY"].includes(proof.transport) &&
      proof.guildId === s.guildId,
    "AUTOMATION_DISCORD_PROOF_REQUIRED",
    403,
  );
  assert(
    snowflake.test(job.userId) &&
      snowflake.test(job.applicationId) &&
      job.channelId &&
      snowflake.test(job.channelId) &&
      job.customId &&
      !job.command &&
      !job.fields &&
      !job.values?.length,
    "AUTOMATION_INTERACTION_INVALID",
    403,
  );
  const received = Date.parse(proof.receivedAt),
    acknowledged = Date.parse(proof.acknowledgedAt),
    created = Number((BigInt(id) >> 22n) + 1420070400000n);
  assert(
    Number.isFinite(received) &&
      Number.isFinite(acknowledged) &&
      row.received_at.getTime() === received &&
      row.acknowledged_at.getTime() === acknowledged,
    "AUTOMATION_DISCORD_PROOF_REQUIRED",
    403,
  );
  assert(
    received >= created - 5000 &&
      acknowledged >= received &&
      acknowledged <= created + 3000 &&
      acknowledged - received <= 3000 &&
      now.getTime() >= received &&
      now.getTime() - received < 15 * 60000,
    "AUTOMATION_INTERACTION_EXPIRED",
    409,
  );
  return job;
}

/** Explicit button operations only. This helper cannot send a public message or
 * enable a flow. The caller returns the panel via its existing private reply. */
export async function alpha15AutomationInteraction(
  db: Database,
  s: Scope,
  input: InteractionJob,
  intent: Record<string, unknown>,
  authorization: GuildAuthorizationSnapshot,
  tokens: Components,
  vault: IdentityVault,
  locale: UiLocale,
  options: AutomationServiceOptions = {
    admission: ALPHA15_BETA_ADMISSION,
    adoptedActions: ALPHA15_ADOPTED_ACTIONS,
  },
): Promise<Panel> {
  const action = String(intent.action),
    ja = locale === "ja";
  assert(
    action === "automationMenu" || action === "automationTrigger",
    "AUTOMATION_INTERACTION_INVALID",
  );
  const service = new AutomationService(db, options),
    now = new Date();
  assert(
    !authorization.member.bot &&
      authorization.userId === input.userId &&
      now.getTime() - authorization.checkedAt >= 0 &&
      now.getTime() - authorization.checkedAt <= 10000,
    "AUTHORIZATION_EXPIRED",
    403,
  );
  if (action === "automationMenu") {
    assert(
      input.channelId && snowflake.test(input.channelId),
      "CHANNEL_REQUIRED",
    );
    const buttons = await db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, authorization.actor, "CONFIGURE");
      await automationLock(tx, s);
      assert(
        (await new SettingsService(tx).get(s)).enabled,
        "AUTOMATION_STOPPED",
        409,
      );
      const flows = (
        await sql<
          EventFlowRow & { definition: FlowDefinition }
        >`SELECT f.*,r.definition FROM automation_flows f JOIN automation_revisions r ON r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.flow_id=f.id AND r.revision=f.active_revision WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.state='ACTIVE' AND r.definition->'trigger'->>'kind'='interaction' ORDER BY f.name,f.id LIMIT 20`.execute(
          tx,
        )
      ).rows;
      const result: APIButtonComponentWithCustomId[] = [];
      // Reopening a menu supersedes unused buttons for this person, bounding
      // temporary storage without disturbing already accepted operations.
      await sql`DELETE FROM component_tokens c WHERE c.organization_id=${s.organizationId}::uuid AND c.guild_id=${s.guildId} AND c.actor_hash=${authorization.actor.key} AND c.intent->>'action'='automationTrigger' AND EXISTS(SELECT 1 FROM automation_interaction_instances i WHERE i.organization_id=c.organization_id AND i.guild_id=c.guild_id AND i.id::text=c.intent->>'instanceId' AND i.interaction_id IS NULL)`.execute(
        tx,
      );
      await sql`DELETE FROM automation_interaction_instances WHERE ${tenant(s)} AND actor_hash=${authorization.actor.key} AND interaction_id IS NULL`.execute(
        tx,
      );
      const stored = (
        await sql<{
          guild: number;
          host: number;
        }>`SELECT count(*) FILTER(WHERE ${tenant(s)})::integer AS guild,count(*)::integer AS host FROM automation_interaction_instances`.execute(
          tx,
        )
      ).rows[0]!;
      assert(
        stored.guild + flows.length <= 1000 &&
          stored.host + flows.length <= 10000,
        "AUTOMATION_EVENT_STORAGE_LIMIT",
        429,
      );
      for (const flow of flows) {
        assert(
          validateEventTriggerInputs(flow.definition.trigger),
          "AUTOMATION_EVENT_INPUT_INVALID",
        );
        const checked = validateFlowDefinition(flow.definition);
        assert(checked.plan, "AUTOMATION_DEFINITION_INVALID");
        service.requireCapabilities(checked.plan);
        const instanceId = randomUUID();
        const instance = (
          await sql<{
            expires_at: Date;
          }>`INSERT INTO automation_interaction_instances(organization_id,guild_id,id,flow_id,revision,generation,actor_hash,channel_id,application_id,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${instanceId}::uuid,${flow.id},${flow.active_revision},${flow.generation},${authorization.actor.key},${input.channelId!},${input.applicationId},now()+interval '15 minutes') RETURNING expires_at`.execute(
            tx,
          )
        ).rows[0]!;
        const customId = await tokens.issue(
          tx,
          s,
          {
            action: "automationTrigger",
            instanceId,
            flowId: flow.id,
            revision: flow.active_revision,
            generation: flow.generation,
            deadline: instance.expires_at.toISOString(),
          },
          authorization.actor.key,
          900,
        );
        result.push({
          type: ComponentType.Button,
          style:
            result.length % 5 === 0
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary,
          label: flow.name.slice(0, 75),
          custom_id: customId,
        });
      }
      return result;
    });
    const rows: ActionRow[] = [];
    for (let i = 0; i < buttons.length; i += 5)
      rows.push({
        type: ComponentType.ActionRow,
        components: buttons.slice(i, i + 5),
      });
    return nexusPanel({
      title: ja ? "オートメーション" : "Automations",
      children: [
        divider(),
        callout(
          ja ? "開始する処理を選ぶ" : "Choose a flow to start",
          buttons.length
            ? ja
              ? "このボタンはあなた専用です。有効期限は15分で、1回だけ使えます。クリック後の状態は Web の実行記録で確認できます。"
              : "These buttons belong to you, expire in 15 minutes and can be used once. Check the Web run history after starting."
            : ja
              ? "Discord 操作で開始する有効な処理はまだありません。Web で作成・確認してから有効にしてください。"
              : "There are no active Discord button flows. Create, review and enable a flow on the Web.",
        ),
      ],
      rows,
    });
  }
  const trusted = await trustedAutomationInteraction(
    db,
    s,
    input.id,
    vault,
    now,
  );
  assert(
    trusted.userId === authorization.userId &&
      trusted.customId === input.customId,
    "AUTOMATION_DISCORD_PROOF_REQUIRED",
    403,
  );
  const actualIntent = await tokens.read(
    db,
    s,
    trusted.customId!,
    authorization.actor.key,
  );
  assert(
    actualIntent.action === "automationTrigger" &&
      typeof actualIntent.instanceId === "string" &&
      uuid.test(actualIntent.instanceId),
    "AUTOMATION_INTERACTION_INVALID",
    403,
  );
  const accepted = await db.transaction().execute(async (tx) => {
    await privacyReadLock(tx, s);
    const invitation = await betaAccess(
      tx,
      s,
      "work",
      trusted.betaGeneration ?? null,
    );
    await automationLock(tx, s);
    await operationsAccess(tx, s, authorization.actor, "CONFIGURE");
    assert(
      (await new SettingsService(tx).get(s)).enabled,
      "AUTOMATION_STOPPED",
      409,
    );
    const instance = (
      await sql<{
        flow_id: string;
        revision: number;
        generation: number;
        actor_hash: string;
        channel_id: string;
        application_id: string;
        expires_at: Date;
        interaction_id: string | null;
      }>`SELECT * FROM automation_interaction_instances WHERE ${tenant(s)} AND id=${String(actualIntent.instanceId)}::uuid FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    assert(
      instance &&
        instance.actor_hash === authorization.actor.key &&
        instance.channel_id === trusted.channelId &&
        instance.application_id === trusted.applicationId,
      "AUTOMATION_INSTANCE_INVALID",
      403,
    );
    assert(
      instance.flow_id === actualIntent.flowId &&
        instance.revision === actualIntent.revision &&
        instance.generation === actualIntent.generation &&
        instance.expires_at.toISOString() === actualIntent.deadline,
      "AUTOMATION_INSTANCE_INVALID",
      403,
    );
    const prior = (
      await sql<AutomationEventRow>`SELECT * FROM automation_event_inbox WHERE ${tenant(s)} AND source='INTERACTION' AND event_id=${trusted.id} AND flow_id=${instance.flow_id} AND revision=${instance.revision}`.execute(
        tx,
      )
    ).rows[0];
    if (prior) return prior;
    const counts = (
      await sql<{
        guild: number;
        host: number;
        pending_guild: number;
        pending_host: number;
      }>`SELECT count(*) FILTER(WHERE ${tenant(s)})::integer AS guild,count(*)::integer AS host,count(*) FILTER(WHERE ${tenant(s)} AND state='PENDING')::integer AS pending_guild,count(*) FILTER(WHERE state='PENDING')::integer AS pending_host FROM automation_event_inbox`.execute(
        tx,
      )
    ).rows[0]!;
    assert(
      counts.guild < 1000 && counts.host < 10000,
      "AUTOMATION_EVENT_STORAGE_LIMIT",
      429,
    );
    assert(
      counts.pending_guild < 20 && counts.pending_host < 100,
      "AUTOMATION_EVENT_PENDING_LIMIT",
      429,
    );
    assert(instance.expires_at > now, "AUTOMATION_INTERACTION_EXPIRED", 409);
    assert(
      !instance.interaction_id || instance.interaction_id === trusted.id,
      "AUTOMATION_INSTANCE_USED",
      409,
    );
    const flow = (
      await sql<
        EventFlowRow & { definition: FlowDefinition }
      >`SELECT f.*,r.definition FROM automation_flows f JOIN automation_revisions r ON r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.flow_id=f.id AND r.revision=f.active_revision WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.id=${instance.flow_id}`.execute(
        tx,
      )
    ).rows[0];
    assert(
      flow?.state === "ACTIVE" &&
        flow.active_revision === instance.revision &&
        flow.generation === instance.generation &&
        flow.definition.trigger.kind === "interaction" &&
        validateEventTriggerInputs(flow.definition.trigger),
      "AUTOMATION_EVENT_STALE",
      409,
    );
    await betaAccess(tx, s, "work", flow.beta_generation);
    await sql`UPDATE automation_interaction_instances SET interaction_id=${trusted.id} WHERE ${tenant(s)} AND id=${String(actualIntent.instanceId)}::uuid`.execute(
      tx,
    );
    return (
      await sql<AutomationEventRow>`INSERT INTO automation_event_inbox(organization_id,guild_id,source,event_id,flow_id,revision,generation,kind,channel_id,actor_hash,actor_ciphertext,beta_generation,occurred_at,deadline_at) VALUES(${s.organizationId}::uuid,${s.guildId},'INTERACTION',${trusted.id},${instance.flow_id},${instance.revision},${instance.generation},'interaction',${trusted.channelId!},${authorization.actor.key},${authorization.actor.encryptedUserId!},${invitation?.generation ?? null},${new Date(trusted.discordProof!.receivedAt)},${new Date(Date.parse(trusted.discordProof!.receivedAt) + 15 * 60000)}) RETURNING *`.execute(
        tx,
      )
    ).rows[0]!;
  });
  const title = ja ? "処理を受け付けました" : "Flow accepted";
  return nexusPanel({
    title,
    children: [
      divider(),
      callout(
        title,
        ja
          ? `受付番号: ${escapeUserText(accepted.event_id)}\n状態: ${accepted.state === "SKIPPED" ? "開始されませんでした" : accepted.state === "STARTED" ? "開始済み" : "開始前の確認待ち"}。Web の実行記録で結果を確認してください。`
          : `Reference: ${escapeUserText(accepted.event_id)}\nState: ${accepted.state === "SKIPPED" ? "not started" : accepted.state === "STARTED" ? "started" : "awaiting admission checks"}. Check the Web run history for the result.`,
      ),
    ],
  });
}
