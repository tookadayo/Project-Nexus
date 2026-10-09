import { z } from "zod";
import { hostedBetaEnabled } from "../../config/src/hosted-beta";
import type { IdentityVault } from "../../identity/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { betaMaintenanceAction, betaReadAction } from "./beta-interactions";

const purpose = "beta-outbox-reply:v1";
const receiptSchema = z
  .object({
    purpose: z.literal(purpose),
    action: z.string().max(80),
    userId: z.string().regex(/^\d{17,20}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().int(),
  })
  .strict();
export type BetaActionPolicy = {
  mode: "work" | "read" | "maintenance";
  generation: number | null;
  reply?: { action: string; userId: string };
};
function replyDigest(
  vault: IdentityVault,
  kind: string,
  payload: Record<string, unknown>,
) {
  return vault.digest(
    purpose,
    JSON.stringify(
      {
        kind,
        applicationId: payload.applicationId,
        encryptedToken: payload.encryptedToken,
        interactionHash: payload.interactionHash,
        betaGeneration: payload.betaGeneration,
        body: payload.body,
        files: payload.files ?? null,
      },
      (_key, value: unknown) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) =>
                a < b ? -1 : a > b ? 1 : 0,
              ),
            )
          : value,
    ),
  );
}
// Called only after successful dispatch, never from client supplied intent
// alone or from the catch/error response path. Bind authority to the exact
// reply, including attachments, and to its encrypted tenant/Guild scope.
export function certifyBetaReply(
  vault: IdentityVault,
  s: Scope,
  kind: string,
  payload: Record<string, unknown>,
  action: string,
  userId: string,
) {
  if (
    !hostedBetaEnabled() ||
    (!betaReadAction(action) && !betaMaintenanceAction(action))
  )
    return undefined;
  assert(
    kind === "REPLY_EDIT" || kind === "REPLY_FOLLOWUP",
    "BETA_REPLY_INVALID",
    403,
  );
  return vault.seal(
    s,
    JSON.stringify({
      purpose,
      action,
      userId,
      digest: replyDigest(vault, kind, payload),
      issuedAt: Date.now(),
    }),
  );
}
export function betaActionPolicy(
  vault: IdentityVault,
  s: Scope,
  kind: string,
  payload: Record<string, unknown>,
): BetaActionPolicy {
  if (!hostedBetaEnabled()) return { mode: "work", generation: null };
  const generation = z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .safeParse(payload.betaGeneration);
  assert(generation.success, "BETA_JOB_GENERATION_REQUIRED", 403);
  if (payload.betaReply === undefined)
    return { mode: "work", generation: generation.data };
  assert(
    kind === "REPLY_EDIT" || kind === "REPLY_FOLLOWUP",
    "BETA_REPLY_INVALID",
    403,
  );
  const receipt = receiptSchema.parse(
    JSON.parse(vault.open(s, z.string().parse(payload.betaReply))),
  );
  assert(
    receipt.digest === replyDigest(vault, kind, payload) &&
      Date.now() >= receipt.issuedAt &&
      Date.now() - receipt.issuedAt < 14 * 60000,
    "BETA_REPLY_INVALID",
    403,
  );
  const mode = betaMaintenanceAction(receipt.action) ? "maintenance" : "read";
  assert(
    mode === "maintenance" || betaReadAction(receipt.action),
    "BETA_REPLY_INVALID",
    403,
  );
  return {
    mode,
    generation: generation.data,
    reply: { action: receipt.action, userId: receipt.userId },
  };
}
