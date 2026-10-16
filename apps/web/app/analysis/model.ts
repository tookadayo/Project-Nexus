import { z } from "zod";
import { analysisRequest, type AnalysisRun } from "../../../../packages/analysis/src/domain";

export const analysisStartSchema = z.object({ request: analysisRequest,
  expected: z.object({ revision: z.number().int().nonnegative(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict();
/** Request/id/lease/actor identity and collected target IDs stay server-side. */
export function analysisRunDto(run: AnalysisRun) {
  return { id: run.id, analysisType: run.analysis_type, status: run.status, requestedAt: run.requested_at.toISOString(),
    periodStart: run.period_start.toISOString(), periodEnd: run.period_end.toISOString(), periodDays: run.period_days,
    startedAt: run.started_at?.toISOString() ?? null, completedAt: run.completed_at?.toISOString() ?? null,
    retentionUntil: run.retention_until.toISOString(), failureClass: run.failure_class, invalidated: Boolean(run.invalidated_at),
    correctionOf: run.correction_of ?? null };
}
export type AnalysisRunDto = ReturnType<typeof analysisRunDto>;
