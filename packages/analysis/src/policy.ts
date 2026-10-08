import type { Plan } from "../../settings/src/plan-registry";
export const analysisPolicy = {
  queue: "nexus-analysis",
  leaseSeconds: 120,
  maxAttempts: 3,
  agingIntervalMs: 60000,
  agingStep: 100,
  minimumPriority: 100,
  guildConcurrency: 1,
  dispatchBatch: 100,
} as const;
const priorities: Record<Plan | "PACK_ONLY", number> = {
  SCALE: 100,
  ENTERPRISE: 100,
  GROWTH: 300,
  STARTER: 500,
  PACK_ONLY: 600,
  FREE: 900,
};
export function analysisPriority(
  plan: Plan | "PACK_ONLY",
  requestedAt: Date,
  now = new Date(),
) {
  const age = Math.max(0, now.getTime() - requestedAt.getTime());
  return Math.max(
    analysisPolicy.minimumPriority,
    priorities[plan] -
      Math.floor(age / analysisPolicy.agingIntervalMs) *
        analysisPolicy.agingStep,
  );
}
