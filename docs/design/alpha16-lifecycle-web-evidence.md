# Experiments and Lifecycle Intervention Web connections — 2026-10-16

This is an implementation record. All tests/type checks/lint/build/migrations/browser execution remain unexecuted under the parent's explicit consolidated-verification instruction.

## Existing services and read boundary

`packages/lifecycle/src/web-workspace.ts` delegates immutable draft creation, preview and publish to existing `domainRevisions`, experiment evaluation/control to `ExperimentService`, delivery queuing to `InterventionService.approve`, and guild-wide intervention pause/resume to existing `SettingsService.update` with the observed settings revision. No second assignment, delivery or experiment runtime is introduced. Operations InterventionReview is a separate parent-owned domain and is not substituted for Lifecycle Intervention.

The existing `ExperimentService.result` writes outcomes/results and may pause a guardrail breach. It is not a read operation. New Web GET reads persisted aggregate snapshots directly. `ExperimentService.latestResult` adds a pure snapshot read, and the existing v02 `/dashboard` GET now calls that method instead of evaluating results. An absent snapshot remains absent. Evaluation is an explicit protected POST and its UI explains the persistence/guardrail effect.

`ExperimentService.control` now serializes the initial-control-row race and optionally checks the observed state within its own transaction. Permanently stopped experiments remain irreversible. `InterventionService.approve` optionally narrows the atomic queued transition to the observed run state. Existing callers remain compatible. Publish keeps the preview hash/current head check, plan checks and current Discord channel/event/allowed-role checks. Experiment intervention references must be published revisions in the same guild. There is no cross-guild reference widening.

## Web surfaces

- `/experiments` and `/experiments/data`: version list/details, structured new/edit draft, eligibility conditions, nested finite condition editor, before/after preview, publish, pause/resume/permanent stop and saved aggregate results/explicit evaluation.
- `/lifecycle-interventions` and `/lifecycle-interventions/data`: equivalent revision/condition/action editor, preview/publish, existing guild-wide intervention flag pause/resume, bounded run history, explicit queue-delivery action for suggested/approval runs, and native pre-admission cancellation for a selected unattempted run.

The current live OAuth/server identity and operations permission are verified by the server. Legacy administrative service authorization is preserved rather than expanded to new roles. The BFF rejects unknown fields/query operations, browser-supplied scope/person, wrong domain, oversized bodies, missing displayed guild, missing prepared identity and missing/mismatched version/state conditions. Existing nested definitions are bounded before recursive schema parsing. Empty numeric fields remain invalid, not example execution values. Current plan restrictions, empty versus communication/permission failure, stale observation/version conflict, cancel/back, repeated clicks and unknown results have explicit states. Japanese and English labels are provided.

Actual delivery confirmation remains an external-effect boundary. It is separate from the user's instruction that recommended responses are displayed directly without an approval workflow.

## Retained request identity and disabled scope

`migrations/069_alpha16_lifecycle_web_requests.sql` defines only an operation identity/fingerprint/minimal result-ID ledger, not raw input definitions/message bodies. `LIFECYCLE_WEB_REQUEST` is a new purpose with no approved lifetime inferred from 48-hour Fact or 14-day suggestion history classes. `LIFECYCLE_WEB_REQUEST_POLICY` is undefined, so all new Web mutations are initially disabled with a visible reason; authorized snapshot/config/run reading remains available.

A prepared operation is claimed durably before calling the existing service. The operation holds canonical scope locks while rechecking permissions/deletion/source/state and delegating to the existing runtime. If a separate existing-service transaction commits but confirmation is lost, the ledger stays CLAIMED/UNKNOWN and the wire identity cannot initiate another operation. The browser performs read-only result checks and does not resend or unlock an unknown request merely because its status is still prepared. Completed responses contain only minimal IDs/state. Privacy and expiry cleanup exports are connected by the parent.

The later root continuation added the finite native cancellation contract in `intervention-control.ts`: exact observed suggested/approval/queued state, zero attempts, and only clean unsent queue rows may become suppressed with `OPERATOR_CANCELLED`. The Web prepared request binds `INTERVENTION_CANCEL` and the observed state. Current proof, CONFIGURE and native locks/CAS are required; the request policy remains unset by default. Started, attempted, delivered or uncertain work is never labelled cancelled. Pausing the guild-wide flag cannot retract a delivered message or cancel an already in-flight external call. See [the cancellation contract](alpha16-intervention-cancellation.md). Unknown preexisting outcomes remain non-resendable.

## Prepared verification

`tests/unit/alpha16-lifecycle-web.test.ts` prepares six tests covering strict finite operations, unknown scope/fields, source pairing, publication/state preconditions, bounded nested structure, unspecified lifetime and fingerprints. `tests/integration/alpha16-lifecycle-web.test.ts` prepares ten database scenarios for read-only snapshots, disabled defaults, single immutable draft/replay, durable unknown non-repeat, actor/guild/source scope, stopped-state conflicts and privacy key removal. The policy values in these fixtures are synthetic only.

`tests/e2e/alpha16-lifecycle-web.spec.ts` prepares thirteen synthetic browser scenarios mounting the actual client component: both languages/domains at 320px, source/empty gates, snapshot/preview GET only, prepared key and state/CSRF/guild headers, double click, irreversible stop/cancel, nested condition preservation/editing, plan differences/run visibility, 403/503, unknown non-resend and CAS conflict.

None have been executed. Schema installation, actual browser OAuth, real Discord actions, plan enforcement in a live account, deployment and Windows production operation remain unverified. Migration registration, navigation links, public-boundary allowlist, privacy and maintenance wiring are parent/other-agent-owned integration points.


## Current authorization at legacy writes

New BFFs inject the shared `MaintenanceAuthorizationProof` from trusted live checkedAt + 10 seconds, actor hash and guild/organization scope. Both service reads and local mutations assert it after scope/permission waits and before returning/committing. The server also checks reads immediately before sending data. No browser-supplied proof is accepted.

Legacy revision draft/publish, experiment control/result, intervention approve and settings update accept an optional async `beforeWrite(tx)` callback. Existing call sites remain compatible. New Web calls use it to recheck current proof, operations permission and erasure under the legacy transaction after its native locks. Callback-enabled legacy operations acquire canonical scopes first. Experiment result evaluation with this callback executes all its outcome/control/result writes in one guarded transaction. The outer Web transaction is released before delegation, so an inner Settings transaction does not wait on its own outer guild lock. The original Settings canonical scope acquisition is preserved.

If a legacy service returns a known committed result, expiry before the separate receipt cannot turn that effect into a retryable failure. The service returns its minimal known result with `requestRecorded=false`; the claimed request stays non-repeatable. Added fixture code covers missing/actor/scope/deadline proof, expiry during access and inside the final legacy-write hook, and known committed success with an expired receipt followed by no repeat. These source tests have not been run.
