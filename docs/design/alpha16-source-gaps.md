# Alpha16 source availability and remaining decisions

Recorded 2026-10-16. This inventory separates implemented readers from data that
the existing system does not observe. It is not an execution, G4, or activation
claim. The formal 37 input files remain unchanged.

The native Rule source contracts, typed source configuration, native target
drafts, operational CASE profiles/checklists, the 079/080/082 source plugins and
the 081 metadata contract have implementation source. Ordinary schema, CRUD and aggregation work
is not treated as an approval blocker. Runtime source coverage and current
authorization still have to be proved for each actual request.

## Reconciliation with the formal contracts

The formal priority is the latest user decision, then the integrated contract
corrections and migration plan. `alpha16-spec-deltas.md` supersedes the formal
documents' old candidate status only for the adopted direct recommendation READ
policy and the specified 48-hour Facts/evaluation/health/evidence and fourteen-day
minimal history/audit/suppression/receipt purposes. Run-derived state and backups
keep their seven-day ceilings. It does not authorize a new source, new personal
collection, a fixture operating profile or a different retention purpose.

Formal II-A defines HELP at the SLA-mature intake grain and requires actual
first-response or explicitly STALLED state. The migration plan sections 6.1,
6.3 and 6.4 and integrated corrections section 5 require source absence to stay
distinct from a normally observed but unconfirmed outcome. V-B CASE03/04 expressly
routes unavailable source to INELIGIBLE, rather than an optional confirmation
recommendation. The missing intake-policy-to-issue relation below therefore
closes those cases' operational enablement, including their staff-only branches.
It does not close direct READ of other compatible recommendations.

| Classification | Current evidence | Consequence |
| --- | --- | --- |
| Ordinary reader/adapter implementation | `native-projections.ts` dispatches the fourteen closed descriptor kinds to the cohort, Run, execution/permission, Report, issue-registry and exact-health readers. `operational-context-plugins.ts` registers the three server CASE plugins. The native-source and CASE owners confirm no known ordinary unimplemented reader or source form remains in these scopes. | No new independent ordinary implementation gap was identified by this source reconciliation. This is bounded source inspection, not behavior or full acceptance proof. |
| Missing authoritative semantics/binding | HELP numerator, exact CASE03/04 issue relation and the genuinely unobserved fields in the table below. | Keep affected observations UNKNOWN or the affected case source-readiness unavailable. Do not invent a fact, target alias, column value or approval to enable them. |
| Reader exists, actual coverage insufficient | Legacy 081 stamps, historical role coverage, member overwrites, incomplete forum census and original detail retention. | The request can remain UNKNOWN despite an implemented reader. Do not label this as an unimplemented reader or observed zero. |
| Operational prerequisites | Measured config/budgets, current authority, purpose-specific retention and independent safety/publisher enforcement. | The affected persistence/evaluation/external operation remains gated. Other compatible recommendation READ has no pre-display approval requirement. |
| Unsupported typed editor | The formal section 6.1 REVIEW_ONLY fallback applies where native allowlisted editing/current version checks do not exist. | This is an action capability limit, not a fabricated metric source or a reason to hide readable recommendations. |

`BLOCKED_NATIVE_SOURCE_CONTRACTS` is retained compatibility diagnostic metadata
for callers without the required typed binding; the actual native dispatch below
it calls the implemented readers. The constant's historical name is not evidence
that those seven readers remain unimplemented.

## Missing authoritative semantics

