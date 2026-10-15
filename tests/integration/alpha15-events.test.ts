import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  json,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { Components } from "../../packages/security/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { AutomationService } from "../../packages/automation/src/service";
import { AutomationRuntime } from "../../packages/automation/src/runtime";
import { AutomationScheduler } from "../../packages/automation/src/scheduler";
import { createAlpha15DiscordAdapter } from "../../apps/worker/src/alpha15-discord";
import type { AutomationDiscordWrite } from "../../packages/discord/src/rest";
import { mockSuccessfulActionOutcomes } from "../fixtures/alpha15-simulation";
import {
  purgeAutomationActor,
  fenceRestoredAutomations,
} from "../../packages/automation/src/retention";
import {
  AutomationEvents,
  sweepAutomationEventRetention,
  type AutomationEventRow,
} from "../../packages/automation/src/events";
import {
  INTERNAL_EVENT_FIELDS,
  INTERACTION_EVENT_FIELDS,
} from "../../packages/automation/src/event-contract";
import type {
  FlowDefinition,
  TriggerDefinition,
} from "../../packages/automation/src/types";
import {
  createInteractionServer,
  type InteractionJob,
} from "../../apps/interaction/src/server";
import {
  alpha15AutomationInteraction,
  trustedAutomationInteraction,
} from "../../apps/worker/src/alpha15-interactions";
import {
  alpha15EventAuthorizer,
  processAlpha15AutomationEvents,
} from "../../apps/worker/src/alpha15-events";
import { InteractionWorker } from "../../apps/worker/src/interactions";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { isolatedPostgres } from "../fixtures/postgres";
import { FakeDiscord } from "../fixtures/discord";

let db: Database,
  infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  serial = 0;
const vault = new IdentityVault("ab".repeat(32), "cd".repeat(32)),
  tokens = new Components("synthetic-components");
const user = "884111111111111111",
  other = "884222222222222222",
  channel = "884333333333333333",
  applicationId = "884444444444444444";
const policy = {
  activeFlows: 20,
  monthlyRuns: 100,
  guildConcurrent: 1,
  globalConcurrent: 2,
  guildPending: 20,
  globalPending: 200,
  measurementId: "isolated-events-synthetic",
};
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db, { throughVersion: 52 });
  for (const name of ["054_alpha15_automation", "057_alpha15_events", "059_alpha15_schedule_reviews"])
    await sql
      .raw(
        await readFile(
          new URL(`../../migrations/${name}.sql`, import.meta.url),
          "utf8",
        ),
      )
      .execute(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});
