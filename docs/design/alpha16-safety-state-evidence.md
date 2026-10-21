# alpha16 independent safety state: implementation evidence

2026-10-16. Source implementation and fixture preparation only. No tests, type check, lint, build, browser, migration, backup, restore, deletion, credential generation, provider call or production operation has been run for this change. The parent requires the combined source review before execution. Existing Windows checkout and the user's `apps/web/next-env.d.ts` changes are preserved.

## Retention boundaries

Run children remain attached to the existing Run and disappear through its canonical cascade within seven days of the first terminal time. No Run ID, attempt, actor, payload, result or copied history is added to independent safety state. Backup metadata is checked against seven days. Existing evaluation/source/evidence limits remain 48 hours; minimal operation history/audit/receipt remain 14 days. They do not supply a safety-state lifetime.

`TARGET_LIVE_SAFETY`, `RESTORE_TOMBSTONE`, and `PUBLICATION_WITHDRAWAL` each require one explicit, finite, approved, enforced policy revision. No default duration, 90-day candidate, renewal on read, or implicit conversion from Run/history retention is installed. `RESTORE_TOMBSTONE` describes validity of independently current restore evidence; it does not replace or expire the existing canonical unfinished deletion purpose.

The existing personal deletion API, its canonical deletion requests/jobs and their unfinished blocking state are not gated on the new policy/provider. Individual deletion does not change guild settings or grant authority to pause an entire guild. Missing safety contracts stop the new external Apply, static publication, or restore completion path. Suggestion display and unrelated existing operations are independent.

## Reader and writer

`packages/security/src/alpha16-safety-state.ts` implements `IndependentSafetyAuthority`. Its trusted server provider supplies closed-schema, complete, independent, scoped, current-generation evidence with original deadlines. A browser flag, restored DB row, backup snapshot, deserialized proof or ordinary current-target configuration cannot create an accepted proof. Proofs are process-local capabilities. Refresh, expiry or policy revision changes invalidate old proofs; returned evidence is copied to prevent mutation of the private authority.

`reconcileIndependentTargetSafety` runs under canonical scope locks and verifies scope/generation/versions. It can initialize a missing root only from independent current evidence. It preserves local UNKNOWN, never extends an existing deadline, blocks roots absent from the complete independent source, and does not open a restored UNKNOWN root. The 074 migration adds verification metadata to the existing target root, not a parallel history. Authority refresh erases the preceding private evidence, reads reject and erase expired/changed-policy evidence, and the retention worker's optional authority hook purges expired in-memory roots even while external operation profiles remain disabled.

The independent source's reader alone cannot protect an UNKNOWN root after local finite erasure. `IndependentTargetFenceWriter` therefore defines the necessary conditional writer contract: compare the complete current root/generation, atomically write UNKNOWN with higher epoch/version and the same or earlier deadline, return complete current evidence. It sends no Run, actor, operation token or payload. There is no installed external service or implementation of that new provider contract.

`RuleOperationStore.admit` first verifies a stored claimed attempt/lease and obtains that independent fence outside the DB transaction. It then repeats current authorization, privacy, scope control, input evidence, immutable draft, lease and target checks under canonical locks. A process-local, one-use proof moves the local root to the same UNKNOWN fence in the send-admission transaction. Losing a fence response, rolling back, losing a commit response, timing out or losing a result cannot repeat the external action or reopen the target. Later known results do not automatically reopen UNKNOWN; a future explicit read-only resolution contract must verify current target identity/version and authority. Reserve/claim/proposal are not an automatic opener.

The new writer/provider and operating lifetimes remain G3 blockers. A read provider without the conditional writer reports `INDEPENDENT_TARGET_FENCE_WRITER_UNCONFIGURED`; it does not make Apply ready. The current alpha16 runtime profile is also default disabled.

## Publication safety

The existing 063 manifests retain their own history purpose. The 074 head fields hold independently expiring generation/withdrawal safety, verification and the current artifact hash. A missing head is not generation zero: stage requires the complete independent current generation and cannot use an absent, expired, pending or UNKNOWN remote entry as authority.

Static publication still requires its existing trusted local authority and the publisher's atomic switch, conditional generation, read-back hash, withdrawal and cache capabilities. Current independent publication evidence must match the generation, withdrawal barrier, active generation and artifact hash at admission and confirmation. External work stays outside transactions. Unknown work is only reconciled read-only, with no repeated publication.

`purgeExpiredStaticPublicationManifests` deletes expired history and finite safety heads. The returned withdrawal requirements belong to that maintenance response; they are not copied into another retained history. `cleanupComplete` describes local expiry work only; `ready` and `externalPublicationReady` remain false without independent remote resolution. Original deadlines never advance.

`official_publications.delivery_mode` is current source configuration, with no actor or execution data. Existing static sources and all future head inserts mark STATIC. Ordinary source edits cannot reset STATIC to LEGACY. This survives finite head erasure so the old PC public-news reader cannot re-expose a static source through its headless legacy fallback. The PC reader requires a newly observed independent proof plus matching generation/withdrawal/hash and live finite rows for STATIC; missing proof hides STATIC only. Existing legacy delivery keeps its original contract.

## Purge and restore

