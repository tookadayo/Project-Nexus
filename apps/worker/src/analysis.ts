import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { z } from "zod";
import { assert } from "../../../packages/shared/src/index";
import { sql, type Database } from "../../../packages/db/src/index";
import {
  AnalysisService,
  analysisPolicy,
  analysisPriority,
} from "../../../packages/analysis/src/index";
import {
  analysisEvent,
  analysisQueueMetrics,
} from "../../../packages/analysis/src/telemetry";
import { ServerAuthorization } from "../../../packages/security/src/server-authorization";
import { operationsAccess } from "../../../packages/operations/src/policy";
import { SettingsService } from "../../../packages/settings/src/index";
import { logFailure } from "../../../packages/shared/src/diagnostics";
import type { IdentityVault } from "../../../packages/identity/src/index";
import type { DiscordPort } from "../../../packages/discord/src/rest";
const payload = z.object({ analysisRunId: z.uuid() }).strict();
export class AnalysisProcessor {
  private readonly service: AnalysisService;
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly discord: DiscordPort,
  ) {
    this.service = new AnalysisService(db);
  }
  async process(data: unknown) {
    const { analysisRunId } = payload.parse(data),
      run = await this.service.claim(analysisRunId);
    if (!run) return;
    const s = { organizationId: run.organization_id, guildId: run.guild_id };
    const heartbeat = setInterval(() => {
      void this.service
        .heartbeat(run)
        .catch((error) =>
          logFailure({ action: "analysis", stage: "lease_heartbeat", error }),
        );
    }, 30000);
    heartbeat.unref();
    try {
      await this.service.execute(run, async (tx) => {
        if (!run.requested_by_user_ciphertext)
          throw new Error("AUTHORIZATION_UNAVAILABLE");
        const snapshot = await new ServerAuthorization(
          this.discord,
          new SettingsService(tx ?? this.db),
          this.vault,
        ).snapshot(
          s,
          this.vault.open(s, run.requested_by_user_ciphertext),
          "DISCORD_PANEL",
          run.id,
        );
        assert(
          !snapshot.member.bot && Date.now() - snapshot.checkedAt <= 10000,
          "AUTHORIZATION_EXPIRED",
          403,
        );
        if (tx) await operationsAccess(tx, s, snapshot.actor, "ANALYZE");
        else
          await this.db
            .transaction()
            .execute((t) => operationsAccess(t, s, snapshot.actor, "ANALYZE"));
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
export class AnalysisDispatcher {
  private readonly service: AnalysisService;
  constructor(
    private readonly db: Database,
    private readonly queue: Queue<{ analysisRunId: string }>,
  ) {
    this.service = new AnalysisService(db);
  }
  async tick() {
    const rows = await this.service.recover();
    for (const run of rows) {
      const id = "analysis-" + run.id,
        existing = await this.queue.getJob(id),
        priority = analysisPriority(run.priority_class, run.requested_at);
      if (existing) {
        const state = await existing.getState();
        if (
          (state === "prioritized" ||
            state === "waiting" ||
            state === "delayed") &&
          existing.priority !== priority
        )
          await existing.changePriority({ priority });
        else if (state === "completed" || state === "failed") {
          await existing.remove();
          await this.queue.add(
            "analysis",
            { analysisRunId: run.id },
            {
              jobId: id,
              priority,
              removeOnComplete: true,
              removeOnFail: true,
              attempts: 1,
            },
          );
        }
      } else {
        await this.queue.add(
          "analysis",
          { analysisRunId: run.id },
          {
            jobId: id,
            priority,
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 1,
          },
        );
        analysisEvent("analysis_enqueued");
      }
      await sql`UPDATE analysis_runs SET enqueued_at=COALESCE(enqueued_at,now()),updated_at=now() WHERE id=${run.id}::uuid AND status='QUEUED'`.execute(
        this.db,
      );
    }
    const counts = await this.queue.getJobCounts(
      "wait",
      "active",
      "prioritized",
    );
    const [summary] = (
      await sql<{
        oldest: number;
        failure_rate: number;
      }>`SELECT COALESCE((SELECT extract(epoch FROM now()-min(requested_at))*1000 FROM analysis_runs WHERE status='QUEUED'),0)::float AS oldest,COALESCE(count(*) FILTER(WHERE status='FAILED')::float/NULLIF(count(*) FILTER(WHERE status IN ('FAILED','COMPLETED')),0),0) AS failure_rate FROM analysis_runs WHERE requested_at>now()-interval '1 day'`.execute(
        this.db,
      )
    ).rows;
    analysisQueueMetrics({
      waiting: counts.wait ?? 0,
      active: counts.active ?? 0,
      prioritized: counts.prioritized ?? 0,
      oldest_waiting_ms: summary?.oldest ?? 0,
      failure_rate: summary?.failure_rate ?? 0,
    });
  }
}
export function analysisRuntime(
  db: Database,
  vault: IdentityVault,
  discord: DiscordPort,
  connection: ConnectionOptions,
) {
  const queue = new Queue<{ analysisRunId: string }>(analysisPolicy.queue, {
      connection,
    }),
    processor = new AnalysisProcessor(db, vault, discord),
    dispatcher = new AnalysisDispatcher(db, queue);
  const worker = new Worker(
    analysisPolicy.queue,
    (job) => processor.process(job.data),
    { connection, concurrency: 4 },
  );
  worker.on("error", (error) =>
    logFailure({ action: "analysis", stage: "queue_worker", error }),
  );
  // Independent maintenance prevents heavy analysis recovery from delaying interaction polling.
  let busy = false;
  const recover = () => {
    if (busy) return;
    busy = true;
    void dispatcher
      .tick()
      .catch((error) =>
        logFailure({ action: "analysis", stage: "dispatch_recovery", error }),
      )
      .finally(() => {
        busy = false;
      });
  };
  const timer = setInterval(recover, 1000);
  timer.unref();
  recover();
  return {
    queue,
    worker,
    dispatcher,
    async close() {
      clearInterval(timer);
      await worker.close();
      await queue.close();
    },
  };
}
