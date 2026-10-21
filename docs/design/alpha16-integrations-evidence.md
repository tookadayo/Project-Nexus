# alpha16 integration maintenance and dispatch evidence

Status: code and isolated fixture definitions written. Tests, type checking,
lint, build, migration execution and live UI checks have not been run during
the shared implementation phase. No credential was issued, provider contacted,
or existing database changed by this work.

## Maintenance contracts

- `Destinations.update/delete`, `ApiCredentials.update/rotate`, and
  `Webhooks.update/delete` require an injected `MaintenanceAuthorizationProof`.
  They take canonical GLOBAL/organization/guild/subject scope locks before
  legacy privacy/operations locks, recheck current CONFIGURE permission,
  entitlement, actor deletion state, scope and proof expiry, and perform
  exact revision comparisons. Target/FK waits are followed by another check.
- Inputs are strict allowlists. Discord channel/role metadata checks happen
  outside transactions after authorization; current authorization is checked
  again when writing. HTTPS URL validation is reused, and the transport still
  resolves and pins public addresses without following redirects.
- Routing changes and deletions reject referenced playbooks (including
  immutable revision references), reports, intake panels and all recorded
  effects. A name-only edit does not retarget existing work. Incoming target
  foreign keys become deferred NO ACTION so removal cannot cascade away
  guards/history. Whole-guild erasure still requires all referenced rows to
  be removed in the same transaction.
- Credential rotation revokes the old row and creates a different credential
  ID atomically. The existing current-credential effect fence rejects both
  old tokens and requests authenticated with the old ID before rotation.
  Only the initiating successful response receives the new token; retries do
  not recover or issue another secret. Public lists contain neither hashes nor
  secret values. Webhook lists expose only URL origin, with explicit URL
  re-entry required for edits.
- `redactWebhookEventSources` stops unsent pending work and fences uncertain
  work before source erasure. Referenced events retain only their payload-free
  envelope (`data={}`, dedupe key replaced with its opaque event ID), with
  expansion disabled and original time anchors.
  Unreferenced events are removed. Source deletion therefore cannot cascade
  away an in-flight/UNKNOWN delivery; no private form fields or new retention
  period are copied into the uncertainty metadata.
- Migration 068 adds credential/endpoint CAS revisions and triggers tracking
  legacy configuration writers, without incrementing revisions for usage
  counters. Legacy web BFF/buttons now send expected revisions and inject
  fresh membership proof. Both new and legacy one-time secret displays use
  transient component state with a close/hide control.

## Webhook safety correction and alpha17 G3 dependency

The former worker performed POST inside a database transaction and reset
expired leases/network failures to pending. Those paths have been replaced.
The worker now commits a PG admission/fence before calling transport outside
the transaction. Missing responses, deadlines, non-success HTTP responses and
lost leases become UNKNOWN, with an endpoint UNKNOWN_BLOCKED gate in the same
transaction. No retry path re-POSTs that delivery. Legacy reset writers are
rejected by an admission-monotonicity trigger. Ordinary edits, enabling,
secret rotation and expired safety state cannot open an unknown target.

Dispatch is **disabled by default**, including existing app worker factories.
An absent policy returns before touching pending queues/events. Enabling a
future worker requires an explicitly adopted runtime profile, finite
TARGET_LIVE_SAFETY policy/revision, independent retention enforcement, verified
target-writer coverage, an activation start instant, live operator controls,
and an authoritative current-safety callback. There is no production policy
value or automatic OPEN initializer in this patch. Old deliveries lacking a
snapshot are not implicitly promoted, and events before activation are not
backfilled. Initial endpoint state is UNVERIFIED.

Alpha17 operational G3 must implement and verify safety initialization,
read-only reconciliation, finite safety-root retention/expiry, restore
tombstones and all old writer/purge paths before injecting these options.
Existing operational retention is not declared compliant or silently extended
by adding the fields. The old pending backlog remains intact while dispatch
is gated. No arbitrary HTTP block/AI capability is added.

## Fixture evidence prepared, not executed

`tests/integration/alpha16-integrations.test.ts` covers scoped/expired/missing
proof, concurrent CAS, referenced-target deletion/routing, credential rotation
and old-auth fence, URL redaction/SSRF, unchanged pending work without policy,
commit-before-transport, unknown result blockade and expired lease recovery.
All approvals/numbers in that file belong to isolated fixtures only.
The existing `operations-api-webhooks.test.ts` fixtures now inject the explicit
synthetic profile for signing/rotation/success cases and assert that a 503
after admission is UNKNOWN with one attempt, instead of expecting blind retry.

`tests/integration/alpha16-runtime-store.test.ts` additionally defines the
parent-Run deletion regression: migration 062 rejects parent deletion while
derived runtime intents remain; canonical purge fences the target first.
The trigger acquires no reverse-order advisory/root locks.
