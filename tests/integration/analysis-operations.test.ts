import { currentRecipe, saveRecipe } from "../../packages/settings/src/recipes";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  connect,
  migrate,
  sql,
  tenant,
  json,
  type Database,
} from "../../packages/db/src/index";
import { infrastructure } from "../fixtures/infrastructure";
import { analysisFixture, analysisVault } from "../fixtures/analysis";
import {
  AnalysisService,
  analysisUsage,
  analysisPriority,
  analysisPolicy,
  type AnalysisRun,
} from "../../packages/analysis/src/index";
import {
  AnalysisDispatcher,
  AnalysisProcessor,
} from "../../apps/worker/src/analysis";
import { SetupWizard } from "../../packages/operations/src/setup-wizard";
import {
  actorPermissions,
  operationsAccess,
} from "../../packages/operations/src/policy";
import { PrivacyService } from "../../packages/security/src/privacy";
import { analysisMetrics } from "../../packages/analytics/src/analysis";
import { Components } from "../../packages/security/src/index";
import { CommunityService } from "../../packages/presentation/src/community";
import { billingOffering } from "../../packages/settings/src/billing/offerings";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  service: AnalysisService;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
  service = new AnalysisService(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function usage(f: Awaited<ReturnType<typeof analysisFixture>>) {
  return db.transaction().execute((tx) => analysisUsage(tx, f.s));
}
async function due(id: string) {
  await sql`UPDATE analysis_runs SET available_at=now() WHERE id=${id}::uuid`.execute(
    db,
  );
}
async function reserve(
  f: Awaited<ReturnType<typeof analysisFixture>>,
  key = randomUUID(),
  rerun = false,
) {
  return (
    await service.request(
      f.s,
      f.actor,
      { type: "OVERALL", days: 30 },
      key,
      undefined,
      rerun,
    )
  ).run;
}
async function finish(run: AnalysisRun) {
  const claimed = await service.claim(run.id);
  expect(claimed).not.toBeNull();
  await service.execute(claimed!);
  return claimed!;
}
it.each([
  ["FREE", 1],
  ["STARTER", 3],
  ["GROWTH", 5],
  ["SCALE", 10],
  ["ENTERPRISE", 0],
])("grants %s its approved monthly detailed uses (%i)", async (plan, n) => {
  const f = await analysisFixture(db, plan as string);
  expect((await usage(f)).remaining).toBe(n);
  expect((await usage(f)).remaining).toBe(n);
  expect(
    (await sql`SELECT id FROM analysis_grants WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(n ? 1 : 0);
});
it("allows basic analytics after the detailed allowance is exhausted", async () => {
  const f = await analysisFixture(db);
  await finish(await reserve(f));
  expect((await usage(f)).remaining).toBe(0);
  await new CommunityService(db, f.settings).overview(f.s, 30);
  await new CommunityService(db, f.settings).overview(f.s, 30);
  expect((await usage(f)).consumed).toBe(1);
  expect(
    (await sql`SELECT id FROM analysis_runs WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(1);
});
it("serializes two distinct starts competing for the final use", async () => {
  const f = await analysisFixture(db),
    attempts = await Promise.allSettled([
      reserve(f, randomUUID(), true),
      reserve(f, randomUUID(), true),
    ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect((await usage(f)).remaining).toBe(0);
  expect((await usage(f)).reserved).toBe(1);
});
it("reuses a double click and equal inputs but invalidates changed data", async () => {
  const f = await analysisFixture(db, "STARTER"),
    key = randomUUID(),
    runs = await Promise.all([reserve(f, key), reserve(f, key)]);
  expect(runs[0]!.id).toBe(runs[1]!.id);
  expect((await reserve(f)).id).toBe(runs[0]!.id);
  await finish(runs[0]!);
  const duplicate = await service.preview(f.s, f.actor, {
    type: "OVERALL",
    days: 30,
  });
  expect(duplicate.duplicate?.id).toBe(runs[0]!.id);
  await sql`UPDATE message_observations SET first_reply_seconds=300 WHERE ${tenant(f.s)} AND first_reply_seconds IS NULL`.execute(
    db,
  );
  expect(
    (await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 }))
      .duplicate,
  ).toBeNull();
  expect((await usage(f)).consumed).toBe(1);
});
it("claims duplicate deliveries once and fences duplicate result/usage finalization", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    claims = await Promise.all([service.claim(run.id), service.claim(run.id)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claimed = claims.find(Boolean)!;
  await Promise.all([service.execute(claimed), service.execute(claimed)]);
  await service.execute(claimed);
  expect(
    (
      await sql`SELECT run_id FROM analysis_results WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await sql`SELECT run_id FROM analysis_usage_ledger WHERE ${tenant(f.s)} AND outcome='CONSUMED'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(await usage(f)).toEqual({ remaining: 0, reserved: 0, consumed: 1 });
});
it("recovers a crashed claim, rejects its stale worker, and releases after exhausted retries", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    old = (await service.claim(run.id))!;
  await sql`UPDATE analysis_runs SET lease_until=now()-interval '1 second' WHERE id=${run.id}::uuid`.execute(
    db,
  );
  await service.recover();
  await due(run.id);
  const replacement = (await service.claim(run.id))!;
  expect(replacement.lease_token).not.toBe(old.lease_token);
  await service.execute(old);
  expect((await service.result(f.s, f.actor, run.id)).result).toBeNull();
  await service.fail(replacement, "TRANSIENT_INFRASTRUCTURE");
  await due(run.id);
  await service.execute((await service.claim(run.id))!, undefined, async () => {
    throw new Error("network unavailable");
  });
  expect((await service.result(f.s, f.actor, run.id)).run.status).toBe(
    "FAILED",
  );
  expect(await usage(f)).toEqual({ remaining: 1, reserved: 0, consumed: 0 });
});
it("does not recover a lease renewed since a scanner snapshot", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    claim = (await service.claim(run.id))!;
  await service.fail(claim, "TRANSIENT_INFRASTRUCTURE", true);
  expect((await service.result(f.s, f.actor, run.id)).run.status).toBe(
    "RUNNING",
  );
  await service.fail(claim, "CANCELED");
});
it.each(["analysis_results", "analysis_reservations"])(
  "rolls back %s failure without losing the reservation and retries safely",
  async (table) => {
    const f = await analysisFixture(db),
      run = await reserve(f),
      claim = (await service.claim(run.id))!;
    await sql`CREATE SEQUENCE analysis_test_failure`.execute(db);
    await sql`CREATE FUNCTION analysis_test_fail_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('analysis_test_failure')=1 THEN RAISE EXCEPTION 'transient persistence failure' USING ERRCODE='40001';END IF; RETURN NEW;END $$`.execute(
      db,
    );
    await sql
      .raw(
        `CREATE TRIGGER analysis_test_failure BEFORE ${table === "analysis_results" ? "INSERT" : "UPDATE"} ON ${table} FOR EACH ROW EXECUTE FUNCTION analysis_test_fail_once()`,
      )
      .execute(db);
    try {
      await service.execute(claim);
      expect((await service.result(f.s, f.actor, run.id)).run.status).toBe(
        "QUEUED",
      );
      expect(await usage(f)).toEqual({
        remaining: 0,
        reserved: 1,
        consumed: 0,
      });
      expect(
        (
          await sql`SELECT run_id FROM analysis_results WHERE ${tenant(f.s)}`.execute(
            db,
          )
        ).rows,
      ).toHaveLength(0);
      await due(run.id);
      await finish(run);
      expect(await usage(f)).toEqual({
        remaining: 0,
        reserved: 0,
        consumed: 1,
      });
    } finally {
      await sql
        .raw(`DROP TRIGGER analysis_test_failure ON ${table}`)
        .execute(db);
      await sql`DROP FUNCTION analysis_test_fail_once()`.execute(db);
      await sql`DROP SEQUENCE analysis_test_failure`.execute(db);
    }
  },
);
it("restores a queued use when retention expires before dispatch", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f);
  await sql`UPDATE analysis_runs SET retention_until=now()-interval '1 second' WHERE id=${run.id}::uuid`.execute(
    db,
  );
  await service.recover();
  expect(await usage(f)).toEqual({ remaining: 1, reserved: 0, consumed: 0 });
});
it("fails closed on no data, unsupported periods, option payloads and changed preview", async () => {
  const f = await analysisFixture(db, "FREE", false);
  // Missing observation coverage is unknown, distinct from a fully observed zero.
  await sql`UPDATE discord_integration_health SET gateway_state='UNKNOWN' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const p = await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 });
  expect(p.quality).toBe("NO_DATA");
  expect(p.metrics.every((m) => m.evidence.value === null)).toBe(true);
  await expect(reserve(f)).rejects.toThrow("ANALYSIS_NO_DATA");
  await expect(
    service.request(f.s, f.actor, { type: "OVERALL", days: -1 }, "invalid"),
  ).rejects.toThrow();
  await expect(
    service.preview(f.s, f.actor, {
      type: "OVERALL",
      days: 30,
      options: "x".repeat(100000),
    }),
  ).rejects.toThrow();
  const filled = await analysisFixture(db),
    preview = await service.preview(filled.s, filled.actor, {
      type: "OVERALL",
      days: 30,
    });
  await filled.settings.update(filled.s, filled.actor, 1, {
    analysisScope: { mode: "exclude", channelIds: [filled.channel] },
  });
  await expect(
    service.request(
      filled.s,
      filled.actor,
      { type: "OVERALL", days: 30 },
      "stale",
      {
        revision: preview.configRevision,
        fingerprint: preview.inputFingerprint,
      },
    ),
  ).rejects.toThrow("ANALYSIS_PREVIEW_CHANGED");
  expect((await usage(filled)).remaining).toBe(1);
});
it("marks partial collection and legacy replies without claiming completeness or measured zero", async () => {
  const f = await analysisFixture(db);
  await sql`INSERT INTO telemetry_health(organization_id,guild_id,id,started_at,ended_at,reason) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${f.start},${new Date(f.start.getTime() + 1000)},'fixture gap')`.execute(
    db,
  );
  expect(
    (await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 }))
      .quality,
  ).toBe("PARTIAL");
  await sql`UPDATE message_observations SET definition_version='alpha4-v1',first_reply_seconds=NULL WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const m = (
    await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 })
  ).metrics.find((m) => m.key === "observed_replies");
  expect(m?.quality).toBe("NO_DATA");
  expect(m?.evidence.value).toBeNull();
});
it("denies cross-tenant result access and analysis/operate authority to unprivileged users", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    other = await analysisFixture(db);
  await expect(service.result(other.s, other.actor, run.id)).rejects.toThrow(
    "ANALYSIS_NOT_FOUND",
  );
  await expect(
    service.result({ ...f.s, guildId: "111111111111111112" }, f.actor, run.id),
  ).rejects.toThrow("ANALYSIS_NOT_FOUND");
  await expect(
    service.request(
      f.s,
      { ...f.actor, permissions: "0" },
      { type: "OVERALL", days: 30 },
      "denied",
    ),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await finish(run);
  await expect(
    service.attention(
      f.s,
      { ...f.actor, permissions: "0" },
      run.id,
      "waiting_response",
    ),
  ).rejects.toThrow("ADMIN_REQUIRED");
});
it("adds one aggregate Attention item, rejects stale writes and requires OPERATE", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f);
  await finish(run);
  const keys = await Promise.all([
    service.attention(f.s, f.actor, run.id, "waiting_response"),
    service.attention(f.s, f.actor, run.id, "waiting_response"),
  ]);
  expect(keys[0]).toBe(keys[1]);
  expect(await service.attentionList(f.s, f.actor)).toHaveLength(1);
  const item = await service.attentionItem(f.s, f.actor, keys[0]!);
  await service.attentionUpdate(
    f.s,
    f.actor,
    item.message_id,
    item.version,
    "ACKNOWLEDGED",
  );
  await expect(
    service.attentionUpdate(
      f.s,
      f.actor,
      item.message_id,
      item.version,
      "RESOLVED",
    ),
  ).rejects.toThrow("REVISION_CONFLICT");
  await service.attentionUpdate(
    f.s,
    f.actor,
    item.message_id,
    item.version + 1,
    "RESOLVED",
  );
  expect(await service.attentionList(f.s, f.actor)).toHaveLength(0);
});
it("rejects revoked membership fallback even with Administrator and an active binding elsewhere", async () => {
  const f = await analysisFixture(db),
    root = randomUUID(),
    member = randomUUID();
  await sql`INSERT INTO operations_organizations VALUES(${f.s.organizationId}::uuid,'Test',${f.s.guildId})`.execute(
    db,
  );
  await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${f.s.organizationId}::uuid,${f.s.organizationId}::uuid,${f.s.guildId})`.execute(
    db,
  );
  await sql`INSERT INTO operations_org_members(organization_id,id,user_digest,user_ciphertext,name,role,state) VALUES(${f.s.organizationId}::uuid,${member}::uuid,${root},'test','Revoked','ANALYST','REVOKED')`.execute(
    db,
  );
  const actor = { ...f.actor, organizationMemberDigest: () => root };
  expect(await actorPermissions(db, f.s, actor)).toEqual([]);
  await expect(operationsAccess(db, f.s, actor, "READ")).rejects.toThrow(
    "NEXUS_ROLE_REQUIRED",
  );
  await expect(
    f.settings.update(f.s, actor, 1, { uiLanguage: "ja" }),
  ).rejects.toThrow("ADMIN_REQUIRED");
});
it("grants manual Enterprise allowance only through internal authority with immutable source identity", async () => {
  const f = await analysisFixture(db, "ENTERPRISE"),
    admin = {
      internal: true as const,
      hash: "internal-test",
      reason: "Enterprise contract test",
    };
  await expect(
    service.manualGrant(f.s, { internal: false, hash: "forged" } as never, {
      quantity: 2,
      sourceIdentity: "enterprise-contract",
    }),
  ).rejects.toThrow("NEXUS_INTERNAL_ADMIN_REQUIRED");
  const id = await service.manualGrant(f.s, admin, {
    quantity: 2,
    sourceIdentity: "enterprise-contract",
  });
  expect(
    await service.manualGrant(f.s, admin, {
      quantity: 2,
      sourceIdentity: "enterprise-contract",
    }),
  ).toBe(id);
  await expect(
    service.manualGrant(f.s, admin, {
      quantity: 3,
      sourceIdentity: "enterprise-contract",
    }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  expect((await usage(f)).remaining).toBe(2);
});
it("keeps 1/3/5 pack Offerings disabled and outside subscription Checkout", async () => {
  for (const n of [1, 3, 5]) {
    const id = randomUUID();
    await sql`INSERT INTO billing_offerings(id,provider,product_kind,analysis_quantity) VALUES(${id}::uuid,'STRIPE','ANALYSIS_PACK',${n})`.execute(
      db,
    );
    await expect(billingOffering(db, id)).rejects.toThrow(
      "BILLING_OFFERING_UNAVAILABLE",
    );
    await expect(
      sql`UPDATE billing_offerings SET enabled=true WHERE id=${id}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow();
  }
  await expect(
    sql`INSERT INTO billing_offerings(id,provider,product_kind,analysis_quantity) VALUES(${randomUUID()}::uuid,'STRIPE','ANALYSIS_PACK',2)`.execute(
      db,
    ),
  ).rejects.toThrow();
});
it("supports preview-first setup, actor binding, stale revisions and idempotent application", async () => {
  const f = await analysisFixture(db),
    wizard = new SetupWizard(db);
  let draft = await wizard.open(f.s, f.actor);
  await expect(
    wizard.get(f.s, { ...f.actor, key: "other" }, draft.id),
  ).rejects.toThrow("COMPONENT_EXPIRED");
  draft = await wizard.change(f.s, f.actor, draft.id, draft.version, "mode", [
    "include",
  ]);
  draft = await wizard.change(
    f.s,
    f.actor,
    draft.id,
    draft.version,
    "channels",
    [f.channel],
  );
  expect((await f.settings.get(f.s)).analysisScope.mode).toBe("all");
  draft = await wizard.move(f.s, f.actor, draft.id, draft.version, "next");
  for (let n = 0; n < 3; n++)
    draft = await wizard.move(f.s, f.actor, draft.id, draft.version, "skip");
  expect(draft.draft.skipped).toHaveLength(3);
  const saved = await wizard.confirm(f.s, f.actor, draft.id, draft.version);
  expect(saved.analysisScope).toEqual({
    mode: "include",
    channelIds: [f.channel],
    excludedChannelIds: [],
  });
  expect(
    (await wizard.confirm(f.s, f.actor, draft.id, draft.version)).revision,
  ).toBe(saved.revision);
  const stale = await wizard.open(f.s, f.actor);
  await f.settings.update(f.s, f.actor, saved.revision, { uiLanguage: "ja" });
  await expect(
    wizard.confirm(f.s, f.actor, stale.id, stale.version),
  ).rejects.toThrow("REVISION_CONFLICT");
});
it("retains results on downgrade and purges payloads only at configured retention", async () => {
  const f = await analysisFixture(db, "SCALE"),
    run = await reserve(f);
  await finish(run);
  await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  expect((await service.result(f.s, f.actor, run.id)).result).not.toBeNull();
  expect((await f.settings.get(f.s)).communityModel.confirmed).toBe(true);
  await sql`UPDATE analysis_runs SET retention_until=now()-interval '1 second' WHERE id=${run.id}::uuid`.execute(
    db,
  );
  await new PrivacyService(db, analysisVault, f.settings).purge(f.s);
  expect(
    (
      await sql`SELECT run_id FROM analysis_results WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT run_id FROM analysis_usage_ledger WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("scrubs requester provenance on member deletion and deletes all analysis state on server deletion", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f);
  await finish(run);
  await new SetupWizard(db).open(f.s, f.actor);
  const privacy = new PrivacyService(db, analysisVault, f.settings);
  await privacy.delete(f.s, f.user, f.actor);
  const row = (
    await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE id=${run.id}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(row.requested_by_actor_hash).toBeNull();
  expect(row.requested_by_user_ciphertext).toBeNull();
  expect(
    (await sql`SELECT id FROM setup_drafts WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
  await privacy.delete(f.s, f.user, f.actor, true);
  for (const table of [
    "analysis_runs",
    "analysis_grants",
    "analysis_results",
    "analysis_usage_ledger",
    "analysis_input_revisions",
  ])
    expect(
      (
        await sql
          .raw(
            `SELECT * FROM ${table} WHERE organization_id='${f.s.organizationId}'`,
          )
          .execute(db)
      ).rows,
    ).toHaveLength(0);
});
it("limits guild and organization claims while other organizations progress", async () => {
  const f = await analysisFixture(db, "STARTER"),
    g = await analysisFixture(db, "STARTER"),
    other = await analysisFixture(db),
    runs = [
      await reserve(f),
      await reserve(f, randomUUID(), true),
      await reserve(g),
      await reserve(other),
    ];
  await sql`INSERT INTO operations_organizations VALUES(${f.s.organizationId}::uuid,'Fairness',${f.s.guildId})`.execute(
    db,
  );
  for (const scope of [f.s, g.s])
    await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${f.s.organizationId}::uuid,${scope.organizationId}::uuid,${scope.guildId})`.execute(
      db,
    );
  expect(await service.claim(runs[0]!.id)).not.toBeNull();
  expect(await service.claim(runs[1]!.id)).toBeNull();
  expect(await service.claim(runs[2]!.id)).toBeNull();
  expect(await service.claim(runs[3]!.id)).not.toBeNull();
});
it("re-enqueues durable requests after dispatch failure and Redis queue loss", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    connection = new Redis(infra.redisUrl, { maxRetriesPerRequest: null }),
    queue = new Queue<{ analysisRunId: string }>(analysisPolicy.queue, {
      connection,
    });
  const dispatcher = new AnalysisDispatcher(db, queue),
    original = queue.add.bind(queue);
  queue.add = async () => {
    throw new Error("Redis unavailable");
  };
  try {
    await expect(dispatcher.tick()).rejects.toThrow("Redis unavailable");
    expect((await usage(f)).reserved).toBe(1);
    queue.add = original;
    await dispatcher.tick();
    const job = await queue.getJob("analysis-" + run.id);
    expect(job?.data).toEqual({ analysisRunId: run.id });
    expect(job?.opts.priority).toBeGreaterThan(0);
    await queue.obliterate({ force: true });
    await dispatcher.tick();
    expect(await queue.getJob("analysis-" + run.id)).toBeDefined();
  } finally {
    await queue.close();
    connection.disconnect();
  }
});
it("uses BullMQ priority and aging to advance an older Starter before new Scale jobs", async () => {
  const connection = new Redis(infra.redisUrl, { maxRetriesPerRequest: null }),
    name = "analysis-priority-" + randomUUID(),
    queue = new Queue(name, { connection }),
    order: string[] = [];
  let worker: Worker | undefined;
  try {
    await queue.add(
      "starter",
      {},
      { priority: analysisPriority("STARTER", new Date()) },
    );
    await queue.add(
      "scale",
      {},
      { priority: analysisPriority("SCALE", new Date()) },
    );
    await queue.add(
      "aged-starter",
      {},
      { priority: analysisPriority("STARTER", new Date(Date.now() - 600000)) },
    );
    worker = new Worker(
      name,
      async (job) => {
        order.push(job.name);
      },
      { connection, concurrency: 1 },
    );
    await expect.poll(() => order.length).toBe(3);
    expect(order).toEqual(["scale", "aged-starter", "starter"]);
  } finally {
    await worker?.close();
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
  }
});
it("processes the production queue with fresh requester authorization", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f);
  await new AnalysisProcessor(db, analysisVault, f.discord).process({
    analysisRunId: run.id,
  });
  expect((await service.result(f.s, f.actor, run.id)).run.status).toBe(
    "COMPLETED",
  );
  await expect(
    new AnalysisProcessor(db, analysisVault, f.discord).process({
      analysisRunId: run.id,
      actorRole: "OWNER",
    }),
  ).rejects.toThrow();
});
it("publishes after a heartbeat during calculation and rechecks authorization at finalization", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    claim = (await service.claim(run.id))!;
  let checks = 0;
  await service.execute(
    claim,
    async () => {
      checks++;
    },
    async (...args) => {
      await service.heartbeat(claim);
      return analysisMetrics(...args);
    },
  );
  expect(checks).toBe(2);
  expect((await service.result(f.s, f.actor, run.id)).run.status).toBe(
    "COMPLETED",
  );
});
it("does not publish a result when requester authority is revoked during calculation", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    claim = (await service.claim(run.id))!;
  let checks = 0;
  await service.execute(claim, async () => {
    if (++checks === 2) throw new Error("NEXUS_ROLE_REQUIRED");
  });
  expect((await service.result(f.s, f.actor, run.id)).run.status).toBe(
    "FAILED",
  );
  expect((await service.result(f.s, f.actor, run.id)).result).toBeNull();
  expect((await usage(f)).remaining).toBe(1);
});
it("compares only compatible prior windows, definitions, scopes and recipes", async () => {
  const f = await analysisFixture(db, "STARTER"),
    current = await reserve(f);
  await finish(current);
  const saved = (await service.result(f.s, f.actor, current.id)).result!,
    id = randomUUID(),
    priorStart = new Date(current.period_start.getTime() - 30 * 86400000),
    priorEnd = current.period_start,
    prior = structuredClone(saved);
  for (const metric of prior.metrics) {
    metric.evidence.windowStart = priorStart.toISOString();
    metric.evidence.windowEnd = priorEnd.toISOString();
    if (metric.evidence.value !== null) metric.evidence.value += 1;
  }
  await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,status,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,completed_at) SELECT ${id}::uuid,organization_id,guild_id,scheduler_organization_id,analysis_type,'COMPLETED',${"historical:" + id},${priorStart},${priorEnd},period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,now() FROM analysis_runs WHERE id=${current.id}::uuid`.execute(
    db,
  );
  await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) VALUES(${id}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},${json(prior)})`.execute(
    db,
  );
  const badId = randomUUID();
  await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,status,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,completed_at,requested_at) SELECT ${badId}::uuid,organization_id,guild_id,scheduler_organization_id,analysis_type,status,${"incompatible:" + badId},period_start,period_end,period_days,'incompatible',scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,completed_at,requested_at+interval '1 second' FROM analysis_runs WHERE id=${id}::uuid`.execute(
    db,
  );
  await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) VALUES(${badId}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},${json(prior)})`.execute(
    db,
  );
  // A valid comparison must survive more than 25 newer incompatible results.
  await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,status,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,completed_at,requested_at) SELECT gen_random_uuid(),organization_id,guild_id,scheduler_organization_id,analysis_type,status,${"newer-incompatible:" + badId + ":"}||n::text,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,completed_at,requested_at+n*interval '1 second' FROM analysis_runs CROSS JOIN generate_series(1,30) n WHERE id=${badId}::uuid`.execute(
    db,
  );
  await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) SELECT id,organization_id,guild_id,${json(prior)} FROM analysis_runs WHERE ${tenant(f.s)} AND request_key LIKE ${"newer-incompatible:" + badId + ":%"}`.execute(
    db,
  );
  const comparison = await service.compare(f.s, f.actor, current.id);
  expect(comparison.comparable).toBe(true);
  expect(
    comparison.changes.some((change) => change.before === change.after + 1),
  ).toBe(true);
  await sql`UPDATE analysis_runs SET scope_identity='different' WHERE id=${id}::uuid`.execute(
    db,
  );
  expect((await service.compare(f.s, f.actor, current.id)).comparable).toBe(
    false,
  );
  await sql`UPDATE analysis_runs SET scope_identity=${current.scope_identity},recipe_version='different' WHERE id=${id}::uuid`.execute(
    db,
  );
  expect((await service.compare(f.s, f.actor, current.id)).comparable).toBe(
    false,
  );
});
it("binds analysis components to their actor and guild and rejects forged IDs", async () => {
  const f = await analysisFixture(db),
    g = await analysisFixture(db),
    tokens = new Components("alpha10-signed"),
    token = await tokens.issue(
      db,
      f.s,
      { action: "analysisStart", type: "OVERALL", days: 30 },
      f.actor.key,
    );
  expect(Components.kind(token)).toBe("ephemeral");
  expect(token.length).toBeLessThanOrEqual(100);
  expect((await tokens.read(db, f.s, token, f.actor.key)).action).toBe(
    "analysisStart",
  );
  await expect(tokens.read(db, f.s, token, "other")).rejects.toThrow(
    "COMPONENT_OWNER",
  );
  await expect(tokens.read(db, g.s, token, g.actor.key)).rejects.toThrow(
    "COMPONENT_EXPIRED",
  );
  await expect(tokens.read(db, f.s, token + "x", f.actor.key)).rejects.toThrow(
    "INVALID_COMPONENT",
  );
});
it("runs dispatch → BullMQ → worker → saved history without depending on an interaction token", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f),
    connection = new Redis(infra.redisUrl, { maxRetriesPerRequest: null }),
    queue = new Queue<{ analysisRunId: string }>(
      "analysis-e2e-" + randomUUID(),
      { connection },
    ),
    processor = new AnalysisProcessor(db, analysisVault, f.discord),
    worker = new Worker(queue.name, (job) => processor.process(job.data), {
      connection,
      concurrency: 4,
    });
  try {
    await new AnalysisDispatcher(db, queue).tick();
    await expect
      .poll(async () => (await service.result(f.s, f.actor, run.id)).run.status)
      .toBe("COMPLETED");
    expect((await service.history(f.s, f.actor))[0]?.id).toBe(run.id);
    expect((await usage(f)).consumed).toBe(1);
  } finally {
    await worker.close();
    await queue.close();
    connection.disconnect();
  }
});
it("keeps an aged job ahead of later Scale arrivals across repeated dispatcher ticks", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f);
  await sql`UPDATE analysis_runs SET requested_at=now()-interval '10 minutes' WHERE id=${run.id}::uuid`.execute(
    db,
  );
  const connection = new Redis(infra.redisUrl, { maxRetriesPerRequest: null }),
    queue = new Queue<{ analysisRunId: string }>(
      "analysis-aging-" + randomUUID(),
      { connection },
    ),
    dispatcher = new AnalysisDispatcher(db, queue),
    order: string[] = [];
  let worker: Worker | undefined;
  try {
    await dispatcher.tick();
    const key = queue.toKey("prioritized"),
      before = await connection.zscore(key, "analysis-" + run.id);
    for (let index = 0; index < 5; index++) {
      await queue.add(
        "scale",
        { analysisRunId: randomUUID() },
        { priority: 100 },
      );
      await dispatcher.tick();
    }
    expect(await connection.zscore(key, "analysis-" + run.id)).toBe(before);
    worker = new Worker(
      queue.name,
      async (job) => {
        order.push(job.data.analysisRunId);
      },
      { connection, concurrency: 1 },
    );
    await expect.poll(() => order.length).toBeGreaterThan(0);
    expect(order[0]).toBe(run.id);
  } finally {
    await worker?.close();
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
  }
});
it("direct server privacy deletion removes revisions regenerated by deletion triggers", async () => {
  const f = await analysisFixture(db);
  await reserve(f);
  await new PrivacyService(db, analysisVault, f.settings).delete(
    f.s,
    f.user,
    f.actor,
    true,
  );
  expect(
    (
      await sql`SELECT * FROM analysis_input_revisions WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (await sql`SELECT * FROM analysis_grants WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
});

it("invalidates a previously completed result after a bulk projection correction", async () => {
  const f = await analysisFixture(db),
    run = await reserve(f);
  await finish(run);
  const read = async () =>
    (
      await sql<{
        revision: string;
      }>`SELECT revision FROM analysis_input_revisions WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!.revision;
  const before = BigInt(await read());
  await sql`UPDATE message_observations SET first_reply_seconds=first_reply_seconds+60 WHERE ${tenant(f.s)}`.execute(
    db,
  );
  expect(BigInt(await read())).toBeGreaterThan(before);
  expect(
    (await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 }))
      .duplicate,
  ).toBeNull();
});
it("releases usage when the recipe changes independently during calculation", async () => {
  const f = await analysisFixture(db),
    run = (await service.claim((await reserve(f)).id))!;
  await service.execute(run, undefined, async (...args) => {
    const result = await analysisMetrics(...args);
    await db.transaction().execute(async (tx) => {
      const recipe = await currentRecipe(tx, f.s);
      expect(recipe?.definition).toBeTruthy();
      await saveRecipe(tx, f.s, {
        ...recipe!.definition!,
        voiceThresholdSeconds: recipe!.definition!.voiceThresholdSeconds + 60,
      });
    });
    return result;
  });
  expect((await service.result(f.s, f.actor, run.id)).run.failure_class).toBe(
    "USER_CONFIGURATION",
  );
  expect((await service.result(f.s, f.actor, run.id)).result).toBeNull();
  expect(await usage(f)).toEqual({ remaining: 1, reserved: 0, consumed: 0 });
});
it.each([
  ["GROWTH", 2],
  ["SCALE", 4],
] as const)(
  "enforces the current %s organization allowance across guilds",
  async (plan, allowance) => {
    const fixtures = await Promise.all(
        Array.from({ length: allowance + 1 }, () => analysisFixture(db, plan)),
      ),
      root = fixtures[0]!;
    await sql`INSERT INTO operations_organizations VALUES(${root.s.organizationId}::uuid,'Allowance',${root.s.guildId})`.execute(
      db,
    );
    for (const f of fixtures)
      await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${root.s.organizationId}::uuid,${f.s.organizationId}::uuid,${f.s.guildId})`.execute(
        db,
      );
    const runs = await Promise.all(fixtures.map((f) => reserve(f))),
      claimed = await Promise.all(runs.map((run) => service.claim(run.id)));
    expect(claimed.filter(Boolean)).toHaveLength(allowance);
  },
);

it("interleaves a large queued guild with another organization after organization linking", async () => {
  const f = await analysisFixture(db, "SCALE"),
    other = await analysisFixture(db),
    root = await analysisFixture(db, "SCALE"),
    template = await reserve(f);
  const grant = await service.manualGrant(
    f.s,
    {
      internal: true,
      hash: "scheduler-fixture",
      reason: "scheduler fairness fixture",
    },
    { quantity: 150, sourceIdentity: "scheduler-bulk-" + randomUUID() },
  );
  await db.transaction().execute(async (tx) => {
    await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,requested_at)
   SELECT gen_random_uuid(),organization_id,guild_id,scheduler_organization_id,analysis_type,'bulk:'||n::text,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,requested_at+n*interval '1 microsecond' FROM analysis_runs CROSS JOIN generate_series(1,120) n WHERE id=${template.id}::uuid`.execute(
      tx,
    );
    await sql`UPDATE analysis_grants SET reserved=120 WHERE id=${grant}::uuid`.execute(
      tx,
    );
    await sql`INSERT INTO analysis_reservations(run_id,organization_id,guild_id,grant_id,state) SELECT id,organization_id,guild_id,${grant}::uuid,'RESERVED' FROM analysis_runs WHERE ${tenant(f.s)} AND request_key LIKE 'bulk:%'`.execute(
      tx,
    );
  });
  const otherRun = await reserve(other);
  await sql`INSERT INTO operations_organizations VALUES(${root.s.organizationId}::uuid,'Relinked',${root.s.guildId})`.execute(
    db,
  );
  await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${root.s.organizationId}::uuid,${f.s.organizationId}::uuid,${f.s.guildId})`.execute(
    db,
  );
  const batch = await service.recover();
  expect(batch.length).toBeLessThanOrEqual(100);
  expect(batch.some((run) => run.id === otherRun.id)).toBe(true);
  const moved = batch.find((run) => run.id === template.id)!;
  expect(moved.scheduler_organization_id).toBe(f.s.organizationId);
  expect(
    (moved as AnalysisRun & { current_scheduler_organization_id: string })
      .current_scheduler_organization_id,
  ).toBe(root.s.organizationId);
});
