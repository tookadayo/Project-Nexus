import { beforeAll, afterAll, it, expect } from "vitest";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { cpus, totalmem, platform } from "node:os";
import { writeFile, mkdir } from "node:fs/promises";
import {
  connect,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";
import { AnalysisService } from "../../packages/analysis/src/index";
import { analysisMetrics } from "../../packages/analytics/src/analysis";
import { BillingService } from "../../packages/settings/src/billing/service";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { Components, scopeForGuild } from "../../packages/security/src/index";
import { createInteractionServer } from "../../apps/interaction/src/server";
import { InteractionWorker } from "../../apps/worker/src/interactions";
import { ActionWorker } from "../../apps/worker/src/actions";
import { analysisFixture, analysisVault } from "../fixtures/analysis";
import { infrastructure } from "../fixtures/infrastructure";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
it("measures real concurrent aggregate SQL, signed network ACKs and private screen delivery", async () => {
  const fixtures = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        analysisFixture(
          db,
          "FREE",
          true,
          scopeForGuild(String(911111111111111110n + BigInt(index))),
        ),
      ),
    ),
    service = new AnalysisService(db),
    rowsPerGuild = 20000;
  for (const f of fixtures)
    await sql`INSERT INTO location_post_observations(organization_id,guild_id,message_id,channel_id,sent_at,author_kind,message_type) SELECT ${f.s.organizationId}::uuid,${f.s.guildId},'synthetic:'||n,${f.channel},${new Date(f.end.getTime() - 86400000)},'UNKNOWN',0 FROM generate_series(1,${rowsPerGuild}) n`.execute(
      db,
    );
  await sql`ANALYZE location_post_observations`.execute(db);
  const runs = await Promise.all(
    fixtures.map(
      async (f) =>
        (
          await service.request(
            f.s,
            f.actor,
            { type: "OVERALL", days: 30 },
            randomUUID(),
          )
        ).run,
    ),
  );
  const claims = await Promise.all(runs.map((r) => service.claim(r.id))),
    keys = generateKeyPairSync("ed25519"),
    first = fixtures[0]!;
  const tokens = new Components("performance-test"),
    onboarding = new OnboardingService(db, first.settings, analysisVault),
    interactionWorker = new InteractionWorker(
      db,
      analysisVault,
      tokens,
      first.discord,
      first.settings,
      onboarding,
      async () => {},
    ),
    actionWorker = new ActionWorker(
      db,
      analysisVault,
      first.discord,
      onboarding,
    );
  const app = createInteractionServer({
    db,
    vault: analysisVault,
    components: tokens,
    discord: first.discord,
    publicKey: keys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex"),
    applicationId: "777777777777777777",
  });
  const origin = await app.listen({ port: 0, host: "127.0.0.1" });
  let running = 4,
    maxDatabaseActive = 0,
    networkDuringAnalysis = 0;
  const networkAck: number[] = [],
    injectionAck: number[] = [],
    screens: number[] = [],
    poolWait: number[] = [],
    billing: number[] = [],
    calculation: number[] = [];
  const cpu = process.cpuUsage(),
    at = performance.now();
  const analyses = claims.map(async (run) => {
    const start = performance.now();
    try {
      await service.execute(run!, undefined, async (...args) => {
        // Each pass executes production aggregation SQL; no artificial gate/sleep.
        let result = await analysisMetrics(...args);
        for (let pass = 1; pass < 3; pass++)
          result = await analysisMetrics(...args);
        return result;
      });
    } finally {
      calculation.push(performance.now() - start);
      running--;
    }
  });
  try {
    for (let index = 0; index < 10; index++) {
      const body = JSON.stringify({
          id: String(788888888888888880n + BigInt(index)),
          application_id: "777777777777777777",
          type: 2,
          token: "test-only",
          guild_id: first.s.guildId,
          member: { user: { id: first.user }, permissions: "8", roles: [] },
          data: { name: "nexus", options: [{ name: "panel" }] },
        }),
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
      const started = performance.now();
      if (running) networkDuringAnalysis++;
      const response = await fetch(origin + "/interactions", {
        method: "POST",
        headers,
        body,
      });
      networkAck.push(performance.now() - started);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { type: number }).type).toBe(5);
      const sample = (
        await sql<{
          active: number;
        }>`SELECT count(*)::int AS active FROM pg_stat_activity WHERE state='active' AND pid<>pg_backend_pid() AND query LIKE '%location_post_observations%'`.execute(
          db,
        )
      ).rows[0]!;
      maxDatabaseActive = Math.max(maxDatabaseActive, sample.active);
      const beforePool = performance.now();
      await db.connection().execute(async () => {
        poolWait.push(performance.now() - beforePool);
      });
      const beforeBilling = performance.now();
      await new BillingService(db, analysisVault).view(first.s);
      billing.push(performance.now() - beforeBilling);
      await expect.poll(async () => interactionWorker.tick(first.s)).toBe(true);
      await actionWorker.tick(first.s);
      screens.push(performance.now() - started);
      expect(first.discord.calls).toContain("editReply");
    }
    const raw = JSON.stringify({
        id: "788888888888888999",
        application_id: "777777777777777777",
        type: 1,
      }),
      timestamp = String(Math.floor(Date.now() / 1000)),
      before = performance.now();
    const injected = await app.inject({
      method: "POST",
      url: "/interactions",
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-signature-timestamp": timestamp,
        "x-signature-ed25519": sign(
          null,
          Buffer.from(timestamp + raw),
          keys.privateKey,
        ).toString("hex"),
      },
    });
    injectionAck.push(performance.now() - before);
    expect(injected.statusCode).toBe(200);
    await Promise.all(analyses);
    expect(networkDuringAnalysis).toBeGreaterThan(0);
    expect(maxDatabaseActive).toBeGreaterThanOrEqual(2);
    expect(Math.max(...networkAck)).toBeLessThan(3000);
    for (const [index, f] of fixtures.entries())
      expect(
        (await service.result(f.s, f.actor, runs[index]!.id)).run.status,
      ).toBe("COMPLETED");
    // Keep the main 80k location / 28 member post fixture unchanged. This
    // separate probe measures the shared revision row, not overlapping bulk
    // post locks (the former all-post UPDATE exposed a CI tuple-recheck deadlock).
    const probeMessageIds = Array.from({length:10},(_,index)=>String(799999999999999900n+BigInt(index))),
      probeEpisode = (await sql<{episode_id:string}>`SELECT episode_id FROM message_observations WHERE organization_id=${first.s.organizationId}::uuid AND guild_id=${first.s.guildId} LIMIT 1`.execute(db)).rows[0]!.episode_id;
    await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data)
     SELECT ${first.s.organizationId}::uuid,${first.s.guildId},gen_random_uuid(),${probeEpisode}::uuid,'message.sent',${new Date(first.end.getTime()-3600000)},'PRODUCTION',jsonb_build_object('channelId',${first.channel}::text,'messageId',message_id,'firstReplyLatencySeconds',0)
     FROM unnest(${probeMessageIds}::text[]) AS probe(message_id)`.execute(db);
    const revisionBefore = (await sql<{revision:number}>`SELECT revision::int AS revision FROM analysis_input_revisions WHERE organization_id=${first.s.organizationId}::uuid AND guild_id=${first.s.guildId}`.execute(db)).rows[0]!.revision;
    const revisionWriteMs: number[] = [];
    for (let batch = 0; batch < 5; batch++)
      await Promise.all(
        probeMessageIds.map(async messageId => {
          const started = performance.now();
          const updated = await sql<{message_id:string;first_reply_seconds:number}>`UPDATE message_observations SET first_reply_seconds=first_reply_seconds+1 WHERE organization_id=${first.s.organizationId}::uuid AND guild_id=${first.s.guildId} AND message_id=${messageId} RETURNING message_id,first_reply_seconds`.execute(
            db,
          );
          revisionWriteMs.push(performance.now() - started);
          expect(updated.rows).toEqual([{message_id:messageId,first_reply_seconds:batch+1}]);
        }),
      );
    expect(revisionWriteMs).toHaveLength(50);
    const probeRows = (await sql<{message_id:string;first_reply_seconds:number}>`SELECT message_id,first_reply_seconds FROM message_observations WHERE organization_id=${first.s.organizationId}::uuid AND guild_id=${first.s.guildId} AND message_id=ANY(${probeMessageIds}::text[]) ORDER BY message_id`.execute(db)).rows,
      revisionAfter = (await sql<{revision:number}>`SELECT revision::int AS revision FROM analysis_input_revisions WHERE organization_id=${first.s.organizationId}::uuid AND guild_id=${first.s.guildId}`.execute(db)).rows[0]!.revision;
    expect(probeRows).toEqual(probeMessageIds.map(message_id=>({message_id,first_reply_seconds:5})));
    expect(revisionAfter-revisionBefore).toBe(50);
    const database = (
      await sql`SELECT version() AS version,(SELECT numbackends FROM pg_stat_database WHERE datname=current_database()) AS connections,(SELECT blks_hit FROM pg_stat_database WHERE datname=current_database()) AS cache_hits,(SELECT blks_read FROM pg_stat_database WHERE datname=current_database()) AS blocks_read`.execute(
        db,
      )
    ).rows[0];
    const result = {
      environment: process.env.GITHUB_ACTIONS === "true" ? "GITHUB_ACTIONS" : process.env.CI ? "CI" : "LOCAL",
      platform: platform(),
      cpuModel: cpus()[0]?.model,
      cpuCount: cpus().length,
      ramBytes: totalmem(),
      node: process.version,
      postgres: database,
      redis: process.env.NEXUS_TEST_INFRA === "docker" ? "isolated Redis 8 Docker container" : "local Redis binary; isolated port; persistence disabled",
      fixture: { guilds: 4, locationPosts: rowsPerGuild * 4, memberPosts: 28 },
      concurrentAnalyses: 4,
      interactions: 10,
      aggregatePassesPerRun: 3,
      maxDatabaseActive,
      networkDuringAnalysis,
      networkAckMs: networkAck,
      injectionPingMs: injectionAck,
      privateScreenMs: screens,
      queueDelayMs: claims.map(
        (r) => r!.started_at!.getTime() - r!.requested_at.getTime(),
      ),
      calculationMs: calculation,
      poolAcquisitionMs: poolWait,
      billingViewMs: billing,
      nodeCpuMicroseconds: process.cpuUsage(cpu),
      globalRevisionContention: {
        concurrentWrites: 10,
        totalWrites: 50,
        successfulStatements: revisionWriteMs.length,
        probeRows: probeMessageIds.length,
        perPostIncrements: 5,
        revisionDelta: revisionAfter-revisionBefore,
        source:
          "distinct message_observations row per writer; existing shared statement revision trigger",
        writeMs: revisionWriteMs,
      },
      nodeRssBytes: process.memoryUsage().rss,
      totalMs: performance.now() - at,
      liveDiscord: "NOT RUN",
      hosted: "NOT RUN",
    };
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/analysis-active-performance.json",
      JSON.stringify(result, null, 2),
    );
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    await Promise.all(analyses);
    await app.close();
  }
});
