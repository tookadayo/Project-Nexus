import { beforeAll, afterAll, it, expect } from "vitest";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { connect, migrate, type Database } from "../../packages/db/src/index";
import {
  AnalysisService,
  analysisPriority,
} from "../../packages/analysis/src/index";
import { analysisMetrics } from "../../packages/analytics/src/analysis";
import { analysisFixture, analysisVault } from "../fixtures/analysis";
import { infrastructure } from "../fixtures/infrastructure";
import { createInteractionServer } from "../../apps/interaction/src/server";
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
it("acknowledges signed Discord interactions while four analysis jobs hold calculation connections", async () => {
  const fixtures = await Promise.all(
      Array.from({ length: 4 }, () => analysisFixture(db)),
    ),
    service = new AnalysisService(db),
    connection = new Redis(infra.redisUrl, { maxRetriesPerRequest: null }),
    queue = new Queue("analysis-ack-" + randomUUID(), { connection });
  let persisted = 0;
  let started = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    durations: number[] = [];
  const worker = new Worker(
    queue.name,
    async (job) => {
      const run = await service.claim(job.data.analysisRunId);
      if (!run) return;
      await service.execute(run, undefined, async (...args) => {
        started++;
        await gate;
        return analysisMetrics(...args);
      });
    },
    { connection, concurrency: 4 },
  );
  const keys = generateKeyPairSync("ed25519"),
    app = createInteractionServer({
      db,
      vault: analysisVault,
      publicKey: keys.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("hex"),
      applicationId: "777777777777777777",
      wake: async () => {
        persisted++;
      },
    });
  try {
    for (const f of fixtures) {
      const { run } = await service.request(
        f.s,
        f.actor,
        { type: "OVERALL", days: 30 },
        randomUUID(),
      );
      await queue.add(
        "analysis",
        { analysisRunId: run.id },
        { priority: analysisPriority(run.priority_class, run.requested_at) },
      );
    }
    await expect.poll(() => started).toBe(4);
    for (let index = 0; index < 10; index++) {
      const f = fixtures[0]!,
        body = JSON.stringify({
          id: String(788888888888888880n + BigInt(index)),
          application_id: "777777777777777777",
          type: 2,
          token: "test-only",
          guild_id: f.s.guildId,
          member: { user: { id: f.user }, permissions: "8", roles: [] },
          data: { name: "nexus", options: [{ name: "panel" }] },
        }),
        timestamp = String(Math.floor(Date.now() / 1000)),
        at = performance.now();
      const response = await app.inject({
        method: "POST",
        url: "/interactions",
        payload: body,
        headers: {
          "content-type": "application/json",
          "x-signature-timestamp": timestamp,
          "x-signature-ed25519": sign(
            null,
            Buffer.from(timestamp + body),
            keys.privateKey,
          ).toString("hex"),
        },
      });
      durations.push(performance.now() - at);
      expect(response.statusCode).toBe(200);
      expect(response.json().type).toBe(5);
    }
    expect(Math.max(...durations)).toBeLessThan(3000);
    // ACK precedes asynchronous persistence. Drain the ten acknowledged writes
    // before closing pg-pool, rather than racing teardown against queued acquisitions.
    await expect.poll(() => persisted).toBe(10);
    process.stdout.write(
      JSON.stringify({
        analysisActive: started,
        signedAcks: durations.length,
        maxAckMs: Math.round(Math.max(...durations)),
      }) + "\n",
    );
  } finally {
    release();
    await worker.close();
    await queue.close();
    connection.disconnect();
    await app.close();
  }
});
