import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ExploreService } from "../../packages/analytics/src/explore";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild, Components } from "../../packages/security/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { FakeDiscord } from "../fixtures/discord";
import { validatePanel, type Panel } from "../../packages/discord-panels/src/primitives";
import { OperationsIntake } from "../../packages/operations/src/intake";
import { AttentionInbox } from "../../packages/operations/src/inbox";
import { Playbooks } from "../../packages/operations/src/playbooks";
import { Destinations } from "../../packages/operations/src/destinations";
import { Reports } from "../../packages/operations/src/reports";
import { InterventionReview } from "../../packages/operations/src/intervention-review";
import { EventOperations } from "../../packages/operations/src/events";
import { PlaybookWorker } from "../../apps/worker/src/playbooks";
import { ReportWorker } from "../../apps/worker/src/reports";
import { ActionWorker } from "../../apps/worker/src/actions";
import { InteractionWorker } from "../../apps/worker/src/interactions";
import { PrivacyService } from "../../packages/security/src/privacy";
import { enforceOperationsPlan } from "../../packages/operations/src/plan-policy";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  guild = 935000000000000000n;
const vault = new IdentityVault("ad".repeat(32), "bd".repeat(32)),
  tokens = new Components("alpha8-operations-tests"),
  user = "222222222222222222",
  channel = "933333333333333330",
  member = "222222222222222223";
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture(plan = "GROWTH") {
  const s = scopeForGuild(String(guild++));
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active') ON CONFLICT(organization_id,guild_id) DO UPDATE SET plan_key=EXCLUDED.plan_key,status='active'`.execute(
    db,
  );
  const actor: Actor = {
      key: vault.hash(s, user),
      permissions: "8",
      roles: [],
      source: "WEB_DASHBOARD",
      requestId: "alpha8-operations-test",
    },
    settings = new SettingsService(db),
    discord = new FakeDiscord();
  discord.members.set(user, {
    joinedAt: "2026-01-01T00:00:00Z",
    permissions: "8",
    roles: [],
    bot: false,
    pending: false,
  });
  discord.members.set(member, {
    joinedAt: "2026-01-01T00:00:00Z",
    permissions: "0",
    roles: [],
    bot: false,
    pending: false,
  });
  const intake = new OperationsIntake(db, vault, discord, tokens),
    actions = new ActionWorker(
      db,
      vault,
      discord,
      new OnboardingService(db, settings, vault),
    );
  return { s, actor, settings, discord, intake, actions };
}
async function published(f: Awaited<ReturnType<typeof fixture>>) {
  const panel = await f.intake.save(f.s, f.actor, {
    title: "Operations support",
    category: "Support",
  });
  await f.intake.publish(f.s, f.actor, panel.id, panel.version, channel);
  await f.actions.tick(f.s);
  expect((await f.intake.list(f.s, f.actor)).panels[0]).toMatchObject({
    state: "PUBLISHED",
  });
  return panel;
}
async function request(f: Awaited<ReturnType<typeof fixture>>) {
  const panel = await published(f);
  const actor = { ...f.actor, key: vault.hash(f.s, member), permissions: "0" };
  return {
    ...(await f.intake.submit(
      f.s,
      actor,
      member,
      randomUUID(),
      { panelId: panel.id, version: panel.version },
      {
        issue: "An explicitly submitted issue",
        context: "No message transcript",
      },
    )),
    panel,
  };
}
it("Free intake accepts only explicit signed fields, encrypts them and deduplicates concurrent submissions", async () => {
  const f = await fixture("FREE"),
    panel = await published(f),
    actor = { ...f.actor, key: vault.hash(f.s, member), permissions: "0" },
    intent = { panelId: panel.id, version: panel.version };
  const modal = await f.intake.modal(f.s, member, intent),
    verified = await tokens.read(db, f.s, modal.custom_id, actor.key);
  expect(verified.action).toBe("intakeSubmit");
  await expect(
    tokens.read(db, f.s, modal.custom_id, f.actor.key),
  ).rejects.toThrow();
  const results = await Promise.all([
    f.intake.submit(f.s, actor, member, "same-interaction", intent, {
      issue: "Explicit issue",
      context: "Submitted context",
    }),
    f.intake.submit(f.s, actor, member, "same-interaction", intent, {
      issue: "Explicit issue",
      context: "Submitted context",
    }),
  ]);
  expect(new Set(results.map((value) => value.id)).size).toBe(1);
  expect(results.filter((value) => value.duplicate)).toHaveLength(1);
  const stored = (
    await sql`SELECT * FROM operations_requests WHERE ${tenant(f.s)}`.execute(
      db,
    )
  ).rows;
  expect(JSON.stringify(stored)).not.toContain("Explicit issue");
  expect(JSON.stringify(stored)).not.toContain("Submitted context");
  expect(await f.intake.read(f.s, f.actor, results[0]!.id)).toMatchObject({
    fields: { issue: "Explicit issue" },
  });
  await expect(
    f.intake.submit(f.s, actor, member, "untrusted", intent, {
      issue: "Issue",
      transcript: "Forbidden",
    }),
  ).rejects.toThrow("UNEXPECTED_FORM_FIELD");
  await expect(
    f.intake.save(f.s, f.actor, { title: "Second", category: "Test" }),
  ).rejects.toThrow("BILLING_LIMIT_REACHED");
  const other = await fixture();
  await expect(
    other.intake.read(other.s, other.actor, results[0]!.id),
  ).rejects.toThrow("REQUEST_NOT_FOUND");
  await new PrivacyService(db, vault, f.settings).delete(
    f.s,
    member,
    actor,
    false,
  );
  expect((await f.intake.list(f.s, f.actor)).requests).toEqual([]);
  expect(
    (
      await sql`SELECT message_id FROM attention_items WHERE ${tenant(f.s)} AND item_type='OPERATIONS_REQUEST'`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});
it("rejects a pending custom intake immediately on downgrade and deletion wins publication", async () => {
  const f = await fixture("STARTER"),
    panel = await f.intake.save(f.s, f.actor, {
      title: "Custom",
      category: "Test",
      fields: [
        { key: "details", label: "Details", required: true, maxLength: 100 },
      ],
    }),
    other = await f.intake.save(f.s, f.actor, {
      title: "Retained",
      category: "Test",
    });
  await f.intake.publish(f.s, f.actor, panel.id, panel.version, channel);
  await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await f.actions.tick(f.s);
  expect(f.discord.calls).not.toContain("sendPanel");
  await expect(
    f.intake.publish(f.s, f.actor, other.id, other.version, channel),
  ).rejects.toThrow("BILLING_LIMIT_REACHED");
  await enforceOperationsPlan(db, f.s);
  expect(
    (await f.intake.list(f.s, f.actor)).panels.every(
      (row) => (row as { state: string }).state === "PAUSED_PLAN_LIMIT",
    ),
  ).toBe(true);
  const deleted = await fixture("FREE"),
    pending = await deleted.intake.save(deleted.s, deleted.actor, {
      title: "Pending",
      category: "Test",
    });
  await deleted.intake.publish(
    deleted.s,
    deleted.actor,
    pending.id,
    pending.version,
    channel,
  );
  await new PrivacyService(db, vault, deleted.settings).delete(
    deleted.s,
    user,
    deleted.actor,
    true,
  );
  await deleted.actions.tick(deleted.s);
  expect(deleted.discord.calls).not.toContain("sendPanel");
});
it("runs Attention → versioned action → measurement once and never notifies after revision/archive", async () => {
  const f = await fixture(),
    received = await request(f),
    destination = await new Destinations(db, f.discord).create(f.s, f.actor, {
      name: "Operations",
      kind: "DISCORD",
      channelId: channel,
    }),
    books = new Playbooks(db),
    definition = {
      trigger: { kind: "ATTENTION", type: "OPERATIONS_REQUEST" },
      destinations: [destination.id],
      measurement: { query: { metric: "reply", days: 7 } },
    },
    book = await books.save(f.s, f.actor, {
      name: "Respond & measure",
      definition,
    });
  await books.transition(f.s, f.actor, {
    id: book.id,
    version: book.version,
    state: "ACTIVE",
  });
  const worker = new PlaybookWorker(db);
  await Promise.all([worker.tick(f.s), worker.tick(f.s)]);
  await worker.tick(f.s);
  await Promise.all([f.actions.tick(f.s), f.actions.tick(f.s)]);
  await worker.tick(f.s);
  await worker.tick(f.s);
  expect(f.discord.calls.filter((value) => value === "sendPanel")).toHaveLength(
    2,
  );
  expect(
    (
      await sql`SELECT id FROM playbook_executions WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(await new InterventionReview(db).list(f.s, f.actor)).toHaveLength(1);
  const inbox = new AttentionInbox(db),
    item = (await inbox.list(f.s, f.actor))[0]!;
  expect(item.evidence).toMatchObject({ coverageState: "COMPLETE" });
  const changes = await Promise.allSettled([
    inbox.action(f.s, f.actor, {
      key: item.message_id,
      channelId: "",
      state: "IN_PROGRESS",
      version: item.version,
    }),
    inbox.action(f.s, f.actor, {
      key: item.message_id,
      channelId: "",
      state: "DISMISSED",
      version: item.version,
    }),
  ]);
  expect(changes.filter((value) => value.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(changes.filter((value) => value.status === "rejected")).toHaveLength(
    1,
  );
  const head = (await books.list(f.s, f.actor))[0]!;
  await books.save(f.s, f.actor, {
    id: head.id,
    version: head.version,
    name: head.name,
    definition,
  });
  await expect(
    sql`UPDATE playbook_revisions SET definition='{}' WHERE ${tenant(f.s)}`.execute(
      db,
    ),
  ).rejects.toThrow();
  const archived = await fixture(),
    r = await request(archived),
    dest = await new Destinations(db, archived.discord).create(
      archived.s,
      archived.actor,
      { name: "Target", kind: "DISCORD", channelId: channel },
    ),
    b = await books.save(archived.s, archived.actor, {
      name: "Stop before send",
      definition: { ...definition, destinations: [dest.id] },
    });
  await books.transition(archived.s, archived.actor, {
    id: b.id,
    version: b.version,
    state: "ACTIVE",
  });
  await worker.tick(archived.s);
  await worker.tick(archived.s);
  const active = (await books.list(archived.s, archived.actor))[0]!;
  await books.transition(archived.s, archived.actor, {
    id: b.id,
    version: active.version,
    state: "ARCHIVED",
  });
  await archived.actions.tick(archived.s);
  expect(
    archived.discord.calls.filter((value) => value === "sendPanel"),
  ).toHaveLength(1);
  expect(r.id).toBeTruthy();
  expect(received.id).toBeTruthy();
});
it("simulates historical evidence deterministically, suppresses unknowns and performs zero actions", async () => {
  const f = await fixture("SCALE"),
    received = await request(f),
    destination = await new Destinations(db, f.discord).create(f.s, f.actor, {
      name: "Route",
      kind: "DISCORD",
      channelId: channel,
    }),
    books = new Playbooks(db),
    book = await books.save(f.s, f.actor, {
      name: "Simulation",
      definition: {
        trigger: { kind: "ATTENTION", type: "OPERATIONS_REQUEST" },
        destinations: [destination.id],
        escalation: { afterMinutes: 15, destinationId: destination.id },
        measurement: { query: { metric: "reply" } },
      },
    });
  await sql`UPDATE attention_items SET opened_at=now()-interval '2 days' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,opened_at,item_type,reason) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'','unknown-evidence',now()-interval '1 day','OPEN',now()-interval '1 day','OPERATIONS_REQUEST','Fixture unknown')`.execute(
    db,
  );
  const now = new Date(),
    simulation = await books.dryRun(f.s, f.actor, book.id, 7, now);
  expect(simulation).toMatchObject({
    wouldTrigger: 1,
    wouldNotify: 1,
    wouldEscalate: 1,
    suppressedDueToCoverage: 1,
    actualActions: 0,
  });
  expect(await books.dryRun(f.s, f.actor, book.id, 7, now)).toEqual(simulation);
  expect(
    (
      await sql`SELECT id FROM playbook_executions WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(f.discord.calls.filter((value) => value === "sendPanel")).toHaveLength(
    1,
  );
  await sql`UPDATE guild_subscriptions SET plan_key='GROWTH' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await expect(books.dryRun(f.s, f.actor, book.id, 7)).rejects.toThrow(
    "PLAN_REQUIRED",
  );
  expect(received.id).toBeTruthy();
});
it("renders actual chart reports, deduplicates concurrent runs and cancels queued sends on disable", async () => {
  const f = await fixture(),
    reports = new Reports(db),
    destination = await new Destinations(db, f.discord).create(f.s, f.actor, {
      name: "Reports",
      kind: "DISCORD",
      channelId: channel,
    }),
    template = await reports.template(f.s, f.actor, {
      title: "Community operations",
      queries: [{ metric: "reply", days: 7 }],
      footer: "Team report",
    }),
    schedule = await reports.schedule(f.s, f.actor, {
      templateId: template.id,
      destinationId: destination.id,
      clock: {
        cadence: "WEEKLY",
        timezone: "Asia/Tokyo",
        day: 1,
        hour: 9,
        minute: 0,
      },
    });
  await sql`UPDATE report_schedules SET next_at=now()-interval '1 second' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const worker = new ReportWorker(db);
  await Promise.all([worker.tick(f.s), worker.tick(f.s)]);
  expect((await reports.list(f.s, f.actor)).runs).toHaveLength(1);
  await Promise.all([f.actions.tick(f.s), f.actions.tick(f.s)]);
  await worker.tick(f.s);
  expect((await reports.list(f.s, f.actor)).runs[0]).toMatchObject({
    state: "SUCCEEDED",
  });
  const image = [...f.discord.attachments.values()][0]![0]!;
  expect(image.filename).toBe("nexus-report-0.png");
  const body = [...f.discord.panels.values()][0] as Panel;
  validatePanel(body);
  expect(body.content?.length).toBeLessThanOrEqual(2000);
  expect(body.content).toContain("Direct replies");
  expect(body.content).toContain("Total:");
  expect(body.content).toContain("Missing values are not zero");
  expect(body.content).not.toMatch(/NO DATA|Coverage: UNKNOWN/);
  expect(body.embeds?.[0]?.color).toBe(0x2758ca);
  expect(image.data.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  await sql`UPDATE report_schedules SET next_at=now()-interval '1 second' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await worker.tick(f.s);
  await reports.setEnabled(f.s, f.actor, schedule.id, false);
  await f.actions.tick(f.s);
  expect(f.discord.calls.filter((value) => value === "sendPanel")).toHaveLength(
    1,
  );
});
it("a stale report worker cannot fail the run reclaimed by a new lease", async () => {
  const f = await fixture(),
    reports = new Reports(db),
    destination = await new Destinations(db, f.discord).create(f.s, f.actor, {
      name: "Lease report",
      kind: "DISCORD",
      channelId: channel,
    }),
    template = await reports.template(f.s, f.actor, {
      title: "Recovery",
      queries: [{ metric: "reply", days: 7 }],
    }),
    schedule = await reports.schedule(f.s, f.actor, {
      templateId: template.id,
      destinationId: destination.id,
      clock: { cadence: "WEEKLY", timezone: "UTC", day: 1, hour: 9, minute: 0 },
    });
  await sql`UPDATE report_schedules SET next_at=now()-interval '1 second' WHERE ${tenant(f.s)} AND id=${schedule.id}::uuid`.execute(
    db,
  );
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve)),
    blocked = new Promise<void>((resolve) => (release = resolve)),
    spy = vi
      .spyOn(ExploreService.prototype, "chart")
      .mockImplementationOnce(async () => {
        entered();
        await blocked;
        throw new Error("STALE_RENDER_FAILURE");
      });
  try {
    const old = new ReportWorker(db).tick(f.s);
    await started;
    await sql`UPDATE report_runs SET lease_until=now()-interval '1 second' WHERE ${tenant(f.s)} AND state='RUNNING'`.execute(
      db,
    );
    await new ReportWorker(db).tick(f.s);
    release();
    await old;
    expect((await reports.list(f.s, f.actor)).runs).toContainEqual(
      expect.objectContaining({ state: "QUEUED", last_error: null }),
    );
    expect(
      (
        await sql`SELECT id FROM action_outbox WHERE ${tenant(f.s)} AND kind='REPORT_PUBLISH'`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
    await f.actions.tick(f.s);
    expect(
      f.discord.calls.filter((value) => value === "sendPanel"),
    ).toHaveLength(1);
  } finally {
    release();
    spy.mockRestore();
  }
});
it("measured trends create deduplicated evidence-backed Inbox items and dismissal fences notification", async () => {
  const f = await fixture(),
    books = new Playbooks(db),
    worker = new PlaybookWorker(db),
    dest = await new Destinations(db, f.discord).create(f.s, f.actor, {
      name: "Trend review",
      kind: "DISCORD",
      channelId: channel,
    }),
    now = new Date();
  const spec = await new ExploreService(db).chart(
    f.s,
    { metric: "reply", days: 7 },
    now,
  );
  const evidence = {
    ...spec.evidence,
    value: 10,
    numerator: 10,
    sampleSize: 10,
    coverageState: "COMPLETE" as const,
    coverageReasons: [],
    observationState: "OBSERVED" as const,
  };
  const spy = vi
    .spyOn(ExploreService.prototype, "chart")
    .mockResolvedValue({ ...spec, evidence });
  try {
    const book = await books.save(f.s, f.actor, {
      name: "Reply threshold",
      definition: {
        trigger: {
          kind: "TREND",
          query: { metric: "reply", days: 7 },
          mode: "THRESHOLD",
          direction: "ABOVE",
          threshold: 5,
        },
        destinations: [dest.id],
        measurement: { query: { metric: "reply", days: 7 } },
      },
    });
    await books.transition(f.s, f.actor, {
      id: book.id,
      version: book.version,
      state: "ACTIVE",
    });
    await Promise.all([worker.tick(f.s, now), worker.tick(f.s, now)]);
    const inbox = new AttentionInbox(db),
      items = await inbox.list(f.s, f.actor);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      item_type: "METRIC_TREND",
      status: "OPEN",
      evidence: { value: 10, coverageState: "COMPLETE" },
    });
    await inbox.action(f.s, f.actor, {
      key: items[0]!.message_id,
      channelId: "",
      state: "DISMISSED",
      version: items[0]!.version,
    });
    await worker.tick(f.s, now);
    await f.actions.tick(f.s);
    expect(f.discord.calls).not.toContain("sendPanel");
    await worker.tick(f.s, new Date(now.getTime() + 20 * 60000));
    expect(await inbox.list(f.s, f.actor)).toHaveLength(1);
    expect(
      (
        await sql`SELECT id FROM playbook_executions WHERE ${tenant(f.s)}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
    expect((await inbox.list(f.s, f.actor))[0]!.status).toBe("DISMISSED");
  } finally {
    spy.mockRestore();
  }
});
it("intervention reviews are once-only and never convert missing evidence into causal claims", async () => {
  const f = await fixture(),
    reviews = new InterventionReview(db),
    recorded = await reviews.create(
      f.s,
      f.actor,
      { title: "Change support routing", query: { metric: "reply", days: 7 } },
      new Date("2026-09-01T12:00:00Z"),
    );
  await Promise.all([
    reviews.tick(f.s, new Date(recorded.reviewAt)),
    reviews.tick(f.s, new Date(recorded.reviewAt)),
  ]);
  const items = await reviews.list(f.s, f.actor);
  expect(items[0]).toMatchObject({
    state: "REVIEW_READY",
    comparison: {
      comparable: false,
      absoluteChange: null,
      relativeChange: null,
    },
  });
  expect(
    (
      await sql`SELECT id,data FROM operations_domain_events WHERE ${tenant(f.s)} AND event_type='intervention.review_ready'`.execute(
        db,
      )
    ).rows,
  ).toEqual([
    expect.objectContaining({
      data: expect.objectContaining({ causalClaim: false }),
    }),
  ]);
  expect(
    (
      await sql`SELECT intervention_id FROM operations_intervention_reviews WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("disabled intake tokens expire immediately and retained configuration can be reviewed without deleting requests", async () => {
  const f = await fixture("STARTER"),
    panel = await published(f);
  await f.intake.disable(f.s, f.actor, panel.id, panel.version);
  await expect(
    f.intake.modal(f.s, member, { panelId: panel.id, version: panel.version }),
  ).rejects.toThrow();
  const saved = (await f.intake.list(f.s, f.actor)).panels[0] as {
    version: number;
    fields: { key: string }[];
    state: string;
  };
  expect(saved).toMatchObject({ state: "DISABLED" });
  expect(saved.fields.map((field) => field.key)).toEqual(["issue", "context"]);
  const reviewed = await f.intake.save(f.s, f.actor, {
    id: panel.id,
    version: saved.version,
    title: "Reviewed",
    category: "Support",
  });
  await f.intake.publish(f.s, f.actor, reviewed.id, reviewed.version, channel);
  await f.actions.tick(f.s);
  expect((await f.intake.list(f.s, f.actor)).panels[0]).toMatchObject({
    state: "PUBLISHED",
  });
});
it("preserves paid configuration on downgrade and requires explicit reactivation", async () => {
  const f = await fixture(),
    destination = await new Destinations(db, f.discord).create(f.s, f.actor, {
      name: "Retained",
      kind: "DISCORD",
      channelId: channel,
    }),
    books = new Playbooks(db),
    book = await books.save(f.s, f.actor, {
      name: "Stored",
      definition: {
        trigger: { kind: "ATTENTION", type: "OPERATIONS_REQUEST" },
        destinations: [destination.id],
        measurement: { query: { metric: "reply" } },
      },
    });
  await books.transition(f.s, f.actor, {
    id: book.id,
    version: book.version,
    state: "ACTIVE",
  });
  await sql`UPDATE guild_subscriptions SET plan_key='STARTER' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await enforceOperationsPlan(db, f.s);
  expect((await books.list(f.s, f.actor))[0]).toMatchObject({
    state: "PAUSED_PLAN_LIMIT",
  });
  await sql`UPDATE guild_subscriptions SET plan_key='GROWTH' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await enforceOperationsPlan(db, f.s);
  expect((await books.list(f.s, f.actor))[0]).toMatchObject({
    state: "PAUSED_PLAN_LIMIT",
  });
});
it("private Free Discord charts need no administrator and cannot publish without operations permission", async () => {
  const helperRole = "222222222222222225";
  const f = await fixture("FREE"),
    worker = new InteractionWorker(
      db,
      vault,
      tokens,
      f.discord,
      f.settings,
      new OnboardingService(db, f.settings, vault),
      async () => {},
    ),
    job = {
      id: "chart-private",
      userId: member,
      command: "chart",
      token: "test-token",
      applicationId: "222222222222222229",
      privateResponse: true,
      channelId: channel,
      commandOptions: { days: 7 },
    };
  await expect(worker.dispatch(f.s, job)).rejects.toThrow("ADMIN_REQUIRED");
  const cfg = await f.settings.get(f.s);
  await f.settings.update(f.s, f.actor, cfg.revision, {
    helperRoleIds: [helperRole],
  });
  f.discord.members.get(member)!.roles = [helperRole];
  const privateReply = await worker.dispatch(f.s, job),
    files = (
      privateReply as typeof privateReply & {
        nexusFiles: { dataBase64: string }[];
      }
    ).nexusFiles;
  expect(Buffer.from(files[0]!.dataBase64, "base64").subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(f.discord.calls).not.toContain("sendPanel");
  const row = privateReply.components?.[0] as {
    components: { custom_id: string; disabled?: boolean }[];
  };
  expect(row.components[2]?.disabled).toBe(true);
  expect(row.components[3]?.disabled).toBe(true);
  expect(
    await tokens.read(
      db,
      f.s,
      row.components[0]!.custom_id,
      vault.hash(f.s, member),
    ),
  ).toMatchObject({ privateSettings: true, action: "chartPeriod" });
  await expect(
    worker.dispatch(f.s, {
      ...job,
      id: "chart-unauthorized",
      commandOptions: { days: 7, visibility: "channel" },
    }),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await worker.dispatch(f.s, {
    ...job,
    id: "chart-authorized",
    userId: user,
    commandOptions: { days: 7, visibility: "channel" },
  });
  await f.actions.tick(f.s);
  expect(f.discord.calls.filter((value) => value === "sendPanel")).toHaveLength(
    1,
  );
});
it("Starter event templates produce real scoped calendars and reject unsafe DST gaps", async () => {
  const f = await fixture("STARTER"),
    events = new EventOperations(db),
    saved = await events.save(f.s, f.actor, {
      title: "Community review",
      timezone: "America/New_York",
      localStart: "2026-11-01T01:30",
      durationMinutes: 60,
      recurrence: "WEEKLY",
      location: "https://example.com/event",
    });
  const calendar = await events.calendar(f.s, f.actor, saved.id);
  expect(calendar).toContain("BEGIN:VCALENDAR");
  expect(calendar).toContain("BEGIN:VTIMEZONE");
  expect(calendar).toContain("TZID:America/New_York");
  expect(calendar).toContain("RRULE:FREQ=WEEKLY;COUNT=52");
  await expect(
    events.save(f.s, f.actor, {
      title: "Invalid time",
      timezone: "America/New_York",
      localStart: "2026-03-08T02:30",
      durationMinutes: 60,
    }),
  ).rejects.toThrow("SCHEDULE_TIME_NONEXISTENT");
  const other = await fixture("STARTER");
  await expect(events.calendar(other.s, other.actor, saved.id)).rejects.toThrow(
    "EVENT_TEMPLATE_NOT_FOUND",
  );
  const free = await fixture("FREE");
  await expect(
    events.save(free.s, free.actor, {
      title: "Paid",
      timezone: "UTC",
      localStart: "2026-10-07T12:00",
      durationMinutes: 30,
    }),
  ).rejects.toThrow("PLAN_REQUIRED");
});