async function fixture(
  trigger: TriggerDefinition = {
    kind: "internal",
    event: "ticketCreated",
    inputs: [...INTERNAL_EVENT_FIELDS],
  },
  sendMessage = false,
  sameScope?: ReturnType<typeof scopeForGuild>,
) {
  const s =
    sameScope ?? scopeForGuild(String(886000000000000000n + BigInt(++serial)));
  if (sameScope) serial++;
  await ensureGuild(db, s);
  const discord = new FakeDiscord();
  for (const id of [user, other])
    discord.members.set(id, {
      permissions: "8",
      roles: [],
      bot: false,
      joinedAt: "2026-01-01T00:00:00Z",
    });
  const settings = new SettingsService(db),
    actor: Actor = {
      key: vault.hash(s, user),
      encryptedUserId: vault.seal(s, user),
      permissions: "8",
      roles: [],
      source: "DISCORD_PANEL",
      requestId: randomUUID(),
    };
  const definition: FlowDefinition = {
    schemaVersion: 1,
    id: "event-" + serial,
    name: "Synthetic event flow",
    guildId: s.guildId,
    trigger,
    targets: { channelIds: [channel], roleIds: [], parentCategoryIds: [] },
    variables: [],
    body: sendMessage
      ? [
          {
            kind: "action",
            id: "send",
            operation: "discord.sendMessage",
            inputs: {
              channel: {
                kind: "literal",
                type: "ChannelRef",
                value: { id: channel, guildId: s.guildId },
              },
              content: {
                kind: "literal",
                type: "PlainText",
                value: "Synthetic stop fixture",
              },
            },
          },
        ]
      : [{ kind: "end", id: "end" }],
  };
  const service = new AutomationService(db, {
    admission: policy,
    authorize: async () => {},
    adoptedActions: new Set(["discord.sendMessage"]),
  });
  const saved = await service.save(s, actor, {
    definition,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  expect(saved.validation.issues).toEqual([]);
  const mockValues = {
    "event.ticket": { id: "884555555555555555", guildId: s.guildId },
    "event.state": "OPEN",
    "event.version": 0,
    "event.occurredAt": new Date().toISOString(),
    "interaction.member": { id: other, guildId: s.guildId },
    "interaction.channel": { id: channel, guildId: s.guildId },
    "interaction.occurredAt": new Date().toISOString(),
  };
  const simulation={
      outcomes: mockSuccessfulActionOutcomes(definition),
      values: Object.fromEntries(
        ("inputs" in trigger ? trigger.inputs : []).map((field) => [
          field.id,
          {
            type: field.type,
            value: mockValues[field.id as keyof typeof mockValues],
          },
        ]),
      ),
    };
  for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const)
    await service.check(s, actor, definition.id, 1, kind, simulation);
  await service.enable(s, actor, definition.id, {
    revision: 1,
    semanticHash: saved.validation.semanticHash!,
    requestId: randomUUID(),
  });
  return {
    s,
    discord,
    settings,
    actor,
    definition,
    simulation,
    service,
    events: new AutomationEvents(
      db,
      service,
      alpha15EventAuthorizer(db, discord, vault),
    ),
  };
}
async function ticket(
  f: Awaited<ReturnType<typeof fixture>>,
  id = "intake:" + randomUUID(),
  rollback = false,
) {
  await db.transaction().execute(async (tx) => {
    const panelId = randomUUID();
    await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,state,actor_hash) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${panelId}::uuid,'Synthetic intake','support','PUBLISHED',${f.actor.key})`.execute(
      tx,
    );
    await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,evidence) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel},${id},now(),'OPEN','OPERATIONS_REQUEST',${json({ privateBody: "NEVER_COPY_THIS_BODY", profile: "NEVER_COPY_PROFILE" })})`.execute(
      tx,
    );
    // Same ordering as OperationsIntake.submit: attention/outbox precedes the
    // actual request record. Deferred capture runs only after both commit.
    expect(
      (
        await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(f.s)} AND ticket_id=${id}`.execute(
          tx,
        )
      ).rows,
    ).toEqual([]);
    await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${id.slice(7)}::uuid,${panelId}::uuid,${randomUUID()},${f.actor.key},'support',${vault.seal(f.s, JSON.stringify({ body: "NEVER_COPY_THIS_BODY" }))},${id})`.execute(
      tx,
    );
    if (rollback) throw new Error("SYNTHETIC_ROLLBACK");
  });
  return (
    await sql<AutomationEventRow>`SELECT * FROM automation_event_inbox WHERE ${tenant(f.s)} ORDER BY created_at`.execute(
      db,
    )
  ).rows;
}
function controls(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(controls);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [
    ...(typeof node.custom_id === "string" ? [node] : []),
    ...Object.values(node).flatMap(controls),
  ];
}
function snowflake() {
  return (
    ((BigInt(Date.now()) - 1420070400000n) << 22n) +
    BigInt(++serial)
  ).toString();
}
async function menu(f: Awaited<ReturnType<typeof fixture>>, as = other) {
  const snapshot = await new ServerAuthorization(
    f.discord,
    f.settings,
    vault,
  ).snapshot(f.s, as, "DISCORD_PANEL", randomUUID());
  const input = {
    id: snowflake(),
    applicationId,
    token: "synthetic-not-sent",
    userId: as,
    channelId: channel,
  } satisfies InteractionJob;
  const panel = await alpha15AutomationInteraction(
    db,
    f.s,
    input,
    { action: "automationMenu" },
    snapshot,
    tokens,
    vault,
    "en",
    { admission: policy, adoptedActions: new Set() },
  );
  return { snapshot, input, customId: String(controls(panel)[0]!.custom_id) };
}
async function saveTrusted(
  f: Awaited<ReturnType<typeof fixture>>,
  customId: string,
  as = other,
  changes: Partial<InteractionJob> = {},
) {
  const now = new Date(),
    id = snowflake();
  const job: InteractionJob = {
    id,
    applicationId,
    token: "synthetic-not-sent",
    userId: as,
    channelId: channel,
    customId,
    discordProof: {
      transport: "SIGNED_HTTP",
      guildId: f.s.guildId,
      receivedAt: now.toISOString(),
      acknowledgedAt: now.toISOString(),
    },
    ...changes,
  };
  await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${job.id},${vault.seal(f.s, JSON.stringify(job))})`.execute(
    db,
  );
  await sql`INSERT INTO interaction_diagnostics(organization_id,guild_id,interaction_hash,kind,action,received_at,acknowledged_at,result) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${vault.hash(f.s, job.id)},'component','automationTrigger',${new Date(job.discordProof?.receivedAt ?? now)},${new Date(job.discordProof?.acknowledgedAt ?? now)},'acknowledged')`.execute(
    db,
  );
  return job;
}
it("captures only fresh trusted source inserts and never copies evidence or depends on expanded_at", async () => {
  const f = await fixture();
  const [event] = await ticket(f);
  expect(event).toBeDefined();
  expect(JSON.stringify(event)).not.toContain("NEVER_COPY");
  await sql`UPDATE operations_domain_events SET expanded_at=now() WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const results = await Promise.all([
    f.events.dispatch(event!),
    f.events.dispatch(event!),
  ]);
  expect(results.every((value) => value.id === results[0]!.id)).toBe(true);
  const runs = (
    await sql<{
      actor_hash: string;
      resume: unknown;
    }>`SELECT actor_hash,resume FROM automation_runs WHERE ${tenant(f.s)}`.execute(
      db,
    )
  ).rows;
  expect(runs.length).toBe(1);
  expect(runs[0]!.actor_hash).toBe(f.actor.key);
  expect(JSON.stringify(runs)).not.toContain("NEVER_COPY");
  expect(
    (
      await sql`SELECT reserved FROM automation_usage_months WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0],
  ).toEqual({ reserved: 1 });
});
it("receives nonresolved and resolved updates once through the existing domain outbox", async () => {
  const f = await fixture({
    kind: "internal",
    event: "ticketUpdated",
    inputs: [],
  });
  await ticket(f);
  await sql`UPDATE attention_items SET status='ACKNOWLEDGED',version=version+1 WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await sql`UPDATE attention_items SET version=version+1 WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await sql`UPDATE attention_items SET status='RESOLVED',version=version+1 WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const events = (
    await sql<AutomationEventRow>`SELECT * FROM automation_event_inbox WHERE ${tenant(f.s)} ORDER BY ticket_version`.execute(
      db,
    )
  ).rows;
  expect(events.map((row) => [row.kind, row.ticket_state])).toEqual([
    ["ticketUpdated", "ACKNOWLEDGED"],
    ["ticketUpdated", "ACKNOWLEDGED"],
    ["ticketUpdated", "RESOLVED"],
  ]);
});
it("ignores ordinary attention, analytical concerns and claimed tickets without a real intake record", async () => {
  const f = await fixture();
  for (const [id, itemType] of [
    ["884999999999999999", "TEXT_NEWCOMER"],
    ["analysis:" + randomUUID() + ":waiting_response", "ANALYSIS_CONCERN"],
    ["intake:" + randomUUID(), "OPERATIONS_REQUEST"],
  ])
    await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel},${id!},now(),'OPEN',${itemType!})`.execute(
      db,
    );
  expect(
    (
      await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  expect(
    (await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toEqual([]);
  await expect(ticket(f, undefined, true)).rejects.toThrow(
    "SYNTHETIC_ROLLBACK",
  );
  expect(
    (
      await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});
it("fences old recipients after disable/re-enable and never catches up old events", async () => {
  const f = await fixture(),
    [event] = await ticket(f);
  await f.service.disable(f.s, f.actor, f.definition.id, randomUUID());
  await f.service.enable(f.s, f.actor, f.definition.id, {
    revision: 1,
    semanticHash: (await f.service.get(f.s, f.actor, f.definition.id))
      .validation.semanticHash!,
    requestId: randomUUID(),
  });
  expect(await f.events.dispatch(event!)).toMatchObject({
    state: "SKIPPED",
    reason: "AUTOMATION_EVENT_STALE",
  });
  expect(
    (await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toEqual([]);
});
it("freshly checks the enabler permission and makes a failed admission terminal", async () => {
  const f = await fixture(),
    [event] = await ticket(f);
  f.discord.members.get(user)!.permissions = "0";
  expect(await f.events.dispatch(event!)).toMatchObject({ state: "SKIPPED" });
  f.discord.members.get(user)!.permissions = "8";
  expect(await f.events.dispatch(event!)).toMatchObject({ state: "SKIPPED" });
  expect(
    (await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toEqual([]);
});
it("admits the actual Native button operator, reconciles duplicates and rejects double clicks", async () => {
  const f = await fixture({
      kind: "interaction",
      inputs: [...INTERACTION_EVENT_FIELDS],
    }),
    m = await menu(f),
    job = await saveTrusted(f, m.customId),
    intent = await tokens.read(db, f.s, m.customId, m.snapshot.actor.key);
  const accept = () =>
    alpha15AutomationInteraction(
      db,
      f.s,
      job,
      intent,
      m.snapshot,
      tokens,
      vault,
      "en",
      { admission: policy, adoptedActions: new Set() },
    );
  await accept();
  await accept();
  const [event] = (
    await sql<AutomationEventRow>`SELECT * FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
      db,
    )
  ).rows;
  expect(event!.actor_hash).toBe(vault.hash(f.s, other));
  expect(await f.events.dispatch(event!)).toMatchObject({ state: "STARTED" });
  expect(
    (
      await sql`SELECT actor_ciphertext,channel_id FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0],
  ).toEqual({ actor_ciphertext: null, channel_id: null });
  await accept();
  const run = (
    await sql<{
      actor_hash: string;
      resume: { variables: Record<string, { value: unknown }> };
    }>`SELECT actor_hash,resume FROM automation_runs WHERE ${tenant(f.s)}`.execute(
      db,
    )
  ).rows[0]!;
  expect(run.actor_hash).toBe(vault.hash(f.s, other));
  expect(run.resume.variables["interaction.member"]!.value).toEqual({
    id: other,
    guildId: f.s.guildId,
  });
  const again = await saveTrusted(f, m.customId);
  await expect(
    alpha15AutomationInteraction(
      db,
      f.s,
      again,
      intent,
      m.snapshot,
      tokens,
      vault,
      "en",
    ),
  ).rejects.toThrow("AUTOMATION_INSTANCE_USED");
});
it("rejects missing proof, mismatched channel, foreign actor and expired ACK before enqueue", async () => {
  const f = await fixture({ kind: "interaction", inputs: [] }),
    m = await menu(f),
    intent = await tokens.read(db, f.s, m.customId, m.snapshot.actor.key);
  const fake = { ...m.input, customId: m.customId };
  await expect(
    alpha15AutomationInteraction(
      db,
      f.s,
      fake,
      intent,
      m.snapshot,
      tokens,
      vault,
      "en",
    ),
  ).rejects.toThrow("AUTOMATION_DISCORD_PROOF_REQUIRED");
  const wrong = await saveTrusted(f, m.customId, other, {
    channelId: "884777777777777777",
  });
  await expect(
    alpha15AutomationInteraction(
      db,
      f.s,
      wrong,
      intent,
      m.snapshot,
      tokens,
      vault,
      "en",
    ),
  ).rejects.toThrow("AUTOMATION_INSTANCE_INVALID");
  const late = await saveTrusted(f, m.customId, other, {
    discordProof: {
      transport: "SIGNED_HTTP",
      guildId: f.s.guildId,
      receivedAt: new Date(Date.now() - 10000).toISOString(),
      acknowledgedAt: new Date().toISOString(),
    },
  });
  await expect(
    trustedAutomationInteraction(db, f.s, late.id, vault),
  ).rejects.toThrow("AUTOMATION_INTERACTION_EXPIRED");
  await expect(
    tokens.read(db, f.s, m.customId, vault.hash(f.s, user)),
  ).rejects.toThrow("COMPONENT_OWNER");
  const foreign = await saveTrusted(f, m.customId, other, {
    discordProof: {
      transport: "SIGNED_HTTP",
      guildId: "884000000000000000",
      receivedAt: new Date().toISOString(),
      acknowledgedAt: new Date().toISOString(),
    },
  });
  await expect(
    trustedAutomationInteraction(db, f.s, foreign.id, vault),
  ).rejects.toThrow("AUTOMATION_DISCORD_PROOF_REQUIRED");
  const stale = await saveTrusted(f, m.customId);
  await f.service.disable(f.s, f.actor, f.definition.id, randomUUID());
  await expect(
    alpha15AutomationInteraction(
      db,
      f.s,
      stale,
      intent,
      m.snapshot,
      tokens,
      vault,
      "en",
    ),
  ).rejects.toThrow("AUTOMATION_EVENT_STALE");
  expect(
    (
      await sql`SELECT * FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});
