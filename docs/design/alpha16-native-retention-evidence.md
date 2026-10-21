# Native Run retention / rule runtime composition

2026-10-16. Source-only correction in the existing Windows checkout. No tests,
type checks, lint, build, UI, SQL, migrations, worker runs or external requests
were executed. The following are implementation claims and unexecuted test
specifications, not runtime verification results.

## Concrete correction

`sweepAutomationRetention` previously acquired legacy global automation fence
763215 and native Run rows before deleting old parents. A parent linked to new
`rule_runtime_intents` correctly fails its 062 delete guard until the canonical
runtime purge has preserved unresolved target blockades and removed children.
The old native sweep did not call that purge. Observation 075 also has an own
deadline which can precede parent `ended_at + 7 days`, so cascade alone does not
enforce its retention.

The native sweep now discovers at most 100 candidate scopes with read-only
queries. Each scope has its own transaction. It acquires that scope's complete
canonical advisory set in hash order before `automationLock` takes legacy
763215/guild locks. Every query and mutation inside the transaction remains
scoped to that already captured organization/guild. A new guild is left for the
next pass. GLOBAL is never acquired alone with later hashed guild locks.

Inside the legacy fence, read-only selection determines expired Runs, old
terminal parents, Runs belonging to old deleted Flows and expired observations.
The sorted fixed native Run lock set is passed with only the actual purge IDs
to `purgeRuleRuntimeRuns`. The security/privacy owner added this helper using
the existing canonical runtime purge: unresolved target roots are closed
first, all participating native Run rows are locked next, and runtime
Intents/attempts/leases/guards/children are handled after those roots and Runs.
The native sweeper subsequently reuses those Run locks. It does not discard
the 062 parent delete guard or use an unguarded CASCADE as a cleanup shortcut.

Old Run deletion therefore occurs only after the legitimate runtime child
purge has invalidated actionable dependent proposals and kept UNKNOWN target
blockades. Expiry neither opens nor extends those roots. No Run/member/input
data is copied into a longer-lived replacement safety history. Current privacy
erasure/restore call ordering is unchanged.

For a native Run reaching its deadline, an admitted unresolved rule Intent or
RESULT_UNKNOWN also makes the parent UNKNOWN, even when the legacy
`automation_operations` table has no corresponding STARTED row. A new runtime
write is not mislabeled effect-free EXPIRED merely because the old operation
table is empty. Future waits and terminal decisions are not resumed here.

075 observations are explicitly deleted at `retention_expires_at`, including
rows whose parent remains inside its own terminal window. Deletion follows
native terminal writes so an already-expired observation created by that write
is removed in the same pass. Observation UPDATE-only heartbeat cannot recreate
a deleted row. The source owner separately maintains the trigger's original
deadline/terminal expiry cap so later native writes cannot freshen an expired
observation.

## Bounds and compatibility

The native sweep still returns exactly `{expired, deletedRuns, deletedFlows}`.
Its original per-pass global work budgets remain expired Run 100, old terminal
Run 200 and deleted Flow 100. The observation queue is bounded to 200 selected
rows plus observations of up to 100 Runs terminalized in the same pass. Request,
occurrence and closed-month cleanup remains in the captured scope. Expiry and
seven-day anchors are unchanged; the work is now partitioned into independent
scope transactions rather than a single cross-guild transaction. A failed
later scope does not roll back already completed valid scope cleanup.

These are maintenance work bounds, not a new operating profile, capacity
benchmark or retention grace period. A stopped PC is not claimed to have
physically deleted any data. Independent target authority/writer compatibility
remains required before future runtime activation.

## Prepared regression evidence

The existing `tests/integration/alpha16-runtime-store.test.ts` synthetic fixture
now provides the real independent safety interface: complete in-memory scope
target roots, finite unchanged expiry, generation/CAS fence to UNKNOWN and
matching initial local verified generation/time. No real credentials or
providers are involved.

Two RET06 specifications assert that the native sweeper removes admitted rule
children before their terminal parent without losing/extending UNKNOWN roots,
and that an observation is erased at its earlier own expiry while its parent
is still retained. They have not been executed. No passing result is claimed.
