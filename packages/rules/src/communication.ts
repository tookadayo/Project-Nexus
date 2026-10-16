import { z } from "zod";
import { sql, tenant, type Tx } from "../../db/src/index";
import { assert, isDomainError, type Scope } from "../../shared/src/index";
import { canonicalJson, digest, retentionExpiry, type PlatformPolicy } from "./domain";
import { issueRuleRequestKey, verifyRuleRequestKey } from "./request-keys";

export const ruleMutationOperations = ["EVALUATE", "CONFIG_REVISE", "CONFIG_ACTIVATE", "CONFIG_RETIRE", "SUGGESTION_VIEW", "SUGGESTION_DISMISS", "SUGGESTION_SAVE", "SUGGESTION_REJECT", "SUGGESTION_DRAFT", "EVALUATION_CANCEL"] as const;
export type RuleMutationOperation = typeof ruleMutationOperations[number];
export const ruleMutationEnvelope = z.object({
  operation: z.enum(ruleMutationOperations), targetId: z.uuid().optional(),
  expectedVersion: z.number().int().min(0).max(2_147_483_647).optional(), payload: z.unknown(),
}).strict();
export type RuleMutationEnvelope = z.infer<typeof ruleMutationEnvelope>;
const reference = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CONFIG"), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("USER_STATE"), suggestionId: z.uuid(), mutation: z.enum(["view", "dismiss", "save"]) }).strict(),
  z.object({ kind: z.literal("REJECT"), suggestionId: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("DRAFT"), suggestionId: z.uuid(), draftId: z.string().min(1).max(128), immutableRevisionId: z.string().min(1).max(128) }).strict(),
  z.object({ kind: z.literal("EVALUATION_CANCEL"), jobId: z.uuid() }).strict(),
  z.object({ kind: z.literal("EVALUATION"), jobId: z.uuid() }).strict(),
]);
export type RuleMutationReference = z.infer<typeof reference>;
const resource = z.discriminatedUnion("state", [
  z.object({ state: z.literal("PREPARED") }).strict(),
  z.object({ state: z.literal("DONE"), reference }).strict(),
]);
const prepared = canonicalJson({ state: "PREPARED" });
function fingerprint(envelope: RuleMutationEnvelope) {
  return digest({ operation: envelope.operation, targetId: envelope.targetId ?? null,
    expectedVersion: envelope.expectedVersion ?? null, payload: envelope.payload });
}

export const evaluationRequestStatusInput = z.object({key: z.string().max(128).regex(/^rk1\.[0-9a-z]{1,11}\.[a-f0-9]{32}\.[a-f0-9]{64}$/)}).strict();
export type RuleEvaluationRequestStatus = {status: "MISSING" | "EXPIRED" | "UNAVAILABLE"} | {status: "PREPARED"; expiresAt: string} | {status: "DONE"; expiresAt: string; evaluationJobId: string};
/** Read the original communication reference only. A PREPARED row is not proof
 * of non-execution: an enqueue may still be in flight. This never executes a
 * prepared mutation, consumes its key, refreshes its expiry or grants receipt
 * access from a wire whose backing scoped actor record has disappeared. */
export async function readRuleEvaluationRequestStatus(tx: Tx, scope: Scope, actorHash: string, secret: string, key: string, now: Date): Promise<RuleEvaluationRequestStatus> {
  assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
  evaluationRequestStatusInput.parse({key});
  const row = (await sql<{fingerprint: string; resource_id: string; expires_at: Date}>`SELECT fingerprint,resource_id,expires_at FROM rule_request_keys
    WHERE ${tenant(scope)} AND actor_hash=${actorHash} AND operation_class='EVALUATE' AND key_hash=${digest(key)}`.execute(tx)).rows[0];
  if (!row) return {status: "MISSING" as const};
  if (!/^[a-f0-9]{64}$/.test(row.fingerprint)) return {status: "UNAVAILABLE" as const};
  let expires: Date;
  try {expires = verifyRuleRequestKey(secret, {...scope, actorHash, operationClass: "EVALUATE", bodyHash: row.fingerprint}, key, now);}
  catch (error) {if (isDomainError(error) && error.code === "IDEMPOTENCY_KEY_EXPIRED") return {status: "EXPIRED" as const}; throw error;}
  assert(row.expires_at.getTime() === expires.getTime(), "INVALID_IDEMPOTENCY_KEY", 409);
  if (row.expires_at <= now) return {status: "EXPIRED" as const};
  let stored: z.infer<typeof resource>;
  try {stored = resource.parse(JSON.parse(row.resource_id));} catch {return {status: "UNAVAILABLE" as const};}
  const expiresAt = expires.toISOString();
  if (stored.state === "PREPARED") return {status: "PREPARED" as const, expiresAt};
  if (stored.reference.kind !== "EVALUATION") return {status: "UNAVAILABLE" as const};
  return {status: "DONE" as const, expiresAt, evaluationJobId: stored.reference.jobId};
}

