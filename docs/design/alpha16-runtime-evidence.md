# alpha16 Runtime safety implementation record

2026-10-16. Branch: `codex/alpha16-rule-platform`; entry baseline:
`35b0d22398c1463e2c88d7f49d960fa8a065002a`. This records source changes and
unexecuted acceptance specifications. It is not a test result or deployment record.

## Canonical contract and mapping

Read order: source README, migration plan, contract decisions, decision gate,
design index, I-C1/I-C3/I-C4, VI, V-A/V-B. Migration plan §5.4/§5.5 and the
contract decisions override the older local lock orders, candidate durations,
and VI's superseded terminalization/development-stage wording.

| N16 unit | Implemented source | Existing authority / new difference |
| --- | --- | --- |
| N16-02 scope/row locks | `packages/rules/src/locks.ts` | PG transaction advisory locks, then canonical row ranks; no Redis safety authority |
| N16-02 token separation | `packages/rules/src/tokens.ts` | Request dedupe hashes, opaque operation admission binding, status-only deletion secrets are separate |
| N16-05 state contracts | `packages/rules/src/runtime-safety.ts` | Current authority, target root, lease fence, admission, UNKNOWN, reconciliation, restore and missed schedules |
| N16-05 persistence | `migrations/062_alpha16_rule_runtime.sql`, `packages/rules/src/runtime-store.ts` | Dedicated intent/attempt/lease/dedupe/reference-only outbox; existing `automation_runs` remains the Run authority |
| Legacy compatibility | `packages/automation/src/admission.ts`, `packages/discord/src/outbox.ts`, `apps/worker/src/actions.ts` | Existing alpha15 limits/semantics retained; v16 metadata requires explicit activation and is rejected by the legacy ActionWorker |
| Operator control | `readOperatorDispatchGate` in `packages/security/src/alpha16-operator.ts` | New reserve/claim/admission require current GLOBAL/GUILD and applicable FLOW controls; missing/expired controls deny |

New physical names are `rule_runtime_intents`, `rule_runtime_attempts`,
`rule_runtime_leases`, `rule_runtime_request_keys`, `rule_runtime_outbox`.
`rule_target_safety` and `rule_apply_reservations` come from migration 060.
The operation binding stores immutable IDs/versions/hash/approval/epoch and
finite expiry, without message text, variable contents, provider responses or
copied evidence. No queue contains an effect payload or a bearer token.

## Synchronization and admission

Normal new guild operations acquire GLOBAL shared, ORGANIZATION shared and
GUILD exclusive locks. GLOBAL deletion acquires the same GLOBAL lock exclusively.
Optional SUBJECT hash locks are available for coordinated privacy operations.
Identity is a canonical typed array; organization UUID strings are normalized to
lowercase. SHA-256 is mapped to a signed PostgreSQL bigint. Actual mapped IDs
are deduplicated, strengthened to exclusive if needed, and sorted numerically.
Hash collisions only add serialization, never authorization or identity equality.

Rows follow tombstone, deletion job, target safety/live, Run, Step, Intent,
Attempt, Lease, operation guard, Suggestion, Draft/Link, Evidence/History,
Evaluation, Fact order; keys within a rank are sorted. An autocommit connection
is rejected. Nonexistent tombstones are read under scope synchronization and
are not created as lock placeholders. Complete scopes must be known before
starting a transaction; callbacks may not acquire additional locks.

The store reserves intent, unique Apply guard, request hashes and outbox in one
transaction. Initial and repeated requests recheck current authority. Another
actor/key/draft cannot bypass the target/action guard. At admission, the store
rechecks immutable binding hash, source expiry, live/draft/Suggestion versions,
target root policy/epoch/gate, approval, current authority, Operator controls and
the current worker fence. Provider communication occurs only after admission
commit. A deadline/exception/response loss then becomes UNKNOWN; aborting a
request is not proof that it had no effect. There is no automatic provider retry.

Queue reconstruction admits references only from committed READY state. An
expired claim can be reclaimed only when admission was never committed. Old
worker fences fail. An admitted or UNKNOWN effect goes to read-only
reconciliation. Authoritative matching evidence can resolve the recorded result;
it cannot reopen the target root or queue the old effect. Confirmed external
no-effect is `FAILED_CONFIRMED`, distinct from a pre-admission failure.