| Consumer | Exact missing observation | Existing data that must not substitute |
| --- | --- | --- |
| HELP backlog / first-response cohort | Request-bound actual first-response time and explicitly structured STALLED outcome, with original revision and expiry; alternatively an authoritative request/message binding with a separately settled response definition | Native intake attention keys are `intake:<UUID>` with no channel. Discord reply clocks use real message snowflakes. ACK, IN_PROGRESS, elapsed age, unrelated replies, notification dedupe keys and attention resolution do not establish the required intake outcome. |
| CASE02 `welcome.noContact` | An already permitted, exact subject-specific no-contact preference binding | Shared staff declarations, absence of activity and a guild resource ID are not personal preferences. |
| CASE03 `support.askerOutcome`; CASE04 `support.askerExplicitOutcome` | An explicit outcome supplied by the original asker and bound to this issue | A staff resolution, reply count, age or reopened queue item is not asker confirmation. |
| CASE03/04 base Rule to individual issue | An authoritative relation between the HELP intake-policy root and this exact issue, using the same native request/message grain and current version | A policy UUID cannot become a Discord attention message ID through a type alias. The existing intake request/panel relation does not establish a request-to-Discord-message or first-response relation. The exact native issue readers do not invent that missing binding. |
| CASE05/08 `activity.optInInterest`; CASE07 `format.preferredFormat` | An authorized voluntary-interest or format-preference source with the exact compatible scope | Participation counts and staff opinion cannot establish individual or aggregate voluntary preference. |
| CASE16 `platformAlertType` | Exact currently active RAID_ALERT/SAFETY_ALERT/NONE observation and its source contract | Raid/DM-spam incident timestamps and a temporary disabled-until clock do not establish the active platform alert class. |
| CASE19 `authorizedAggregateViewing.*` | A compatible, authorized aggregate viewing source and availability/stability observation | Posting is not viewing, readership or proof of a view-source census. No per-reader tracking is introduced. |

These fields remain UNKNOWN. Adding a column cannot create the missing fact.
CASE03/04 operational enablement is explicitly unavailable while the exact
issue-target relation is absent (`CASE_ISSUE_TARGET_SOURCE_UNAVAILABLE`). This
also prevents staff-only branches from proposing an individual issue action on
a policy UUID. It is a source-readiness restriction, not an approval requirement
for displaying recommendations from other compatible cases.
The concrete checks are `operational-context-contract.ts`
`caseOperationalSourceReadiness`, `OperationalCaseContexts.validate` before
enabled PROFILE_SAVE, `readStoredOperationalCase`, and all active-profile reads
inside `createOperationalCaseRuntime`. Disabled finite drafts, catalog reads and
existing request-status reads remain available under their existing permissions.
An old or malformed enabled profile cannot bypass the runtime exclusion.
New person collection, a new response/acquisition contract, permission expansion
or an external source must be decided explicitly before the affected source can
be completed. Independent implementation is not stopped by these missing fields.

## Coverage conditions, rather than missing reader implementations

- CASE20 can read exact retained channel/thread reply metadata. A forum container
  without a complete archived-thread census cannot establish the latest reply
  across all children and remains UNKNOWN.
- Prospective Bot/Webhook direct-reply, mass-mention and scheduled-event metadata
  use 081 protocol stamps. Legacy rows and queues are not backfilled. Actual
  continuous protocol/window coverage is required before a zero can be observed.
- The role-access plugin uses explicitly selected representative roles, not a
  person's permissions. Member-specific overwrites whose effect cannot be
  excluded keep effective access UNKNOWN; Bot permissions do not substitute.
- CASE02 staff-reply classification needs existing role observations compatible
  with the original reply time. A current role refresh cannot certify historical
  staff status. No new per-post personal staff-classification stamp is stored;
  insufficient historical role coverage remains UNKNOWN.
- Retained cohort details, maturity, original expiry, current surface visibility,
  gateway gaps and required source revisions can make a particular observation
  unavailable even though its reader exists. An older comparison window does
  not authorize longer personal-detail retention.
- Actor erasure invalidates dependent native snapshots and references before
  deleting their source. Erased reply provenance cannot become a fresh
  unanswered clock, an observed zero or a new capture of the old value.

## Separate activation and acceptance gates

Measured finite operating budgets, source approvals, purpose-specific retention,
independent target safety/tombstone/publication enforcement and current real
authorization remain activation prerequisites. Their absence is different from
missing source semantics. READ and direct recommendation display do not acquire
a pre-display approval requirement.

The user has now authorized consolidated verification. The parent owns its
execution/results ledger; this source reconciliation does not assert that a
command passed, change any recorded result, or claim G4 acceptance. This source
reconciliation consists of static reads and documentation updates. Later
owner-targeted verification belongs to the parent's results ledger. Web/UI/build,
migrations/SQL, Discord calls, production configuration, deployment, merge and
push were not performed by this review.
See [validation status](alpha16-validation-status.md),
[native source evidence](alpha16-native-source-evidence.md),
[operational CASE evidence](alpha16-operational-context-evidence.md), and the
[alpha17 handoff](alpha16-alpha17-handoff.md).
