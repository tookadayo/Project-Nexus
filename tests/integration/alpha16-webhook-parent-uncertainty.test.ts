import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ActionWorker } from "../../apps/worker/src/actions";
import { PlaybookWorker } from "../../apps/worker/src/playbooks";
import { ReportWorker } from "../../apps/worker/src/reports";
import { ExploreService } from "../../packages/analytics/src/explore";
import { chartQuerySchema } from "../../packages/analytics/src/chart-spec";
import { connect, ensureGuild, json, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import type { DiscordPort } from "../../packages/discord/src/rest";
import { IdentityVault } from "../../packages/identity/src/index";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { InterventionReview } from "../../packages/operations/src/intervention-review";
import { playbookDefinition } from "../../packages/operations/src/playbooks";
import { WebhookWorker } from "../../packages/operations/src/webhooks";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { SettingsService } from "../../packages/settings/src/index";
import type { Scope } from "../../packages/shared/src/index";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const vault = new IdentityVault("ab".repeat(32), "bc".repeat(32));

beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});

afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});

async function fixture(kind: "PLAYBOOK" | "REPORT") {
  const s = scopeForGuild(String(989610000000000003n + BigInt(++serial)));
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status)
    VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH','active')`.execute(db);
  const now = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db)).rows[0]!.now;
  const at = (offset: number) => new Date(now.getTime() + offset);
  const endpointId = randomUUID(), eventId = randomUUID(), deliveryId = randomUUID(), destinationId = randomUUID();
  const actorHash = "ac".repeat(32);
  const eventType = kind === "PLAYBOOK" ? "playbook.executed" : "aggregate.export";
  // Existing canonical UNKNOWN data, without adopting any runtime profile or
  // creating a provider. All references and stored data are synthetic.
  await sql`INSERT INTO webhook_endpoints(organization_id,guild_id,id,name,url,event_types,state,actor_hash,
      created_at,delivery_gate,safety_epoch,safety_expires_at,safety_policy_revision)
    VALUES(${s.organizationId}::uuid,${s.guildId},${endpointId}::uuid,'Uncertain synthetic endpoint',
      'https://example.com/synthetic-parent-uncertainty',ARRAY[${eventType}],'ENABLED',${actorHash},
      ${at(-9_000)},'UNKNOWN_BLOCKED',1,${at(120_000)},'fixture-original-target')`.execute(db);
  await sql`INSERT INTO webhook_secrets(organization_id,guild_id,endpoint_id,version,secret_ciphertext)
    VALUES(${s.organizationId}::uuid,${s.guildId},${endpointId}::uuid,1,'synthetic-unused-ciphertext')`.execute(db);
  await sql`INSERT INTO operations_domain_events(organization_id,guild_id,id,event_type,dedupe_key,data,created_at,expanded_at)
    VALUES(${s.organizationId}::uuid,${s.guildId},${eventId}::uuid,${eventType},'synthetic-uncertain-parent',
      '{"synthetic":true}'::jsonb,${at(-8_000)},${at(-7_000)})`.execute(db);
  await sql`INSERT INTO webhook_deliveries(organization_id,guild_id,id,endpoint_id,event_id,secret_version,
      state,attempts,available_at,endpoint_revision,endpoint_safety_epoch,send_admitted_at,request_deadline_at,
      completed_at,last_error)
    VALUES(${s.organizationId}::uuid,${s.guildId},${deliveryId}::uuid,${endpointId}::uuid,${eventId}::uuid,1,
      'UNKNOWN',1,${at(-5_000)},1,1,${at(-2_000)},${at(-1_000)},${at(-1_000)},'TIMEOUT')`.execute(db);
  await sql`INSERT INTO integration_destinations(organization_id,guild_id,id,name,kind,endpoint_id)
    VALUES(${s.organizationId}::uuid,${s.guildId},${destinationId}::uuid,'Original webhook destination','WEBHOOK',${endpointId}::uuid)`.execute(db);
  return { s, now, at, actorHash, endpointId, eventId, deliveryId, destinationId };
}

async function sourceSnapshot(s: Scope) {
  return (await sql`SELECT d.id,d.state,d.attempts,d.available_at::text,d.send_admitted_at::text,
      d.request_deadline_at::text,d.completed_at::text,d.lease_until::text,d.lease_token::text,d.last_error,
      e.created_at::text AS event_created_at,e.expanded_at::text AS event_expanded_at,
      p.state AS endpoint_state,p.delivery_gate,p.safety_epoch::text,p.safety_expires_at::text,p.safety_policy_revision
    FROM webhook_deliveries d
    JOIN operations_domain_events e ON e.organization_id=d.organization_id AND e.guild_id=d.guild_id AND e.id=d.event_id
    JOIN webhook_endpoints p ON p.organization_id=d.organization_id AND p.guild_id=d.guild_id AND p.id=d.endpoint_id
    WHERE d.organization_id=${s.organizationId}::uuid AND d.guild_id=${s.guildId}`.execute(db)).rows;
}