## Retention, privacy and restoration

UNKNOWN writes `UNKNOWN_BLOCKED` and advances the target root epoch in the same
transaction as the lifecycle state. The root contains no Run/operation ID,
payload, response, evidence or copied history. Ordinary version changes preserve
the gate, missing/expired roots deny, and only a new explicit human intent with
authoritative reconciliation, current permission, risk review and fresh approval
may reopen it. Root expiry is never renewed by recovery.

UNKNOWN terminalization preserves its first terminal time. Deadline values have
no production defaults; an approved runtime profile is mandatory. A safety
persistence failure throws a dispatch-blocking error. It must be reported as a
storage/deadline incident, not used to extend terminal time indefinitely.

Run-derived records reference existing `automation_runs` with cascading child
deletion and inherit `ended_at + 7 days` at the latest. The additional explicit
expiry is no later than required live evidence, draft/history or target safety
expiry. Non-Run operation intents require their own separately approved finite
retention class; they do not silently inherit seven days. Attempts, token hashes,
request hashes, outbox and reservations cascade with the intent. Before a
lifecycle purge removes guards, unresolved targets are blocked and affected
Suggestions become non-actionable. No evidence is copied to extend its expiry.

`purgeRuleRuntimeGuild`, `purgeRuleRuntimeActor`, `purgeExpiredRuleRuntime` and
`sweepRuleRuntimeRetention` are integration hooks. Privacy invalidating shared
guild aggregates should use the guild hook before removing their sources.
Parent-Run deletion/restore and every legacy writer must participate before
Run-derived alpha16 dispatch can be enabled. Existing alpha15 Worker ownership
is not silently transferred by a foreign key. This writer compatibility remains
an explicit activation blocker rather than an assumed migration success.

Backup expiry is seven days independently of live purge. Restored OPEN is not a
fresh safety observation. Latest tombstones, latest target epochs/gates and
independent retention enforcement must be verified before dispatch; missing
proof blocks it. A stopped PC is never reported as having completed purge.

## Disabled conditions and remaining environment work

No production runtime, operation-retention, TARGET_LIVE_SAFETY policy, Operator
control retention, independent expiry enforcement or compatible dedicated
worker has been approved/configured here. Thus new external operations remain
disabled. The initial case catalog does not acquire Apply permission through
this store. The lower-level token builders and pure state helpers do not grant
permissions or enable dispatch.

Actual Windows worker ownership, lease/request settings, target editor/source
adapters, all participating writer paths, recovery ownership, independent
live/backup expiry and real provider read-only reconciliation belong to their
G3/G6 and alpha17 acceptance gates. Old alpha15 behavior remains its existing
authority, and its historical partial/not-run items and tzdb limits are not
claimed resolved by these runtime contracts.

## Acceptance code prepared; all NOT_RUN

- `tests/unit/alpha16-runtime-safety.test.ts`: target root inheritance, missing
  policy/expiry, VI F05/F06, fence/admission/cancel boundary, no blind retry,
  confirmed-only consumption, queue reconstruction, read-only matching, missed
  scheduling and backup guards.
- `tests/unit/alpha16-runtime-locks-tokens.test.ts`: mapped-ID ordering and mode
  dedupe, shared deletion ancestors, row ranks, autocommit refusal, immutable
  operation binding, receipt separation, current authorization/deletion/expiry
  on replay, and no new intent after disappearance.
- `tests/unit/alpha16-runtime-store.test.ts`: disabled paths avoid DB access,
  provider calls follow admission commit exactly once, and response/result-commit
  failures do not trigger resend.
- `tests/integration/alpha16-runtime-store.test.ts`: isolated synthetic policy
  fixture for atomic reservation/dedupe/outbox, lease takeover, admitted crash,
  UNKNOWN terminal-time preservation, physical child purge and root inheritance,
  authoritative read-only reconciliation and expiry cascades, including
  same-transaction expired-ID selection that preserves unexpired siblings.

No unit/integration tests, type checks, lint, builds, migrations, app launches,
provider requests, load measurements, real configuration changes, credentials,
production writes or deployments were executed during this implementation unit.
Source/diff inspection alone is not PASS evidence. Consolidated execution is
reserved until the root reports that all implementation is complete.
