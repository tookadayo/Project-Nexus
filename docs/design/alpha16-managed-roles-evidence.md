# ADD-05 managed role flow-policy implementation

Status: source implementation only. Tests, type checking, lint, build, database
execution and browser checks have not been run. No new investigation or test
suite was executed for this continuation request. Later native-admission source
fixtures were added without running them.

## Concrete representation and persistence

The dedicated `/automation/managed-roles` workspace and signed Automation BFF
routes provide create, list, detail, edit and delete operations. Each policy is
an ordinary `FlowDefinition`: one fixed role, one GRANT or REVOKE operation,
one manual `MemberRef` input and one `approvalRequired` role action. There are
no loops, batches, role wildcards, external HTTP calls, arbitrary code, new Run
kinds or direct Discord requests.

`packages/automation/src/managed-roles.ts` converts this typed policy to the
existing immutable Flow revision format and verifies that stored definitions
still have exactly that shape. UI positions do not grant authority. A prefix
only locates candidates; exact definition checks protect every mutation.
Definitions edited outside that shape remain accessible in the ordinary Flow
editor and cannot be silently overwritten by the dedicated editor.

Saving calls `AutomationService.save`, retaining native validation, storage
limits, immutable revision creation and Draft semantics. The previous enabled
revision is displayed separately and is unchanged by saving a draft. Deletion
calls the existing soft-delete/disable method, including its ordinary pending
Run cancellation behavior. Native operation history remains Run-bound and is
read without member inputs, approval payloads or variable bodies.

No independent policy database is introduced: the policy identity/version is
the existing Flow identity/revision. A global role policy shared by unrelated
Flows, dynamic role collections and separate policy lifecycles cannot be
represented without additional schema, writer and retention contracts, and
are outside this finite implementation.

## Request and authorization binding

New API routes reuse the existing signed public-session proof, native member
snapshot and CONFIGURE permission. The facade joins canonical scope locks
before native automation locks, locks the exact Flow and rechecks proof expiry,
current permission and deletion state after waiting. Update/delete compare
draft revision, enabled revision and generation.
The dedicated client explicitly supplies `csrfHeaders`; PUT/DELETE and all
managed-policy variants use the existing bounded Automation BFF forwarding
path, with no additional generic forwarding route.

The existing `automation_requests` receipt/fingerprint is reused. Optional
`requestBinding` arguments were added to native save/delete; old callers keep
their signatures and hashes. Managed policy hashes additionally bind the
profile, policy ID and all expected versions. Same-key/different-body replay
is rejected; a committed result can be read using the existing request lookup.
The UI prevents concurrent submission and stops mutation retries when the
result is unknown, offering read-only receipt reconciliation instead.

## Review and execution boundary

Validate, simulation and impact invoke the existing native check method on the
exact immutable revision. Simulations explicitly require a mock member and
mock outcome, with no provider calls or production Runs. Existing role native
preflight, protected/privileged-role restrictions, bot hierarchy, current
permissions, GOVERN approval and operation UNKNOWN handling remain the sole
execution contracts.

`bindManagedRoleRun` fixes the policy ID/revision, semantic hash, role,
grant/removal operation, current guild, one member and request ID. It builds
the exact `managed_member` input shape accepted by the existing manual Run.
It accepts neither arbitrary role inputs nor provenance/authority claims.

The dedicated enable and Run routes now call the existing
`AutomationService.enable` and `.start` behind an optional server-installed
`ManagedRoleAdmissionAdapter`. Missing installation remains
`MANAGED_ROLE_G3_NOT_READY`; there is no fixed forever-disabled branch. The
native service has optional request-binding/before-write/before-receipt hooks;
without them, existing caller fingerprints and behavior are preserved.
Save/enable/disable/start acquire the complete canonical set, including the
actor subject, before native automation locking. The facade adds no later
subject lock that could reverse the sorted advisory-lock plan.

The adapter must prove current scope/actor, exact binding and finite expiry,
allowed role/native policy, member eligibility when applicable, native approval
pipeline, actual worker writer compatibility and independent retention
enforcement. Its `IndependentSafetyAuthority` needs both the current provider
and independent one-use fence writer. The configuration/Run transitions only
read and recheck safety; they do not consume a send token. Actual effects still
require the adopted native worker's one-use fence, role preflight, GOVERN
approval and UNKNOWN handling. A read-only provider is not a ready runtime.

Independent/native observations are prepared outside the PG transaction. The
final transaction checks current permission/deletion after waiting, the exact
current composite Flow version, the independent/local OPEN root and unresolved
Run/operation guards before the native write. UNKNOWN is never reopened by
changing revision or requesting another Run. The existing native receipt is
written atomically with the transition/accepted Run; no new Run kind or safety
history was introduced. Current actor/proof and original wire expiry are checked
again immediately before the receipt.

`prepare-enable` and `prepare-run` issue purpose-separated communication wires.
`ManagedRoleRequestAuthority` implements HMAC issue/verify using an explicitly
supplied existing deployment key, with no key generation/config changes. The
signature binds scope, actor, policy/revision/hash/generation/state, fixed role,
operation, member, request ID, original issuedAt and original expiry. Expiry is
the earliest current native/safety/public-auth proof or existing seven-day
receipt limit. An old signed wire remains expired after its native receipt is
purged; it cannot become a fresh Run. These wires are not operation tokens or
deletion receipts, and do not need a new persistent history class.

The API composition path accepts the optional trusted adapter as the seventh
`registerAlpha15Automation` argument, then passes it to the dedicated routes.
No adapter/provider/signer or production setting was installed in this work.
The default server therefore remains intentionally unavailable until those
existing external/runtime contracts are verified. DTO capabilities come from
actual server checks and native review state. The ja/en UI uses these dynamic
capabilities, a distinct actual member input, explicit confirmation and
prepare→wire→native mutation. Wire material stays in request-local variables.
An unconfirmed native transition goes to existing read-only receipt lookup,
with no automatic mutation retry.

## Source deliverables

- `packages/automation/src/managed-roles.ts`
- `packages/automation/src/managed-role-admission.ts`, trusted proof/communication
  signer and same-transaction guard contracts.
- Minimal optional request binding/write-check hooks in AutomationService.
- `apps/api/src/alpha16-managed-roles.ts`, registered by the existing Automation
  API and forwarded by its existing authenticated BFF.
- `apps/web/app/automation/managed-roles/{page,workspace,client}` and scoped CSS.
- Discoverable link from the existing Managed Role panel.

The source defines ja/en text, empty/denied/unavailable states, explicit mock
inputs, version conflicts, cancel/back controls, dirty-state protection,
duplicate-click prevention and unknown-result reconciliation. These behaviors
still require the deferred integrated UI and runtime verification phase.

`tests/unit/alpha16-managed-role-admission.test.ts` specifies exact binding,
original wire expiry after receipt loss, and stale/mismatched native proof.
These fixtures are unexecuted. Separately, the prior runtime-store integration
fixture was updated for the independent complete scope provider, UNKNOWN CAS
fence and verified-generation fields; its tests also remain unexecuted.