async function counts(s: Scope) {
  return (await sql`SELECT
    (SELECT count(*)::int FROM action_outbox WHERE ${tenant(s)}) AS actions,
    (SELECT count(*)::int FROM webhook_deliveries WHERE ${tenant(s)}) AS deliveries,
    (SELECT count(*)::int FROM operations_domain_events WHERE ${tenant(s)}) AS events,
    (SELECT count(*)::int FROM playbook_executions WHERE ${tenant(s)}) AS executions,
    (SELECT count(*)::int FROM playbook_action_runs WHERE ${tenant(s)}) AS playbook_runs,
    (SELECT count(*)::int FROM report_runs WHERE ${tenant(s)}) AS reports,
    (SELECT count(*)::int FROM operations_interventions WHERE ${tenant(s)}) AS interventions`.execute(db)).rows[0]!;
}

function forbidAdditionalWork(s: Scope) {
  const chart = vi.spyOn(ExploreService.prototype, "chart").mockImplementation(async () => { throw new Error("Unexpected new analysis"); });
  const intervention = vi.spyOn(InterventionReview.prototype, "create").mockImplementation(async () => { throw new Error("Unexpected new intervention"); });
  const discordAccess = vi.fn(() => { throw new Error("Unexpected Discord access"); });
  const discord = new Proxy({}, { get: discordAccess }) as DiscordPort;
  const transport = vi.fn(async () => { throw new Error("Unexpected webhook resend"); });
  const actions = new ActionWorker(db, vault, discord, new OnboardingService(db, new SettingsService(db), vault));
  return {
    async assertIdleDispatch() {
      expect(await actions.tick(s)).toBe(false);
      expect(await new WebhookWorker(db, vault, transport).tick(s)).toBe(false);
      expect(discordAccess).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
      expect(chart).not.toHaveBeenCalled();
      expect(intervention).not.toHaveBeenCalled();
    },
    restore() { chart.mockRestore(); intervention.mockRestore(); },
  };
}

it("propagates webhook UNKNOWN to the queued playbook action and execution without creating more work", async () => {
  const f = await fixture("PLAYBOOK"), playbookId = randomUUID(), revisionId = randomUUID(), executionId = randomUUID(), actionId = randomUUID();
  const definition = playbookDefinition.parse({
    trigger: { kind: "ATTENTION", type: "OPERATIONS_REQUEST" }, destinations: [f.destinationId],
    measurement: { query: { metric: "reply" } },
  });
  // The original configuration has been archived. Historical queue outcomes
  // still need synchronizing, while a new evaluation cannot be started.
  await sql`INSERT INTO playbooks(organization_id,guild_id,id,name,state,creator_hash)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${playbookId}::uuid,'Archived original','ARCHIVED',${f.actorHash})`.execute(db);
  await sql`INSERT INTO playbook_revisions(organization_id,guild_id,id,playbook_id,revision,definition,actor_hash,created_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${revisionId}::uuid,${playbookId}::uuid,1,${json(definition)},${f.actorHash},${f.at(-6_000)})`.execute(db);
  await sql`UPDATE playbooks SET head_id=${revisionId}::uuid WHERE ${tenant(f.s)} AND id=${playbookId}::uuid`.execute(db);
  await sql`INSERT INTO playbook_executions(organization_id,guild_id,id,playbook_id,revision_id,dedupe_key,state,evidence,created_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${executionId}::uuid,${playbookId}::uuid,${revisionId}::uuid,
      'original-queued-execution','QUEUED','{"metric":null}'::jsonb,${f.at(-4_000)})`.execute(db);
  await sql`INSERT INTO playbook_action_runs(organization_id,guild_id,id,execution_id,destination_id,step,state,due_at,delivery_id)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${actionId}::uuid,${executionId}::uuid,${f.destinationId}::uuid,
      'ACTION','QUEUED',${f.at(-3_000)},${f.deliveryId}::uuid)`.execute(db);
  const parentSnapshot = async () => (await sql<{ action_state: string; execution_state: string }>`SELECT
      a.state AS action_state,e.state AS execution_state,a.due_at::text,a.delivery_id,a.action_id,
      e.created_at::text,e.revision_id,p.state AS playbook_state,p.last_evaluated_at::text
    FROM playbook_action_runs a JOIN playbook_executions e
      ON e.organization_id=a.organization_id AND e.guild_id=a.guild_id AND e.id=a.execution_id
    JOIN playbooks p ON p.organization_id=e.organization_id AND p.guild_id=e.guild_id AND p.id=e.playbook_id
    WHERE a.organization_id=${f.s.organizationId}::uuid AND a.guild_id=${f.s.guildId} AND a.id=${actionId}::uuid`.execute(db)).rows[0]!;
  const originalParent = await parentSnapshot(), originalSource = await sourceSnapshot(f.s), originalCounts = await counts(f.s);
  expect(originalParent).toMatchObject({ action_state: "QUEUED", execution_state: "QUEUED" });
  expect(originalSource).toHaveLength(1);
  expect(originalSource[0]).toMatchObject({ state: "UNKNOWN", attempts: 1, delivery_gate: "UNKNOWN_BLOCKED" });
  expect(originalCounts).toMatchObject({ actions: 0, deliveries: 1, events: 1, executions: 1, playbook_runs: 1, interventions: 0 });
  const blocked = forbidAdditionalWork(f.s);
  try {
    expect(await new PlaybookWorker(db).tick(f.s, f.now)).toBe(false);
    const result = await parentSnapshot();
    expect(result).toEqual({ ...originalParent, action_state: "UNKNOWN", execution_state: "UNKNOWN" });
    await blocked.assertIdleDispatch();
    expect(await sourceSnapshot(f.s)).toEqual(originalSource);
    expect(await counts(f.s)).toEqual(originalCounts);

    expect(await new PlaybookWorker(db).tick(f.s, f.at(1_000))).toBe(false);
    await blocked.assertIdleDispatch();
    expect(await parentSnapshot()).toEqual(result);
    expect(await sourceSnapshot(f.s)).toEqual(originalSource);
    expect(await counts(f.s)).toEqual(originalCounts);
  } finally { blocked.restore(); }
});

