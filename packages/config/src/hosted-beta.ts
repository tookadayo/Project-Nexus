import { z } from "zod";

// Production cannot silently opt out of invitation admission. Local legacy
// fixtures keep their original behavior unless they explicitly enable Beta.
export function hostedBetaEnabled(env: NodeJS.ProcessEnv = process.env) {
  const value = z.enum(["on", "off"]).optional().parse(env.NEXUS_HOSTED_BETA);
  if (env.NODE_ENV === "production" && value === "off")
    throw new Error("HOSTED_BETA_REQUIRED");
  return value === "on" || env.NODE_ENV === "production";
}
export const betaLimitsSchema = z
  .object({
    monthly: z.number().int().min(1).max(20).default(20),
    daily: z.number().int().min(1).max(3).default(3),
    guildPending: z.number().int().min(1).max(2).default(2),
    globalPending: z.number().int().min(1).max(10).default(10),
  })
  .strict();
export type BetaLimits = z.infer<typeof betaLimitsSchema>;
export const betaDefaults = betaLimitsSchema.parse({});
export const BETA_ACTIVE_MAX = 10;
export const BETA_INVITATION_DAYS = 30;
export const BETA_GRACE_DAYS = 30;
