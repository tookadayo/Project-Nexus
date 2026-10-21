import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { assert, type Scope } from "../../shared/src/index";

export type RuleVersion = string;
export interface OperationTokenBinding {
  organizationId: string; guildId: string; intentId: string;
  targetType: string; targetId: string; liveVersion: RuleVersion;
  action: string; suggestionId: string; suggestionVersion: RuleVersion;
  draftId: string; immutableDraftRevisionId: string; draftContentHash: string;
  approvalId: string; safetyEpoch: string;
  issuedAt: string; expiresAt: string;
}
export interface StoredOperationToken {
  purpose: "OPERATION_ADMISSION";
  tokenHash: string; bindingHash: string; binding: Readonly<OperationTokenBinding>;
}
export interface IdempotencyRecord {
  scopeHash: string; keyHash: string; bodyHash: string; intentId: string;
  expiresAt: string;
}
export interface ReplayAuthorization {
  scope: Scope; authorized: boolean; tombstoned: boolean;
  intentExists: boolean; intentId: string; now: Date;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  assert(value === null || ["boolean", "string", "number"].includes(typeof value), "RULE_HASH_VALUE_INVALID");
  assert(typeof value !== "number" || Number.isFinite(value), "RULE_HASH_VALUE_INVALID");
  return value;
}
export function ruleCanonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}
function safeEqualHash(left: string, right: string) {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right)
    && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
function date(value: string) {
  const timestamp = Date.parse(value);
  assert(Number.isFinite(timestamp), "RULE_TOKEN_TIME_INVALID");
  return timestamp;
}
function tokenHash(token: string, prefix: "n16op." | "n16del.") {
  assert(typeof token === "string" && token.startsWith(prefix) && /^[A-Za-z0-9_-]{43}$/.test(token.slice(prefix.length)), "RULE_TOKEN_INVALID", 403);
  return createHash("sha256").update(token, "utf8").digest("hex");
}
function validBinding(binding: OperationTokenBinding) {
  const keys: (keyof OperationTokenBinding)[] = [
    "organizationId", "guildId", "intentId", "targetType", "targetId", "liveVersion", "action",
    "suggestionId", "suggestionVersion", "draftId", "immutableDraftRevisionId", "approvalId", "safetyEpoch",
  ];
  for (const key of keys) assert(typeof binding[key] === "string" && binding[key].length > 0 && binding[key].length <= 256, "RULE_TOKEN_BINDING_INVALID");
  assert(/^[a-f0-9]{64}$/.test(binding.draftContentHash) && /^[1-9][0-9]*$/.test(binding.safetyEpoch)
    && binding.safetyEpoch.length <= 19 && BigInt(binding.safetyEpoch) <= 9_223_372_036_854_775_807n, "RULE_TOKEN_BINDING_INVALID");
  assert(date(binding.expiresAt) > date(binding.issuedAt), "RULE_TOKEN_TIME_INVALID");
}

/** Low-level material only. The caller must commit the intent, immutable
 * binding, hash and approved finite expiry in one transaction before returning
 * the one-time plaintext. This helper cannot activate an operation. */
export function issueOperationToken(binding: OperationTokenBinding): { token: string; stored: StoredOperationToken } {
  validBinding(binding);
  const token = "n16op." + randomBytes(32).toString("base64url");
  const frozen = Object.freeze({ ...binding });
  return { token, stored: {
    purpose: "OPERATION_ADMISSION", tokenHash: tokenHash(token, "n16op."),
    bindingHash: ruleCanonicalHash(frozen), binding: frozen,
  } };
}

/** Expiry and disappearance are terminal denials. A token is never converted
 * to an Idempotency-Key or a new-intent request. Re-check authorization now. */