/** Preparation persists only a hash and a pending reference. An issued wire
 * alone never authorizes an operation after its record has been purged. All
 * callers hold the canonical scope transaction and current authorization. */
export async function prepareRuleMutation(tx: Tx, scope: Scope, actorHash: string,
  secret: string, policy: PlatformPolicy | undefined, envelope: RuleMutationEnvelope, now: Date, ceiling: Date) {
  assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
  const expires = retentionExpiry(policy, "REQUEST_KEY", now, ceiling);
  assert(expires > now, "STATE_CONFLICT", 409);
  const bodyHash = fingerprint(envelope);
  const key = issueRuleRequestKey(secret, { ...scope, actorHash, operationClass: envelope.operation, bodyHash }, now, expires);
  await sql`INSERT INTO rule_request_keys(organization_id,guild_id,actor_hash,operation_class,key_hash,fingerprint,resource_id,expires_at)
    VALUES(${scope.organizationId}::uuid,${scope.guildId},${actorHash},${envelope.operation},${digest(key)},${bodyHash},${prepared},${expires})`.execute(tx);
  return { key, expiresAt: expires.toISOString(), purpose: "COMMUNICATION_DEDUPLICATION_ONLY" as const };
}

/** No cached body is retained or blindly replayed. References are reconstructed
 * under current authorization, scope, expiry and deletion guards. */
export async function withRuleMutation<T>(tx: Tx, scope: Scope, actorHash: string,
  secret: string, policy: PlatformPolicy | undefined, envelope: RuleMutationEnvelope,
  key: string | undefined, now: Date, ceiling: Date,
  execute: (wireExpiry: Date) => Promise<{ reference: RuleMutationReference; response: T }>,
  replay: (reference: RuleMutationReference) => Promise<T>): Promise<T> {
  assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
  assert(key, "IDEMPOTENCY_KEY_REQUIRED", 400);
  const bodyHash = fingerprint(envelope), keyHash = digest(key);
  const row = (await sql<{ fingerprint: string; resource_id: string; expires_at: Date }>`SELECT fingerprint,resource_id,expires_at FROM rule_request_keys WHERE ${tenant(scope)} AND actor_hash=${actorHash} AND operation_class=${envelope.operation} AND key_hash=${keyHash}`.execute(tx)).rows[0];
  if (row) assert(row.fingerprint === bodyHash, "IDEMPOTENCY_BODY_MISMATCH", 409);
  const wireExpiry = verifyRuleRequestKey(secret, { ...scope, actorHash, operationClass: envelope.operation, bodyHash }, key, now);
  assert(row && row.expires_at > now, "IDEMPOTENCY_INTENT_GONE", 410);
  assert(row.expires_at.getTime() === wireExpiry.getTime(), "INVALID_IDEMPOTENCY_KEY", 409);
  assert(wireExpiry <= retentionExpiry(policy, "REQUEST_KEY", now), "INVALID_IDEMPOTENCY_KEY", 409);
  let stored: z.infer<typeof resource>;
  try { stored = resource.parse(JSON.parse(row.resource_id)); }
  catch { assert(false, "IDEMPOTENCY_INTENT_GONE", 410); }
  if (stored.state === "DONE") return replay(stored.reference);
  // A prepared operation must still fit the current parent/class expiry. The
  // completed replay path instead validates the referenced result's own scope.
  assert(wireExpiry <= ceiling, "INVALID_IDEMPOTENCY_KEY", 409);
  const outcome = await execute(wireExpiry);
  const ref = reference.parse(outcome.reference);
  const completed = await sql`UPDATE rule_request_keys SET resource_id=${canonicalJson({ state: "DONE", reference: ref })}
    WHERE ${tenant(scope)} AND actor_hash=${actorHash} AND operation_class=${envelope.operation} AND key_hash=${keyHash}
    AND fingerprint=${bodyHash} AND resource_id=${prepared} AND expires_at>clock_timestamp() RETURNING resource_id`.execute(tx);
  assert(completed.rows.length === 1, "IDEMPOTENCY_KEY_EXPIRED", 409);
  return outcome.response;
}
