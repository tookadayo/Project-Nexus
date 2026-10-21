import { z } from "zod";
import { sql, type Database } from "../../../packages/db/src/index";
import type { Alpha16Operator } from "../../../packages/security/src/alpha16-operator";

export const operatorMaintenanceConfigSchema = z.object({
  enabled: z.boolean(),
  policyRevision: z.string().min(1).nullable(),
  policyApproved: z.boolean(),
  writerCoverageVerified: z.boolean(),
  batchSize: z.number().safe().int().positive().max(1000).nullable(),
}).strict();
export type OperatorMaintenanceConfig = z.infer<typeof operatorMaintenanceConfigSchema>;
export function unconfiguredOperatorMaintenance(): OperatorMaintenanceConfig {
  return { enabled: false, policyRevision: null, policyApproved: false, writerCoverageVerified: false, batchSize: null };
}
export function operatorMaintenanceReadiness(input: OperatorMaintenanceConfig) {
  const config = operatorMaintenanceConfigSchema.parse(input);
  const blockers: string[] = [];
  if (!config.enabled) blockers.push("OPERATOR_MAINTENANCE_DISABLED");
  if (!config.policyApproved || !config.policyRevision) blockers.push("OPERATOR_POLICY_UNAPPROVED");
  if (!config.writerCoverageVerified) blockers.push("DELETION_WRITER_COVERAGE_UNVERIFIED");
  if (config.batchSize === null) blockers.push("MAINTENANCE_BATCH_POLICY_REQUIRED");
  return { enabled: blockers.length === 0, blockers };
}

/** Startup calls this before normal publish/evaluation/dispatch. It does not
 * start a timer or enable another worker. The supervisor may advance only when
 * ready=true; a bounded incomplete pass remains blocked until a later pass. */
export class Alpha16OperatorMaintenance {
  constructor(private readonly db: Database, private readonly operator: Alpha16Operator,
    private readonly configuration: () => Promise<OperatorMaintenanceConfig> = async () => unconfiguredOperatorMaintenance()) {}
  async startupPass() { return this.tick(); }
  async tick() {
    const config = operatorMaintenanceConfigSchema.parse(await this.configuration());
    const readiness = operatorMaintenanceReadiness(config);
    if (!readiness.enabled) return { ready: false, processed: 0, blockers: readiness.blockers };
    const expiry = await this.operator.purgeEphemeral();
    if (!expiry.ready) return { ready: false, processed: 0, blockers: [expiry.blockingReason!] };
    const jobs = (await sql<{ id: string }>`SELECT id FROM alpha16_privacy_jobs WHERE state IN ('QUEUED','PARTIAL_FAILURE','RUNNING') AND expires_at>clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,id LIMIT ${config.batchSize!}`.execute(this.db)).rows;
    let processed = 0;
    for (const job of jobs) {
      try {
        const result = await this.operator.processDeletion(job.id);
        if (result.processed) processed++;
      } catch {
        return { ready: false, processed, blockers: ["PRIVACY_DEPENDENCY_UNAVAILABLE"] };
      }
    }
    const pending = (await sql`SELECT id FROM alpha16_privacy_jobs WHERE state<>'LIVE_COMPLETED' LIMIT 1`.execute(this.db)).rows.length > 0;
    return { ready: !pending, processed, blockers: pending ? ["DELETION_PURGE_PENDING"] : [] };
  }
}
