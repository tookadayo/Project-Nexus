import { sql, tenant, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import type { Feature } from "../../settings/src/billing/entitlements";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import { operationsAccess, operationsLock } from "./policy";
import { assertMaintenanceAuthorization, type MaintenanceAuthorizationProof } from "./maintenance-authorization";

/** New maintenance paths join the privacy scope order before legacy locks.
 * Membership proof and DB permissions are checked after waiting for writers. */
export async function integrationMaintenanceAccess(tx: Tx, s: Scope, actor: Actor,
  proof: MaintenanceAuthorizationProof | undefined, feature?: Feature) {
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(s, { subjectHashes: [actor.key] }));
  await operationsAccess(tx, s, actor, "CONFIGURE", feature);
  await operationsLock(tx, s);
  await integrationMaintenanceCurrent(tx, s, actor, proof, feature);
}

/** Also call after target/FK row waits, immediately before a write. */
export async function integrationMaintenanceCurrent(tx: Tx, s: Scope, actor: Actor,
  proof: MaintenanceAuthorizationProof | undefined, feature?: Feature) {
  await operationsAccess(tx, s, actor, "CONFIGURE", feature);
  const now = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
  assertMaintenanceAuthorization(proof, s, actor, now);
  assert(!(await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash=${actor.key} LIMIT 1`.execute(tx)).rows.length,
    "RESOURCE_DELETED", 410);
}

export function integrationRevision(value: number) {
  assert(Number.isSafeInteger(value) && value > 0 && value <= 2147483647, "INVALID_REVISION");
}
