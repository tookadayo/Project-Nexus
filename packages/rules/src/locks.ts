import { createHash } from "node:crypto";
import { sql, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";

/** All new writers participate, including reads which decide to create a row.
 * A GLOBAL erasure takes the exclusive root; ordinary work takes it shared.
 * These locks are synchronization, never resource identity or authorization. */
export type RuleScopeLock =
  | { kind: "GLOBAL"; mode: RuleLockMode }
  | { kind: "ORGANIZATION"; organizationId: string; mode: RuleLockMode }
  | { kind: "GUILD"; organizationId: string; guildId: string; mode: RuleLockMode }
  | { kind: "SUBJECT"; subjectHash: string; mode: RuleLockMode };
export type RuleLockMode = "shared" | "exclusive";

export const RULE_LOCK_RANKS = Object.freeze([
  "TOMBSTONE", "DELETION_JOB", "TARGET", "RUN", "STEP", "INTENT",
  "ATTEMPT", "LEASE", "OPERATION_GUARD", "SUGGESTION", "DRAFT",
  "EVIDENCE", "EVALUATION", "FACT",
] as const);
export type RuleLockRank = typeof RULE_LOCK_RANKS[number];
export interface RuleRowLock { readonly rank: RuleLockRank; readonly key: string }
export interface RuleAdvisoryLock { readonly id: string; readonly mode: RuleLockMode }
export interface RuleLockPlan {
  readonly scopes: readonly RuleAdvisoryLock[];
  readonly rows: readonly RuleRowLock[];
}

function identifier(value: string) {
// eslint-disable-next-line no-control-regex -- Deliberately reject ASCII control characters in bounded identifiers.
  assert(typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value), "RULE_LOCK_SCOPE_INVALID");
  return value;
}
function scopeKey(scope: RuleScopeLock): string {
  assert(scope.mode === "shared" || scope.mode === "exclusive", "RULE_LOCK_MODE_INVALID");
  switch (scope.kind) {
    case "GLOBAL": return JSON.stringify(["nexus", "alpha16", "GLOBAL"]);
    case "ORGANIZATION": return JSON.stringify(["nexus", "alpha16", scope.kind, identifier(scope.organizationId).toLowerCase()]);
    case "GUILD": return JSON.stringify(["nexus", "alpha16", scope.kind, identifier(scope.organizationId).toLowerCase(), identifier(scope.guildId)]);
    case "SUBJECT":
      assert(/^[a-f0-9]{64}$/.test(scope.subjectHash), "RULE_LOCK_SCOPE_INVALID");
      return JSON.stringify(["nexus", "alpha16", scope.kind, scope.subjectHash]);
    default: throw new Error("RULE_LOCK_SCOPE_INVALID");
  }
}

/** Canonical identity arrays avoid delimiter/concatenation ambiguities. Every
 * guild writer takes all ancestors, so an exclusive ancestor covers absent rows. */
export function ruleScopeLockSet(scope: Scope, options: {
  globalMode?: RuleLockMode; subjectHashes?: readonly string[];
} = {}): RuleScopeLock[] {
  identifier(scope.organizationId); identifier(scope.guildId);
  return [
    { kind: "GLOBAL", mode: options.globalMode ?? "shared" },
    { kind: "ORGANIZATION", organizationId: scope.organizationId, mode: "shared" },
    { kind: "GUILD", organizationId: scope.organizationId, guildId: scope.guildId, mode: "exclusive" },
    ...(options.subjectHashes ?? []).map(subjectHash => ({ kind: "SUBJECT" as const, subjectHash, mode: "exclusive" as const })),
  ];
}

/** Hash first, then deduplicate and sort the actual PostgreSQL IDs. A collision
 * merely serializes extra work. It must never imply equal scopes or permissions. */
export function scopeLockIds(scopes: readonly RuleScopeLock[]): readonly RuleAdvisoryLock[] {
  assert(scopes.length > 0 && scopes.some(scope => scope.kind === "GLOBAL"), "RULE_GLOBAL_LOCK_REQUIRED");
  const locks = new Map<string, RuleLockMode>();
  for (const scope of scopes) {
    const id = createHash("sha256").update(scopeKey(scope), "utf8").digest().readBigInt64BE(0).toString();
    const old = locks.get(id);
    locks.set(id, old === "exclusive" || scope.mode === "exclusive" ? "exclusive" : "shared");
  }
  return Object.freeze([...locks].sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)
    .map(([id, mode]) => Object.freeze({ id, mode })));
}

export function createRuleLockPlan(scopes: readonly RuleScopeLock[], rows: readonly RuleRowLock[] = []): RuleLockPlan {
  const unique = new Map<string, RuleRowLock>();
  for (const row of rows) {
    assert(RULE_LOCK_RANKS.includes(row.rank), "RULE_LOCK_RANK_INVALID");
    identifier(row.key);
    unique.set(JSON.stringify([row.rank, row.key]), Object.freeze({ rank: row.rank, key: row.key }));
  }
  const ordered = [...unique.values()].sort((a, b) => {
    const rank = RULE_LOCK_RANKS.indexOf(a.rank) - RULE_LOCK_RANKS.indexOf(b.rank);
    return rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });
  return Object.freeze({ scopes: scopeLockIds(scopes), rows: Object.freeze(ordered) });
}

function requireTransaction(tx: Tx) {
  // An xact lock on an autocommit connection is immediately released. Refuse it.
  assert(tx.isTransaction, "RULE_TRANSACTION_REQUIRED", 500);
}
async function acquireAdvisoryLocks(tx: Tx, locks: readonly RuleAdvisoryLock[]) {
  requireTransaction(tx);
  for (const lock of locks) {
    if (lock.mode === "exclusive") await sql`SELECT pg_advisory_xact_lock(${lock.id}::bigint)`.execute(tx);
    else await sql`SELECT pg_advisory_xact_lock_shared(${lock.id}::bigint)`.execute(tx);
  }
}
export async function acquireRuleScopeLocks(tx: Tx, scopes: readonly RuleScopeLock[]) {
  await acquireAdvisoryLocks(tx, scopeLockIds(scopes));
}

/** Construct the complete set before entering the transaction. No callback may
 * acquire additional scopes or lower-ranked rows; restart with a new plan.
 * Nonexistent tombstones are inspected under the scope lock, never fabricated. */
export async function acquireRuleLocks(
  tx: Tx,
  plan: RuleLockPlan,
  lockRow: (tx: Tx, row: RuleRowLock) => Promise<void>,
) {
  await acquireAdvisoryLocks(tx, plan.scopes);
  for (const row of plan.rows) await lockRow(tx, row);
}
