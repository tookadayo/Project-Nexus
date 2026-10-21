# AUTO002 / PERM native reader source record

2026-10-16, existing Windows checkout `D:\Project Nexus`, branch
`codex/alpha16-rule-platform`. Source and fixture creation only. No test,
type-check, lint, build, UI, SQL, migration, Discord request or application was
executed for this work. This document does not claim operational verification.

## Sources and execution grain

`packages/rules/src/native-execution-permission-projections.ts` exports the
typed native readers and pure projection functions. The dispatcher and closed
request descriptors are integrated separately by `datetime_schedule_audit`.

AUTO002 observes exactly one existing `automation_runs` row per execution.
Migration `075_alpha16_native_runtime_permissions.sql` adds one FK-owned
`automation_execution_observations` row, with native revision/status,
due/deadline/first terminal, explicit heartbeat and monotonic observation
revision. There are no actor keys, message bodies, variables, external-operation
payloads, safety root/epoch copies or independent permanent Run histories.

The native Run uses a session advisory lock; it has no formal expiring worker
lease. The reader supplies `leaseExpiresAt: null`, never a fabricated lease.
`AutomationStore.withRunLock` records heartbeat after acquiring the real Run
lock. A nonterminal saved checkpoint records another explicit heartbeat.
Generic `updated_at`, cancellation metadata and trigger execution are not
heartbeats. There is no new timer or implicit operating interval.

The Run trigger synchronizes actual state transitions. New QUEUED due starts at
native acceptance; a transition back to QUEUED records that queue-entry instant;
an already queued Run does not receive a later due time for unrelated updates.
WAITING/WAITING_APPROVAL due is native `wake_at`. A legacy queued row without a
known queue-entry instant keeps due unknown. Existing Runs are not backfilled.

Future waits are excluded from the eligible denominator. Queued overdue work
is RESUMABLE. A running Run needs an explicit heartbeat. Deadline, overdue wait
and stale heartbeat causes are counted as a union, once per Run. UNKNOWN,
missing observations, contradictory state/time and unobserved legacy liveness
reduce observed coverage, rather than becoming confirmed normal executions.
An empty expected population stays empty and is ineligible in the rule engine.
Grace periods come only from the supplied approved RuleEngineConfig; fixture
values are not operating defaults. Projection as-of exactly matches the sealed
evaluation as-of.

Retained coverage includes Runs overlapping the requested half-open window;
windows extending beyond the native seven-day coverage and deletion-affected
windows produce UNKNOWN. The first terminal anchor is preserved even if a
later native update supplies another terminal timestamp. Observation expiry
cannot move later and is no later than first-terminal plus seven days (or native
deadline plus seven days while unfinished). Parent Run purge cascades the row;
an UPDATE-only heartbeat cannot resurrect a deleted row. Facts end at the
earliest source expiry or the 48-hour evaluation-snapshot cap. No 14-day Run
mirror was introduced.

## Current permission requirement pairing

`readNativePermissionRequirementRegistry` computes a deterministic current
guild BOT requirement set from ACTIVE immutable automation revisions and
reachable enabled statements/called procedures; enabled notification/onboarding
settings; enabled Discord destinations referenced by enabled report schedules,
ACTIVE playbooks or published intake; and published intake channels. Finite
typed allowlists bound variable action targets. Detached blocks, disabled
actions and unused procedures do not create requirements. Duplicate
capability/target atoms are counted once. Missing bindings remain unresolved
requirements, never global permissions or an empty healthy set.

The one-row-per-guild `native_permission_requirement_epochs` table records only
the current configuration revision/time. Permission-relevant native config
writes bump it. Routine Run progress/report `next_at`/playbook evaluation do
not. The registry reader holds its epoch FOR SHARE through the sealing
transaction; it uses nonlocking native config reads, so a writer cannot replace
the epoch between requirements and their Fact. Its hash is the exact
GUILD_PERMISSION_PROFILE liveVersion. Initial epochs use migration time
conservatively; an older capability snapshot is not relabelled current.

The observation reader only consumes an already collected
`guild_capability_snapshots` DTO. Its saved/embedded checkedAt must agree, fall
within the requested window, be no earlier than the requirement epoch and not
be future/expired. New refresh requests/due refreshes, newer failure metadata
or newer surface observations invalidate old pairing. No REST request, extra
personal collection or permission expansion was added.

Saved ManageRoles and native onboarding endpoint permission status can confirm
ALLOW/DENY. An observable channel can confirm VIEW. An absent, obfuscated or
otherwise unconfirmed channel remains UNKNOWN. Collection-forbidden channels
are SUPPRESSED. Existing snapshots do not establish per-channel SendMessages
overwrites, role hierarchy/assignability, channel-management/thread permissions
or message ownership: those atoms remain UNKNOWN. Guild SendMessages alone is
not a channel permission. Counts preserve required = allowed + denied + unknown
+ suppressed, and required=0 remains ineligible.

The dispatcher independently requires current scope/actor authority, approval,
retention, and immutable health matching both
`permission_observation_v1` and `permission_requirement_registry_v1` at the
same exact target/liveVersion. The reader supplies new immutable health only
from actual native observations, for sealing in the accepted transaction.
AUTO health records the accepted native assessment as-of and measured
expected/observed coverage; last-successful-ingest remains the actual latest
saved observed_at. This fresh native SQL aggregate ends within 48 hours of its
assessment and at the earliest original Run-observation expiry. An old period
end or business ingest does not start a new aggregate's retention clock.
There is no success observation for an empty/missing native population. PERM
health uses saved checkedAt and the exact locked registry epoch that predates
it; registry last-successful-ingest remains its real changedAt. It does not
advance either PERM observation to query-success time. Unchanged current settings
are a live configuration rather than a separately expiring history copy.
Unknown coverage, partial confirmation and suppression stay explicit. The
reader creates neither engine approval nor fallback operating values.

Migration 075 also retains a monotonic execution_observation_expires_at on its
existing parent Run. The marker is bounded by every earlier deadline/first
terminal anchor. After independent expired-observation cleanup, a later status
or timestamp edit cannot recreate the row with a later expiry; an UPDATE-only
heartbeat cannot recreate it either. The canonical retention sweep owns the
independent observation expiry DELETE; parent Run deletion still cascades.

## Prepared evidence, not executed results

`tests/fixtures/alpha16-native-runtime-permissions.ts` contains synthetic native
metadata/capabilities only. The unit specifications cover one-Run grain,
future-wait exclusion, anomaly union, missing heartbeat/legacy/UNKNOWN coverage,
contradictions, duplicates, empty populations, reachable finite requirements,
partial permissions and suppression. The integration specifications cover
migration without fabricated legacy observations, explicit heartbeat, first
terminal/retention nonextension, parent deletion/no resurrection, and semantic
permission epoch changes versus routine Run progress.

All are unexecuted. Migration 075 is registered by the parent. Existing worker
deployment requires this schema before the newly instrumented Store is used;
old workers leave explicit coverage gaps instead of producing current evidence.
New external effects and automatic corrective execution remain behind their
independent G3 gates.
