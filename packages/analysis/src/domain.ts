import { createHash } from "node:crypto";
import { z } from "zod";
import type { MetricEvidence } from "../../shared/src/metric-evidence";
import type { Plan } from "../../settings/src/plan-registry";
export const analysisTypes = [
  "OVERALL",
  "NEW_MEMBERS",
  "SUPPORT",
  "EVENTS",
  "VOICE",
  "ANNOUNCEMENTS",
  "SHOWCASE",
] as const;
export type AnalysisType = (typeof analysisTypes)[number];
export const analysisRequest = z
  .object({
    type: z.enum(analysisTypes),
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    periodStart: z.iso.datetime().optional(),
    periodEnd: z.iso.datetime().optional(),
    correctionOf: z.uuid().optional(),
  })
  .strict()
  .refine((d) => !!d.periodStart === !!d.periodEnd, "INVALID_ANALYSIS_WINDOW")
  .refine(
    (d) =>
      !d.periodStart ||
      Date.parse(d.periodEnd!) - Date.parse(d.periodStart) ===
        d.days * 86400000,
    "INVALID_ANALYSIS_WINDOW",
  );
export type AnalysisRequest = z.infer<typeof analysisRequest>;
export const analysisRecipeVersion = "analysis-observation-v2";
export type AnalysisQuality =
  "COMPLETE" | "PARTIAL" | "NO_DATA" | "NOT_APPLICABLE" | "INSUFFICIENT_SAMPLE";
export type AnalysisFailure =
  | "USER_CONFIGURATION"
  | "INSUFFICIENT_DATA"
  | "AUTHORIZATION"
  | "TRANSIENT_INFRASTRUCTURE"
  | "PERMANENT_INTERNAL"
  | "CANCELED"
  | "UNKNOWN";
export type AnalysisMetric = {
  key: string;
  unit: "COUNT" | "SECONDS";
  evidence: MetricEvidence;
  quality: AnalysisQuality;
};
export type AnalysisResult = {
  schemaVersion: 1;
  summary: "OBSERVED" | "PARTIAL";
  metrics: AnalysisMetric[];
  concerns: {
    key: string;
    metricKey: string;
    reason: "WAITING_RESPONSE";
    value: number;
    evidence: MetricEvidence;
  }[];
  importantChanges: string[];
  baseline?: {
    runId: string;
    changes: {
      key: string;
      before: number;
      after: number;
      unit: AnalysisMetric["unit"];
    }[];
  };
  recommendedActions: string[];
  dataQuality: AnalysisQuality;
  comparisonMetadata: {
    recipeVersion: string;
    scopeIdentity: string;
    periodDays: number;
  };
};
export type Availability =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "REQUIRES_SETUP"
  | "INSUFFICIENT_DATA";
export type AnalysisRun = {
  id: string;
  organization_id: string;
  guild_id: string;
  scheduler_organization_id: string;
  analysis_type: AnalysisType;
  status:
    | "QUEUED"
    | "PREPARING"
    | "RUNNING"
    | "FINALIZING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELED";
  request_key: string;
  requested_by_actor_hash: string | null;
  requested_by_user_ciphertext: string | null;
  requested_at: Date;
  period_start: Date;
  period_end: Date;
  period_days: number;
  recipe_version: string;
  scope_identity: string;
  config_revision: number;
  data_revision: string;
  input_fingerprint: string;
  confirmation_fingerprint?: string | null;
  data_identity?: string | null;
  target_channel_ids?: string[];
  calculated_at?: Date | null;
  invalidated_at?: Date | null;
  invalidation_reason?: "PRIVACY_DELETED" | "DATA_REMOVED" | null;
  conditions?: Record<string, unknown> | null;
  scope_bug_impact?:
    "UNASSESSED" | "POSSIBLE_CATEGORY_PARENT" | "CORRECTED_DEFINITION";
  correction_of?: string | null;
  plan_at_request: Plan;
  priority_class: Plan | "PACK_ONLY";
  attempts: number;
  lease_token: string | null;
  lease_until: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failure_class: AnalysisFailure | null;
  retention_until: Date;
};
export function completedWindow(days: number, now = new Date()) {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return { start: new Date(end.getTime() - days * 86400000), end };
}
export function fingerprint(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function quality(e: MetricEvidence): AnalysisQuality {
  return e.observationState === "UNKNOWN" || e.observationState === "COLLECTING"
    ? "NO_DATA"
    : e.observationState === "NO_ELIGIBLE"
      ? "NOT_APPLICABLE"
      : e.observationState === "INSUFFICIENT_SAMPLE"
        ? "INSUFFICIENT_SAMPLE"
        : e.coverageState === "COMPLETE"
          ? "COMPLETE"
          : "PARTIAL";
}
export function failureClass(error: unknown): AnalysisFailure {
  const message = error instanceof Error ? error.message : "";
  if (
    /AUTHORIZATION|ADMIN_REQUIRED|NEXUS_ROLE|GUILD_MEMBER|PRIVACY_DELETED|Discord HTTP 40[34]/.test(
      message,
    )
  )
    return "AUTHORIZATION";
  if (/NO_DATA|INSUFFICIENT_DATA/.test(message)) return "INSUFFICIENT_DATA";
  if (/CONFIGURATION|REVISION|UNAVAILABLE|PLAN_REQUIRED|INVALID_/.test(message))
    return "USER_CONFIGURATION";
  if (/CANCELED/.test(message)) return "CANCELED";
  const code = (error as { code?: string } | null)?.code;
  if (code?.startsWith("22") || code?.startsWith("23"))
    return "PERMANENT_INTERNAL";
  return "TRANSIENT_INFRASTRUCTURE";
}