it("propagates webhook UNKNOWN to a queued scheduled report without extending its result expiry or firing its schedule", async () => {
  const f = await fixture("REPORT"), templateId = randomUUID(), scheduleId = randomUUID(), runId = randomUUID();
  const query = chartQuerySchema.parse({ metric: "reply" });
  await sql`INSERT INTO report_templates(organization_id,guild_id,id,title,queries,actor_hash)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${templateId}::uuid,'Original report',${json([query])},${f.actorHash})`.execute(db);
  // A disabled original schedule cannot fire or advance next_at. Its queued
  // historical delivery still needs an honest UNKNOWN result.
  await sql`INSERT INTO report_schedules(organization_id,guild_id,id,template_id,destination_id,cadence,timezone,day,hour,minute,next_at,state,format)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${scheduleId}::uuid,${templateId}::uuid,${f.destinationId}::uuid,
      'WEEKLY','UTC',1,10,0,${f.at(-60_000)},'DISABLED','WEBHOOK')`.execute(db);
  await sql`INSERT INTO report_runs(organization_id,guild_id,id,schedule_id,scheduled_at,state,schedule_revision,
      template_revision,delivery_id,run_kind,requested_at,result_expires_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${runId}::uuid,${scheduleId}::uuid,${f.at(-4_000)},'QUEUED',
      1,1,${f.deliveryId}::uuid,'SCHEDULED',${f.at(-5_000)},${f.at(3_600_000)})`.execute(db);
  const parentSnapshot = async () => (await sql<{ state: string }>`SELECT state,scheduled_at::text,requested_at::text,
      result_expires_at::text,completed_at::text,generated_at::text,generated_source_expires_at::text,
      lease_until::text,lease_token::text,delivery_id,action_id,state_version::text
    FROM report_runs WHERE ${tenant(f.s)} AND id=${runId}::uuid`.execute(db)).rows[0]!;
  const scheduleSnapshot = async () => (await sql`SELECT state,next_at::text,revision FROM report_schedules
    WHERE ${tenant(f.s)} AND id=${scheduleId}::uuid`.execute(db)).rows[0]!;
  const originalParent = await parentSnapshot(), originalSchedule = await scheduleSnapshot();
  const originalSource = await sourceSnapshot(f.s), originalCounts = await counts(f.s);
  expect(originalParent.state).toBe("QUEUED");
  expect(originalParent).toMatchObject({ result_expires_at: expect.any(String) });
  expect(originalSource).toHaveLength(1);
  expect(originalSource[0]).toMatchObject({ state: "UNKNOWN", attempts: 1, delivery_gate: "UNKNOWN_BLOCKED" });
  expect(originalCounts).toMatchObject({ actions: 0, deliveries: 1, events: 1, reports: 1, interventions: 0 });
  const blocked = forbidAdditionalWork(f.s);
  try {
    expect(await new ReportWorker(db).tick(f.s, f.now)).toBe(false);
    const result = await parentSnapshot();
    expect(result).toEqual({ ...originalParent, state: "UNKNOWN" });
    await blocked.assertIdleDispatch();
    expect(await sourceSnapshot(f.s)).toEqual(originalSource);
    expect(await scheduleSnapshot()).toEqual(originalSchedule);
    expect(await counts(f.s)).toEqual(originalCounts);

    expect(await new ReportWorker(db).tick(f.s, f.at(1_000))).toBe(false);
    await blocked.assertIdleDispatch();
    expect(await parentSnapshot()).toEqual(result);
    expect(await sourceSnapshot(f.s)).toEqual(originalSource);
    expect(await scheduleSnapshot()).toEqual(originalSchedule);
    expect(await counts(f.s)).toEqual(originalCounts);
  } finally { blocked.restore(); }
});