export function validateOperationToken(input: {
  token: string; stored: StoredOperationToken | null;
  expected: OperationTokenBinding; authorization: ReplayAuthorization;
}): Readonly<OperationTokenBinding> {
  const digest = tokenHash(input.token, "n16op.");
  const auth = input.authorization;
  assert(auth.authorized, "FORBIDDEN", 403);
  assert(!auth.tombstoned, "RESOURCE_DELETED", 410);
  assert(input.stored && auth.intentExists, "IDEMPOTENCY_INTENT_GONE", 410);
  const record = input.stored;
  assert(record.purpose === "OPERATION_ADMISSION" && safeEqualHash(digest, record.tokenHash), "RULE_TOKEN_INVALID", 403);
  validBinding(record.binding); validBinding(input.expected);
  assert(record.binding.organizationId === auth.scope.organizationId && record.binding.guildId === auth.scope.guildId, "FORBIDDEN", 403);
  assert(record.binding.intentId === auth.intentId, "RULE_TOKEN_BINDING_MISMATCH", 409);
  assert(Number.isFinite(auth.now.getTime()) && date(record.binding.expiresAt) > auth.now.getTime(), "IDEMPOTENCY_TOKEN_EXPIRED", 409);
  assert(date(record.binding.issuedAt) <= auth.now.getTime(), "RULE_TOKEN_INVALID", 403);
  assert(safeEqualHash(record.bindingHash, ruleCanonicalHash(record.binding))
    && safeEqualHash(record.bindingHash, ruleCanonicalHash(input.expected)), "RULE_TOKEN_BINDING_MISMATCH", 409);
  return record.binding;
}

/** Dedupe records contain references and hashes, never a cached response body.
 * The caller reconstructs a permitted status response after this check. */
export function idempotencyFingerprint(scope: Scope, operationClass: string, key: string, body: unknown) {
// eslint-disable-next-line no-control-regex -- Deliberately reject ASCII control characters in bounded identifiers.
  assert(typeof key === "string" && key.length >= 1 && key.length <= 256 && !/[\x00-\x1f\x7f]/.test(key), "IDEMPOTENCY_KEY_INVALID");
  assert(/^[A-Z][A-Z0-9_]{0,63}$/.test(operationClass), "RULE_OPERATION_CLASS_INVALID");
  const scopeHash = ruleCanonicalHash({ organizationId: scope.organizationId, guildId: scope.guildId, operationClass });
  return { scopeHash, keyHash: ruleCanonicalHash({ scopeHash, key }), bodyHash: ruleCanonicalHash(body) };
}
export function replayIdempotency(input: {
  stored: IdempotencyRecord | null;
  fingerprint: Pick<IdempotencyRecord, "scopeHash" | "keyHash" | "bodyHash">;
  authorization: ReplayAuthorization;
}): { intentId: string; replay: true } {
  const auth = input.authorization;
  assert(auth.authorized, "FORBIDDEN", 403);
  assert(!auth.tombstoned, "RESOURCE_DELETED", 410);
  assert(input.stored && auth.intentExists, "IDEMPOTENCY_INTENT_GONE", 410);
  const stored = input.stored;
  assert(safeEqualHash(stored.scopeHash, input.fingerprint.scopeHash), "FORBIDDEN", 403);
  assert(safeEqualHash(stored.keyHash, input.fingerprint.keyHash), "IDEMPOTENCY_KEY_MISMATCH", 409);
  assert(safeEqualHash(stored.bodyHash, input.fingerprint.bodyHash), "IDEMPOTENCY_BODY_MISMATCH", 409);
  assert(stored.intentId === auth.intentId, "IDEMPOTENCY_INTENT_GONE", 410);
  assert(Number.isFinite(auth.now.getTime()) && date(stored.expiresAt) > auth.now.getTime(), "IDEMPOTENCY_TOKEN_EXPIRED", 409);
  return { intentId: stored.intentId, replay: true };
}

/** Deletion status secrets belong to a separate namespace. Neither this hash
 * nor the receipt ID is valid input to admission/replay authorization. */
export function issueDeletionReceiptSecret() {
  const secret = "n16del." + randomBytes(32).toString("base64url");
  return { secret, secretHash: hashDeletionReceiptSecret(secret) };
}
export function hashDeletionReceiptSecret(secret: string) { return tokenHash(secret, "n16del."); }
export function validateDeletionReceiptSecret(secret: string, expectedHash: string) {
  assert(safeEqualHash(hashDeletionReceiptSecret(secret), expectedHash), "INVALID_RECEIPT", 403);
}
