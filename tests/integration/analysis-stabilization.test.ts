import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  connect,
  migrate,
  sql,
  tenant,
  json,
  type Database,
} from "../../packages/db/src/index";
import {
  AnalysisService,
  analysisUsage,
} from "../../packages/analysis/src/index";
import { analysisFixture } from "../fixtures/analysis";
import { infrastructure } from "../fixtures/infrastructure";
import { PrivacyService } from "../../packages/security/src/privacy";
import { analysisVault } from "../fixtures/analysis";
import { analysisMetrics } from "../../packages/analytics/src/analysis";
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
it("corrects an affected legacy result once without consuming another monthly use", async () => {
  const f = await analysisFixture(db),
    original = (
      await service.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
      )
    ).run,
    claim = await service.claim(original.id);
  expect(claim).not.toBeNull();
  await service.execute(claim!);
  await sql`UPDATE analysis_runs SET recipe_version='analysis-observation-v1:default',scope_bug_impact='POSSIBLE_CATEGORY_PARENT' WHERE id=${original.id}::uuid`.execute(
    db,
  );
  const input = {
    type: "OVERALL",
    days: 30,
    periodStart: original.period_start.toISOString(),
    periodEnd: original.period_end.toISOString(),
    correctionOf: original.id,
  };
  const p = await service.preview(f.s, f.actor, input);
  expect(p).toMatchObject({
    consumeCount: 0,
    correctionOf: original.id,
    usage: { remaining: 0, consumed: 1 },
  });
  const requests = await Promise.all([
    service.request(f.s, f.actor, p.request, randomUUID(), {
      revision: p.configRevision,
      fingerprint: p.inputFingerprint,
    }),
    service.request(f.s, f.actor, p.request, randomUUID(), {
      revision: p.configRevision,
      fingerprint: p.inputFingerprint,
    }),
  ]);
  expect(new Set(requests.map((r) => r.run.id)).size).toBe(1);
  expect(requests[0]!.run).toMatchObject({ correction_of: original.id });
  const correctionClaim = await service.claim(requests[0]!.run.id);
  await service.execute(correctionClaim!);
  expect(
    await db.transaction().execute((tx) => analysisUsage(tx, f.s)),
  ).toMatchObject({ remaining: 0, consumed: 1, reserved: 0 });
  const reloaded = await service.request(f.s, f.actor, input, randomUUID());
  expect(reloaded.reused).toBe(true);
  expect(reloaded.run.id).toBe(requests[0]!.run.id);
  await expect(
    service.request(f.s, f.actor, input, randomUUID(), undefined, true),
  ).rejects.toThrow("ANALYSIS_CORRECTION_USED");
  const other = await analysisFixture(db);
  await expect(service.preview(other.s, other.actor, input)).rejects.toThrow(
    "ANALYSIS_CORRECTION_INVALID",
  );
});
it("accepts confirmed conditions after unrelated input revisions and language changes", async () => {
  const f = await analysisFixture(db),
    p = await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 });
  await sql`UPDATE analysis_input_revisions SET revision=revision+1 WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await f.settings.update(f.s, f.actor, p.configRevision, { uiLanguage: "ja" });
  const accepted = await service.request(
    f.s,
    f.actor,
    p.request,
    randomUUID(),
    { revision: p.configRevision, fingerprint: p.inputFingerprint },
  );
  expect(accepted.run.status).toBe("QUEUED");
  expect(accepted.run.period_start).toEqual(p.periodStart);
  expect(accepted.run.period_end).toEqual(p.periodEnd);
});
it("freezes the exact preview window across UTC midnight", async () => {
  const f = await analysisFixture(db),
    p = await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 });
  expect(p.request).toMatchObject({
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(p.periodEnd.getTime() + 86400000 + 1000));
    await sql`UPDATE discord_integration_health SET last_gateway_at=${new Date()},last_refresh_at=${new Date()} WHERE ${tenant(f.s)}`.execute(
      db,
    );
    const { run } = await service.request(
      f.s,
      f.actor,
      p.request,
      randomUUID(),
      { revision: p.configRevision, fingerprint: p.inputFingerprint },
    );
    expect(run.period_start).toEqual(p.periodStart);
    expect(run.period_end).toEqual(p.periodEnd);
  } finally {
    vi.useRealTimers();
  }
});
it("pages beyond five records and rejects another guild's cursor", async () => {
  const f = await analysisFixture(db),
    run = (
      await service.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
      )
    ).run;
  await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,requested_at) SELECT gen_random_uuid(),organization_id,guild_id,scheduler_organization_id,analysis_type,'history:'||n::text,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,requested_at+n*interval '1 microsecond' FROM analysis_runs CROSS JOIN generate_series(1,13) n WHERE id=${run.id}::uuid`.execute(
    db,
  );
  const first = await service.historyPage(f.s, f.actor, { limit: 5 }),
    second = await service.historyPage(f.s, f.actor, {
      limit: 5,
      cursor: first.nextCursor!,
    }),
    third = await service.historyPage(f.s, f.actor, {
      limit: 5,
      cursor: second.nextCursor!,
    });
  expect(
    new Set([...first.runs, ...second.runs, ...third.runs].map((r) => r.id))
      .size,
  ).toBe(14);
  expect(third.nextCursor).toBeNull();
  const previous = await service.historyPage(f.s, f.actor, {
    limit: 5,
    cursor: second.previousCursor!,
    direction: "previous",
  });
  expect(previous.runs.map((r) => r.id)).toEqual(first.runs.map((r) => r.id));
  const other = await analysisFixture(db);
  await expect(
    service.historyPage(other.s, other.actor, { cursor: first.nextCursor! }),
  ).rejects.toThrow("ANALYSIS_CURSOR_INVALID");
});
it("cancels queued analysis exactly once and old delivery cannot claim it", async () => {
  const f = await analysisFixture(db),
    run = (
      await service.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
      )
    ).run;
  const results = await Promise.all([
    service.cancel(f.s, f.actor, run.id),
    service.cancel(f.s, f.actor, run.id),
  ]);
  expect(results.filter((r) => r.canceled)).toHaveLength(1);
  expect(await service.claim(run.id)).toBeNull();
  expect(
    await db.transaction().execute((tx) => analysisUsage(tx, f.s)),
  ).toEqual({ remaining: 1, reserved: 0, consumed: 0 });
});
it("bounds pending intake across service instances without reserving rejected requests", async () => {
  const f = await analysisFixture(db, "SCALE");
  const pending = await Promise.all(
    Array.from({ length: 5 }, () =>
      new AnalysisService(db).request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
        undefined,
        true,
      ),
    ),
  );
  expect(new Set(pending.map((r) => r.run.id)).size).toBe(5);
  await expect(
    service.request(
      f.s,
      f.actor,
      { type: "OVERALL", days: 30 },
      randomUUID(),
      undefined,
      true,
    ),
  ).rejects.toThrow("ANALYSIS_BUSY");
  expect(
    await db.transaction().execute((tx) => analysisUsage(tx, f.s)),
  ).toMatchObject({ remaining: 5, reserved: 5, consumed: 0 });
  await sql`UPDATE analysis_runs SET requested_at=now()-interval '25 hours' WHERE ${tenant(f.s)}`.execute(
    db,
  );
  await service.recover();
  expect(
    await db.transaction().execute((tx) => analysisUsage(tx, f.s)),
  ).toMatchObject({ remaining: 10, reserved: 0, consumed: 0 });
  expect(await service.claim(pending[0]!.run.id)).toBeNull();
});
it("reuses completed data after out-of-period and out-of-place posts, but rejects relevant correction", async () => {
  const f = await analysisFixture(db, "STARTER");
  await f.settings.update(f.s, f.actor, 1, {
    analysisScope: { mode: "include", channelIds: [f.channel] },
  });
  const p = await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 }),
    { run } = await service.request(f.s, f.actor, p.request, randomUUID());
  await service.execute((await service.claim(run.id))!);
  const episode = (
    await sql<{
      id: string;
    }>`SELECT id FROM membership_episodes WHERE ${tenant(f.s)}`.execute(db)
  ).rows[0]!.id;
  for (const [at, channel, id] of [
    [new Date(), f.channel, "444444444444444499"],
    [
      new Date(f.end.getTime() - 1000),
      "933333333333333399",
      "444444444444444498",
    ],
  ] as const)
    await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${at},'PRODUCTION',${json({ channelId: channel, messageId: id })})`.execute(
      db,
    );
  expect((await service.preview(f.s, f.actor, p.request)).duplicate?.id).toBe(
    run.id,
  );
  await sql`UPDATE message_observations SET first_reply_seconds=first_reply_seconds+1 WHERE ${tenant(f.s)} AND sent_at<${f.end}`.execute(
    db,
  );
  expect((await service.preview(f.s, f.actor, p.request)).duplicate).toBeNull();
});
it("rechecks current authorization and permits display-only settings during execution", async () => {
  const f = await analysisFixture(db),
    p = await service.preview(f.s, f.actor, { type: "OVERALL", days: 30 });
  await expect(
    service.request(
      f.s,
      { ...f.actor, permissions: "0", roles: [] },
      p.request,
      randomUUID(),
      { revision: p.configRevision, fingerprint: p.inputFingerprint },
    ),
  ).rejects.toThrow("ADMIN_REQUIRED");
  const { run } = await service.request(f.s, f.actor, p.request, randomUUID());
  await f.settings.update(f.s, f.actor, p.configRevision, { uiLanguage: "ja" });
  await service.execute((await service.claim(run.id))!);
  expect((await service.result(f.s, f.actor, run.id)).run.status).toBe(
    "COMPLETED",
  );
});
it("preserves history and charges while invalidating aggregates affected by privacy deletion", async () => {
  const f = await analysisFixture(db),
    { run } = await service.request(
      f.s,
      f.actor,
      { type: "OVERALL", days: 30 },
      randomUUID(),
    );
  await service.execute((await service.claim(run.id))!);
  await new PrivacyService(db, analysisVault, f.settings).delete(
    f.s,
    f.user,
    f.actor,
    false,
  );
  const operator = {
    ...f.actor,
    key: "remaining-admin",
    encryptedUserId: undefined,
  };
  await expect(service.result(f.s, operator, run.id)).rejects.toThrow(
    "ANALYSIS_DATA_REMOVED",
  );
  const history = await service.history(f.s, operator);
  expect(history.find((r) => r.id === run.id)?.invalidation_reason).toBe(
    "PRIVACY_DELETED",
  );
  expect(
    (
      await sql`SELECT run_id FROM analysis_usage_ledger WHERE ${tenant(f.s)} AND outcome='CONSUMED'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("hides saved aggregate concerns across every access path after target permission loss", async () => {
  const f = await analysisFixture(db),
    run = (
      await service.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
      )
    ).run;
  await service.execute((await service.claim(run.id))!);
  const result = (await service.result(f.s, f.actor, run.id)).result!;
  expect(result.concerns).not.toHaveLength(0);
  const key = await service.attention(
    f.s,
    f.actor,
    run.id,
    result.concerns[0]!.key,
  );
  expect(await service.attentionList(f.s, f.actor)).toHaveLength(1);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,visibility_state,observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${f.channel},0,'HIDDEN',now()) ON CONFLICT(organization_id,guild_id,channel_id) DO UPDATE SET visibility_state='HIDDEN',observed_at=now()`.execute(
    db,
  );
  await expect(service.result(f.s, f.actor, run.id)).rejects.toThrow(
    "ANALYSIS_TARGET_UNAVAILABLE",
  );
  await expect(
    service.attention(f.s, f.actor, run.id, result.concerns[0]!.key),
  ).rejects.toThrow("ANALYSIS_TARGET_UNAVAILABLE");
  expect(await service.attentionList(f.s, f.actor)).toEqual([]);
  await expect(service.attentionItem(f.s, f.actor, key)).rejects.toThrow();
  await expect(
    service.attentionUpdate(f.s, f.actor, key, 0, "ACKNOWLEDGED"),
  ).rejects.toThrow();
});
it("removes inaccessible comparison candidates and saved baseline values without rewriting results", async () => {
  const f = await analysisFixture(db),
    current = (
      await service.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
      )
    ).run;
  await service.execute((await service.claim(current.id))!);
  const saved = (await service.result(f.s, f.actor, current.id)).result!,
    priorId = randomUUID(),
    displayId = randomUUID(),
    thread = "933333333333333392";
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,parent_id,visibility_state,observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${thread},11,${f.channel},'VISIBLE',now())`.execute(
    db,
  );
  const before = structuredClone(saved);
  for (const metric of before.metrics) {
    metric.evidence.windowStart = new Date(
      current.period_start.getTime() - 30 * 86400000,
    ).toISOString();
    metric.evidence.windowEnd = current.period_start.toISOString();
    if (metric.evidence.value !== null) metric.evidence.value += 1;
  }
  await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,status,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,target_channel_ids) SELECT ${priorId}::uuid,organization_id,guild_id,scheduler_organization_id,analysis_type,'COMPLETED',${priorId},period_start-interval '30 days',period_start,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,ARRAY[${thread}] FROM analysis_runs WHERE id=${current.id}::uuid`.execute(
    db,
  );
  await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) VALUES(${priorId}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},${json(before)})`.execute(
    db,
  );
  expect((await service.compare(f.s, f.actor, current.id)).comparable).toBe(
    true,
  );
  const display = structuredClone(saved);
  display.baseline = {
    runId: priorId,
    changes: [{ key: "observed_posts", before: 8, after: 7, unit: "COUNT" }],
  };
  await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,status,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,target_channel_ids) SELECT ${displayId}::uuid,organization_id,guild_id,scheduler_organization_id,analysis_type,'COMPLETED',${displayId},period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until,target_channel_ids FROM analysis_runs WHERE id=${current.id}::uuid`.execute(
    db,
  );
  await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) VALUES(${displayId}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},${json(display)})`.execute(
    db,
  );
  expect(
    (await service.result(f.s, f.actor, displayId)).result?.baseline?.runId,
  ).toBe(priorId);
  await sql`UPDATE discord_surface_state SET visibility_state='HIDDEN' WHERE ${tenant(f.s)} AND channel_id=${thread}`.execute(
    db,
  );
  expect((await service.compare(f.s, f.actor, current.id)).comparable).toBe(
    false,
  );
  expect(
    (await service.result(f.s, f.actor, displayId)).result?.baseline,
  ).toBeUndefined();
  expect(
    (
      await sql<{
        id: string;
      }>`SELECT result->'baseline'->>'runId' AS id FROM analysis_results WHERE run_id=${displayId}::uuid`.execute(
        db,
      )
    ).rows[0]?.id,
  ).toBe(priorId);
});
it("fences privacy deletion of a guest in a newly inherited thread between compute and publication", async () => {
  const f = await analysisFixture(db),
    run = (
      await service.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
      )
    ).run,
    thread = "933333333333333391",
    guest = "222222222222222299",
    guestHash = analysisVault.hash(f.s, guest);
  expect(run.target_channel_ids).not.toContain(thread);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,parent_id,visibility_state,observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${thread},11,${f.channel},'VISIBLE',now())`.execute(
    db,
  );
  await sql`INSERT INTO location_post_observations(organization_id,guild_id,message_id,channel_id,sent_at,author_kind,subject_hash,message_type) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${thread},${thread},${new Date(f.end.getTime() - 86400000)},'HUMAN',${guestHash},0)`.execute(
    db,
  );
  let deletion: Promise<void> | undefined;
  await service.execute(
    (await service.claim(run.id))!,
    undefined,
    async (...args) => {
      const calculated = await analysisMetrics(...args);
      deletion = new PrivacyService(db, analysisVault, f.settings).delete(
        f.s,
        guest,
        {
          ...f.actor,
          key: guestHash,
          encryptedUserId: analysisVault.seal(f.s, guest),
        },
        false,
      );
      await expect
        .poll(
          async () =>
            (
              await sql`SELECT pid FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted`.execute(
                db,
              )
            ).rows.length,
        )
        .toBeGreaterThan(0);
      return calculated;
    },
  );
  await deletion;
  const history = await service.history(f.s, f.actor);
  expect(history.find((r) => r.id === run.id)).toMatchObject({
    status: "FAILED",
    invalidation_reason: "PRIVACY_DELETED",
  });
  expect(
    (
      await sql`SELECT run_id FROM analysis_results WHERE run_id=${run.id}::uuid`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  expect(
    await db.transaction().execute((tx) => analysisUsage(tx, f.s)),
  ).toMatchObject({ remaining: 1, reserved: 0, consumed: 0 });
});
it("limits preview bursts across service instances without consuming an analysis use", async () => {
  const f = await analysisFixture(db),
    other = new AnalysisService(db);
  for (let i = 0; i < 12; i++)
    await (i % 2 ? service : other).preview(f.s, f.actor, {
      type: "OVERALL",
      days: 30,
    });
  await expect(
    other.preview(f.s, f.actor, { type: "OVERALL", days: 30 }),
  ).rejects.toThrow("ANALYSIS_PREVIEW_BUSY");
  expect(
    await db.transaction().execute((tx) => analysisUsage(tx, f.s)),
  ).toEqual({ remaining: 1, reserved: 0, consumed: 0 });
});