Scoped Rule expiry first purges expired/missing-target runtime intents and their reservation/attempt/lease/token/outbox children, then physically deletes expired minimal target roots. Canonical guild deletion removes target roots without retaining a shadow Run history. The worker's global publication cleanup works without creating a publication route. Scoped worker cleanup also calls `purgeExpiredReportGenerationEvidence` for the new five-field 48-hour report-generation evidence; it does not change native report history.

`fenceMinimalSafetyForRestore` takes the exclusive global scope, sets every restored target to UNKNOWN, advances epochs/versions without overflow, clears verification and closes publication heads without extending deadlines. `applyDeletionTombstones` calls it before restored execution/session fencing and scoped erasure. Applying a protected legacy tombstone export remains an offline deletion utility; its result always reports `runtimeReady: false`. A snapshot is not independently latest merely because it decrypts successfully. Current additive migrations 053–078 are required by the current erasure hooks.

`apps/worker/src/alpha16-safety-restore.ts` supplies the concrete recovery coordinator around trusted PC/storage adapters: inspect an isolated backup/hash/deadline; independently fetch and apply tombstones before restore; restore that exact artifact once into the isolated destination; fetch and apply latest tombstones again; complete purpose-specific expiry enforcement; rebuild queues/caches from current canonical state; enumerate actual guild scopes; fetch complete independent target/publication evidence outside transactions; check that the guild set has not changed under exclusive global lock; reconcile every scoped target; and recheck every proof and backup deadline after waits.

The coordinator never claims a failed/uncertain restore did not happen and cannot retry the same artifact in the same instance. Its storage adapter must implement durable conditional admission across process failure. Completion receipts are process-local, copied receipts fail, and their backing current proofs/deadlines are rechecked. Completion does not start a supervisor, reopen controls or authorize external Apply/publication. New external providers, storage adapters, approved independent lifetimes and actual deployment/startup wiring remain deliberately unconfigured. They are concrete G3 prerequisites, not approvals for new individual collection or permissions.

## Source storage coverage through 082

This update supersedes the earlier schema maximum: the offline tombstone guard
now requires 053 through 082 inclusive (30 versions). The finite snapshot
inventory in `alpha16-retention.ts` includes all nine 077/079/080/082
context/source/EAV tables. 080 adds native captures/filter snapshots; 082 adds
metric headers/values. 081 adds columns to existing native sources, whose native
retention remains unchanged. Schema inspection covers its nullable reference and
mention contracts, actual collection clocks and `reply_provenance_erased` quality.

`alpha16-restored-source-retention.ts` checks migration 077 through the current
082 and actual column types resolved along the same SQL search path. Unknown
future schemas are not silently certified. Under the isolated restore's GLOBAL
exclusive lock it removes expired finite contexts, their source/EAV children and
expired profiles/requests. Earlier native role/embedded-field/metric child source
deadlines win over a later header. Deleting just a header would leave its copied
EAV value; the containing finite context therefore cascades at that deadline.
No deadline is advanced and no native setting/collection purpose is changed.

The coordinator checks schema after preparing storage, performs the new-source
purge before the generic expiry adapter, and repeats read-only schema/expiry
inspection after rebuilding and final lock waits. Its opaque receipt deadline is
also bounded by the earliest remaining source expiry. A crossed deadline needs
cleanup; no storage restore is repeated. `assertRecoveryReceipt` returns verified
`finiteSourceRetention` evidence for a trusted server status adapter. A generic
`expiredDataPurged: true` alone cannot certify this new storage. No production
restore adapter, retention approval or operating configuration is installed.

Prepared fixtures: `tests/integration/alpha16-restored-source-retention.test.ts`
(missing quality column, earlier child expiry/cascade, unchanged surviving TTL,
final read-back rejection) and `tests/unit/alpha16-retention.test.ts` source
readiness cases. All are NOT RUN.

## Prepared verification

`tests/unit/alpha16-safety-state.test.ts` covers absent policy/provider/writer, invalid scope/evidence/deadline, proof copying/mutation/refresh/expiry, conditional fence invariants, exact tombstone hash and disabled restore before DB work.

`tests/integration/alpha16-minimal-safety.test.ts` covers UNKNOWN preservation, finite root erasure, one-use fence consumption, rollback without reuse, restore fencing and STATIC fallback denial after physical head erasure. Existing runtime/publication fixtures are being updated to inject isolated synthetic authorities and the finite-root expectations. These fixtures neither approve operating durations nor install providers. Execution was pending the parent's combined source gate when this section was prepared; the subsequent authorized result follows.

## Authorized isolated verification on 2026-10-16

The parent subsequently authorized database verification. The final alpha16
batch passed 33 files / 173 tests, including restored-source retention (3),
minimal safety (4), runtime store (10) and publication purge (5). This supersedes
the earlier NOT RUN / pending execution statements for these integration files.
Evidence: `.local/alpha16-db-alpha16-final.log` and its `.vitest.json` report.
Fresh synthetic-only private PostgreSQL databases applied migrations through
082. The checks exercised actual schema constraints, immutable values, original
expiry, deletion cascades and closed STATIC fallback. No production restore,
external provider, independently approved safety lifetime or real configuration
was installed. Unit/type/build results are recorded by the parent separately.
