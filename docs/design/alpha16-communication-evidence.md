# alpha16 communication idempotency implementation

2026-10-16. Source changes and acceptance code only; all execution results are
NOT_RUN. This extends N16-02/11 contracts without enabling new actions, policies,
retention values, providers or deployment settings.

## Covered routes and purposes

`POST /api/rules/mutation-request-key` accepts an operation, optional target UUID,
optional expected version and the exact mutation payload. Operations are
`CONFIG_REVISE`, `SUGGESTION_VIEW`, `SUGGESTION_DISMISS`, `SUGGESTION_SAVE`,
`SUGGESTION_REJECT`, `SUGGESTION_DRAFT`, `EVALUATION_CANCEL` and `EVALUATE`.
The existing `evaluation-request-key` route remains a compatible EVALUATE
preparer. Both preparers require same-origin checks, a current real user, guild
scope, the operation's current permission and an approved REQUEST_KEY purpose.

Preparation has no target/provider effect. It stores only a body fingerprint and
a PREPARED reference in the existing `rule_request_keys` table. A server-signed
communication key is bound to organization, guild, actor, operation, target ID,
expected version and payload hash. It has no operation-admission or deletion
receipt authority.

Expiry is capped by REQUEST_KEY, the operation's retention class and applicable
parent/evidence/config/target/history expiry. EVALUATE also respects active-job
expiry and CASE adapter preparation metadata. Acceptance rechecks current
REQUEST_KEY policy, and the DB key retains exactly the wire expiry. Policy
shortening cannot leave a still-valid wire after its key record has expired.

## Transaction and replay contract

The operation runs only if its prepared row exists. Its target mutation and the
transition from PREPARED to a minimal resource reference commit together under
the canonical guild scope transaction. Completion also checks DB clock expiry.
A second request with the same key rechecks current authentication, authority,
scope and deletion state, then reconstructs the referenced resource's current
permitted response. It does not execute the operation again or serve a cached
response body.

Configuration references contain an immutable version, draft references contain
IDs/revision, user-state references contain the suggestion and operation kind,
and evaluation references contain the original job ID. No original payload,
recommendation text, secret, Fact or provider response is copied into the ledger.
Changed bodies/versions/targets cannot reuse a key. A missing/purged prepared or
completed row is 410; an old wire never creates another operation. This covers
early privacy invalidation as well as ordinary expiry without an indefinitely
retained key tombstone.

Suggestion Draft creation does not change the live version or invalidate its
source Suggestion. Its repeated communication instead returns the same immutable
draft link. Current target safety/policy revision and scope remain necessary for
that replay. UNKNOWN or expired roots deny draft creation and remove its UI
capability. Initial typed editors/actions remain unregistered in the public
construction, so these contracts do not activate Apply or external effects.

## Source files and prepared acceptance

- `packages/rules/src/communication.ts`: preparation, bounded wire verification,
  minimal references and same-transaction completion.
- `packages/rules/src/service.ts`: configuration, personal state, rejection,
  Draft and evaluation cancel integration, plus EVALUATE compatibility.
- `apps/web/app/api/rules/[...path]/route.ts`: same-origin preparation and key
  forwarding to every implemented state-changing operation.
- `tests/integration/alpha16-communication.test.ts`: preparation has no domain
  effect, concurrent config and draft retry dedupe, reference disappearance,
  source expiry cap, single history/version changes, UNKNOWN capabilities,
  deletion on replay, and current cancel status reconstruction.

No tests, type checks, lint, builds, migrations, provider actions or running app
were executed for this addition. The fixture policy is synthetic and is not an
operational default or evidence of accepted numerical settings.