it("erases the actual operator receipt, encrypted identity, native instance and token without deleting the enabler flow", async () => {
  const f = await fixture({ kind: "interaction", inputs: [] }),
    m = await menu(f),
    job = await saveTrusted(f, m.customId),
    intent = await tokens.read(db, f.s, m.customId, m.snapshot.actor.key);
  await alpha15AutomationInteraction(
    db,
    f.s,
    job,
    intent,
    m.snapshot,
    tokens,
    vault,
    "en",
  );
  await db
    .transaction()
    .execute((tx) =>
      purgeAutomationActor(tx, f.s, vault.hash(f.s, other), other),
    );
  expect(
    (
      await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await sql`SELECT id FROM automation_interaction_instances WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await sql`SELECT id FROM component_tokens WHERE ${tenant(f.s)} AND intent->>'action'='automationTrigger'`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await sql`SELECT state FROM automation_flows WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ state: "ACTIVE" }]);
});
it("verifies real HTTP signatures, ACKs before durable jobs, then uses the existing worker bridge", async () => {
  const f = await fixture({ kind: "interaction", inputs: [] }),
    m = await menu(f),
    keys = generateKeyPairSync("ed25519"),
    publicKey = keys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
  let wake!: () => void;
  const committed = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const app = createInteractionServer({
    db,
    vault,
    components: tokens,
    publicKey,
    applicationId,
    wake: async () => {
      wake();
    },
  });
  const data = {
    id: snowflake(),
    application_id: applicationId,
    type: 3,
    token: "synthetic-discord-token",
    guild_id: f.s.guildId,
    channel_id: channel,
    member: { user: { id: other }, permissions: "0", roles: [] },
    data: { custom_id: m.customId },
    message: { id: "884666666666666666" },
  };
  const body = JSON.stringify(data),
    timestamp = String(Math.floor(Date.now() / 1000)),
    headers = {
      "content-type": "application/json",
      "x-signature-timestamp": timestamp,
      "x-signature-ed25519": sign(
        null,
        Buffer.from(timestamp + body),
        keys.privateKey,
      ).toString("hex"),
    };
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/interactions",
          payload: body,
          headers: { ...headers, "x-signature-ed25519": "0".repeat(128) },
        })
      ).statusCode,
    ).toBe(401);
    const ack = await app.inject({
      method: "POST",
      url: "/interactions",
      payload: body,
      headers,
    });
    expect(ack.json()).toEqual({ type: 5, data: { flags: 64 } });
    await committed;
    const job = await trustedAutomationInteraction(db, f.s, data.id, vault);
    expect(job.discordProof?.transport).toBe("SIGNED_HTTP");
    const worker = new InteractionWorker(
      db,
      vault,
      tokens,
      f.discord,
      f.settings,
      new OnboardingService(db, f.settings, vault),
      async () => {},
    );
    expect(await worker.tick(f.s)).toBe(true);
    expect(
      (
        await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
          db,
        )
      ).rows,
    ).toEqual([{ event_id: data.id }]);
  } finally {
    await app.close();
  }
});
it("fences restored pending events and native buttons, clears inputs, and cannot replay after explicit re-enable", async () => {
  const internal = await fixture(),
    [internalEvent] = await ticket(internal),
    interactive = await fixture({
      kind: "interaction",
      inputs: [...INTERACTION_EVENT_FIELDS],
    }),
    m = await menu(interactive),
    job = await saveTrusted(interactive, m.customId),
    intent = await tokens.read(
      db,
      interactive.s,
      m.customId,
      m.snapshot.actor.key,
    );
  await alpha15AutomationInteraction(
    db,
    interactive.s,
    job,
    intent,
    m.snapshot,
    tokens,
    vault,
    "en",
  );
  const unrelatedToken = await tokens.issue(
    db,
    interactive.s,
    { action: "overview" },
    interactive.actor.key,
  );
  const restoredAt = new Date();
  await db
    .transaction()
    .execute((tx) => fenceRestoredAutomations(tx, restoredAt));
  for (const s of [internal.s, interactive.s]) {
    const receipt = (
      await sql<
        AutomationEventRow & { finished_at: Date }
      >`SELECT * FROM automation_event_inbox WHERE ${tenant(s)}`.execute(db)
    ).rows[0]!;
    expect(receipt).toMatchObject({
      state: "SKIPPED",
      reason: "RESTORE_REVIEW_REQUIRED",
      ticket_id: null,
      ticket_state: null,
      ticket_version: null,
      channel_id: null,
      actor_ciphertext: null,
      run_id: null,
    });
    expect(receipt.finished_at.toISOString()).toBe(restoredAt.toISOString());
    expect(receipt.actor_hash).toBe(
      s.guildId === interactive.s.guildId ? vault.hash(s, other) : null,
    );
    expect(
      (
        await sql`SELECT id FROM automation_interaction_instances WHERE ${tenant(s)}`.execute(
          db,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await sql`SELECT id FROM component_tokens WHERE ${tenant(s)} AND intent->>'action'='automationTrigger'`.execute(
          db,
        )
      ).rows,
    ).toEqual([]);
  }
  expect(
    (
      await tokens.read(
        db,
        interactive.s,
        unrelatedToken,
        interactive.actor.key,
      )
    ).action,
  ).toBe("overview");
  for (const f of [internal, interactive]) {
    const activation={
      revision: 1,
      semanticHash: (await f.service.get(f.s, f.actor, f.definition.id))
        .validation.semanticHash!,
      requestId: randomUUID(),
    };
    await expect(f.service.enable(f.s,f.actor,f.definition.id,activation)).rejects.toThrow('AUTOMATION_REVIEW_REQUIRED');
    for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await f.service.check(f.s,f.actor,f.definition.id,1,kind,f.simulation);
    await f.service.enable(f.s,f.actor,f.definition.id,{...activation,requestId:randomUUID()});
  }
  expect(await internal.events.dispatch(internalEvent!)).toMatchObject({
    state: "SKIPPED",
  });
  await expect(
    alpha15AutomationInteraction(
      db,
      interactive.s,
      job,
      intent,
      m.snapshot,
      tokens,
      vault,
      "en",
    ),
  ).rejects.toThrow("COMPONENT_EXPIRED");
  for (const s of [internal.s, interactive.s])
    expect(
      (await sql`SELECT id FROM automation_runs WHERE ${tenant(s)}`.execute(db))
        .rows,
    ).toEqual([]);
  // Restored status still participates in actor erasure; retained hashes never
  // become a reason to retain the pending identity or the old native instance.
  await db
    .transaction()
    .execute((tx) =>
      purgeAutomationActor(
        tx,
        interactive.s,
        vault.hash(interactive.s, other),
        other,
      ),
    );
  expect(
    (
      await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(interactive.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});
it("preserves effective default-enabled settings and fails closed on malformed enabled JSON", async () => {
  const legacy = await fixture();
  await sql`INSERT INTO guild_settings(organization_id,guild_id,settings) VALUES(${legacy.s.organizationId}::uuid,${legacy.s.guildId},'{}'::jsonb)`.execute(
    db,
  );
  expect((await legacy.settings.get(legacy.s)).enabled).toBe(true);
  expect(await ticket(legacy)).toHaveLength(1);
  expect(
    (
      await sql`SELECT generation FROM automation_flows WHERE ${tenant(legacy.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ generation: 1 }]);
  for (const enabled of [null, "true"]) {
    const invalid = await fixture();
    await sql`INSERT INTO guild_settings(organization_id,guild_id,settings) VALUES(${invalid.s.organizationId}::uuid,${invalid.s.guildId},${json({ enabled })})`.execute(
      db,
    );
    expect(await ticket(invalid)).toEqual([]);
  }
});
it("fences a global stop and resume between worker passes while fresh explicit intake still runs", async () => {
  const internal = await fixture(undefined, true),
    [oldReceipt] = await ticket(internal);
  const manual = await fixture(
      { kind: "manual", inputs: [] },
      true,
      internal.s,
    ),
    interactive = await fixture(
      { kind: "interaction", inputs: [...INTERACTION_EVENT_FIELDS] },
      false,
      internal.s,
    ),
    m = await menu(interactive),
    job = await saveTrusted(interactive, m.customId),
    intent = await tokens.read(
      db,
      internal.s,
      m.customId,
      m.snapshot.actor.key,
    );
  await alpha15AutomationInteraction(
    db,
    internal.s,
    job,
    intent,
    m.snapshot,
    tokens,
    vault,
    "en",
  );
  const oldRun = await manual.service.start(
    internal.s,
    manual.actor,
    manual.definition.id,
    { requestId: randomUUID() },
  );
  await sql`INSERT INTO automation_operations(organization_id,guild_id,run_id,identity,operation,fingerprint,state,finished_at) VALUES(${internal.s.organizationId}::uuid,${internal.s.guildId},${oldRun.id}::uuid,'confirmed-before-stop','discord.sendMessage',${"a".repeat(64)},'SUCCEEDED',now())`.execute(
    db,
  );
  for (const [identity, state] of [
    ["pending-role", "PENDING"],
    ["approved-role", "APPROVED"],
  ])
    await sql`INSERT INTO automation_approvals(organization_id,guild_id,id,run_id,revision,identity,operation,fingerprint,inputs,state,expires_at) VALUES(${internal.s.organizationId}::uuid,${internal.s.guildId},${randomUUID()}::uuid,${oldRun.id}::uuid,1,${identity!},'discord.addRole',${"b".repeat(64)},'{}'::jsonb,${state!},now()+interval '1 hour')`.execute(
      db,
    );
  const before = (
    await sql<{
      id: string;
      generation: number;
    }>`SELECT id,generation FROM automation_flows WHERE ${tenant(internal.s)} ORDER BY id`.execute(
      db,
    )
  ).rows;
  // No worker pass occurs between these two settings mutations. The first
  // mutation also exercises the implicit-true -> first persisted false edge.
  const stopped = await internal.settings.update(
    internal.s,
    internal.actor,
    0,
    { enabled: false },
  );
  const disabledSourceId = "intake:" + randomUUID();
  await ticket(internal, disabledSourceId);
  expect(
    (
      await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(internal.s)} AND ticket_id=${disabledSourceId}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  await internal.settings.update(internal.s, internal.actor, stopped.revision, {
    enabled: true,
  });
  const after = (
    await sql<{
      id: string;
      generation: number;
      state: string;
    }>`SELECT id,generation,state FROM automation_flows WHERE ${tenant(internal.s)} ORDER BY id`.execute(
      db,
    )
  ).rows;
  expect(after).toEqual(
    before.map((flow) => ({
      ...flow,
      generation: flow.generation + 1,
      state: "ACTIVE",
    })),
  );
  const receipts = (
    await sql<AutomationEventRow>`SELECT * FROM automation_event_inbox WHERE ${tenant(internal.s)}`.execute(
      db,
    )
  ).rows;
  expect(receipts).toHaveLength(2);
  expect(
    receipts.every(
      (receipt) =>
        receipt.state === "SKIPPED" &&
        receipt.reason === "AUTOMATION_STOPPED" &&
        receipt.ticket_id === null &&
        receipt.ticket_state === null &&
        receipt.ticket_version === null &&
        receipt.channel_id === null &&
        receipt.actor_ciphertext === null,
    ),
  ).toBe(true);
  expect(
    receipts.find((receipt) => receipt.source === "INTERACTION")!.actor_hash,
  ).toBe(vault.hash(internal.s, other));
  expect(
    (
      await sql`SELECT state FROM automation_approvals WHERE ${tenant(internal.s)} ORDER BY identity`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ state: "EXPIRED" }, { state: "EXPIRED" }]);
  expect(
    (
      await sql`SELECT id FROM automation_interaction_instances WHERE ${tenant(internal.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  await expect(
    tokens.read(db, internal.s, m.customId, m.snapshot.actor.key),
  ).rejects.toThrow("COMPONENT_EXPIRED");
  let sends = 0;
  const discord = Object.assign(internal.discord, {
    automationPreflight: vi.fn(async () => {}),
    automationWrite: vi.fn(
      async (
        _write: AutomationDiscordWrite,
        beforeSend: () => Promise<void>,
      ) => {
        await beforeSend();
        sends++;
        return "884888888888888888";
      },
    ),
  });
  const runtime = new AutomationRuntime(db, {
    admission: policy,
    adapter: createAlpha15DiscordAdapter(db, discord, vault),
  });
  expect(await internal.events.dispatch(oldReceipt!)).toMatchObject({
    state: "SKIPPED",
  });
  expect(await runtime.tick(internal.s, oldRun.id)).toMatchObject({
    state: "CANCELLED",
  });
  expect(sends).toBe(0);
  expect(
    (await manual.service.store.run(internal.s, oldRun.id))!.usage_state,
  ).toBe("RELEASED");
  expect(
    (
      await sql`SELECT state FROM automation_operations WHERE ${tenant(internal.s)} AND identity='confirmed-before-stop'`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ state: "SUCCEEDED" }]);
  const fresh = (await ticket(internal)).find(
    (receipt) =>
      receipt.state === "PENDING" && receipt.flow_id === internal.definition.id,
  )!;
  expect(fresh).toBeDefined();
  const accepted = await internal.events.dispatch(fresh);
  expect(accepted.state).toBe("STARTED");
  expect(await runtime.tick(internal.s, accepted.id!)).toMatchObject({
    state: "COMPLETED",
  });
  expect(sends).toBe(1);
});
it("skips a stopped schedule occurrence inside the normal one-second lateness window and starts the next future occurrence", async () => {
  const today = new Date().toISOString().slice(0, 10),
    end = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const f = await fixture({
    kind: "schedule",
    schedule: {
      kind: "recurring",
      frequency: "daily",
      time: "00:00",
      timeZone: "UTC",
      startDate: today,
      endDate: end,
      missingTime: "skip",
      repeatedTime: "earlier",
      pastOccurrences: "skip",
    },
  });
  const stopped = await f.settings.update(f.s, f.actor, 0, { enabled: false });
  const planned = new Date();
  await sql`UPDATE automation_schedules SET next_at=${planned} WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await f.settings.update(f.s, f.actor, stopped.revision, { enabled: true });
  const schedule = (
    await sql<{
      id: string;
      generation: number;
      next_at: Date;
      admission_after: Date;
    }>`SELECT * FROM automation_schedules WHERE ${tenant(f.s)}`.execute(db)
  ).rows[0]!;
  const checkedAt = new Date(
    Math.max(Date.now(), schedule.admission_after.getTime() + 1),
  );
  expect(checkedAt.getTime() - planned.getTime()).toBeLessThan(1000);
  const scheduler = new AutomationScheduler(db, f.service, () => checkedAt);
  expect(
    await scheduler.dispatch(
      f.s,
      schedule.id,
      schedule.generation,
      planned.toISOString(),
    ),
  ).toMatchObject({ state: "SKIPPED" });
  expect(
    (await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toEqual([]);
  const next = (
    await sql<{
      next_at: Date;
      generation: number;
    }>`SELECT next_at,generation FROM automation_schedules WHERE ${tenant(f.s)}`.execute(
      db,
    )
  ).rows[0]!;
  expect(next.next_at > checkedAt).toBe(true);
  const future = new AutomationScheduler(db, f.service, () => next.next_at);
  expect(
    await future.dispatch(
      f.s,
      schedule.id,
      next.generation,
      next.next_at.toISOString(),
    ),
  ).toMatchObject({ state: "STARTED" });
});
it("lets a confirmed in-flight adapter finish while global stop waits without reversing its flow lock", async () => {
  const f = await fixture({ kind: "manual", inputs: [] }, true),
    run = await f.service.start(f.s, f.actor, f.definition.id, {
      requestId: randomUUID(),
    });
  let entered!: () => void, release!: () => void;
  const atPreflight = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
  let sends = 0;
  const discord = Object.assign(f.discord, {
    automationPreflight: vi.fn(async () => {
      entered();
      await held;
    }),
    automationWrite: vi.fn(
      async (
        _write: AutomationDiscordWrite,
        beforeSend: () => Promise<void>,
      ) => {
        await beforeSend();
        sends++;
        return "884888888888888888";
      },
    ),
  });
  const runtime = new AutomationRuntime(db, {
      admission: policy,
      adapter: createAlpha15DiscordAdapter(db, discord, vault),
    }),
    tick = runtime.tick(f.s, run.id);
  await atPreflight;
  let stopFinished = false;
  const stopping = f.settings
    .update(f.s, f.actor, 0, { enabled: false })
    .then((value) => {
      stopFinished = true;
      return value;
    });
  try {
    await vi.waitFor(
      async () => {
        const waits = (
          await sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%guild_settings%'`.execute(
            db,
          )
        ).rows;
        expect(waits.length).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 10 },
    );
    expect(stopFinished).toBe(false);
    release();
    const [result] = await Promise.all([tick, stopping]);
    expect(["CANCELLED", "COMPLETED"]).toContain(result!.state);
    expect(sends).toBe(1);
    expect(
      (
        await sql`SELECT state FROM automation_operations WHERE ${tenant(f.s)}`.execute(
          db,
        )
      ).rows,
    ).toEqual([{ state: "SUCCEEDED" }]);
  } finally {
    release();
    await Promise.allSettled([tick, stopping]);
  }
});
it("bounds a worker pass and deletes metadata within seven days", async () => {
  const f = await fixture();
  await ticket(f);
  const result = await processAlpha15AutomationEvents(db, f.discord, vault, {
    admission: policy,
    adoptedActions: new Set(),
  });
  expect(result.eventsConsidered).toBeLessThanOrEqual(20);
  const future = new Date(Date.now() + 7 * 86400000 + 1000);
  await sweepAutomationEventRetention(db, future);
  expect(
    (
      await sql`SELECT event_id FROM automation_event_inbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});
