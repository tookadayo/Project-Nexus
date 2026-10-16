# Alpha16 Webhook compatibility evidence

The default Webhook sender is deliberately stopped until a trusted dispatch
adoption supplies the runtime, finite target-safety policy, independent retention
enforcement, compatible writers and authoritative current-safety checks. This is
an external-dispatch boundary, not a general Operations CRUD/read shutdown.
No source, permission, credential, operating policy or application configuration
was activated during this investigation. No Discord or external HTTP was sent.

## Behavior and compatibility

|Path|Current behavior|Classification|
|---|---|---|
|`CommunityOperationsWorker.tick` -> `new WebhookWorker(db, vault)`|No dispatch options are supplied. `WebhookWorker.tick` returns `false` before DB reads, event expansion, claims, queue-state writes or transport.|Intentional safety stop. Saved pending work is preserved; it has not been successfully delivered.|
|`WebhookWorker.observeCoverage`|The existing capability/coverage comparison can still create a `coverage.changed` domain event; sending it remains gated independently.|Existing observation behavior, not a dispatch admission.|
|Webhook create/list/rotate/disable and maintenance update/delete|Runtime dispatch options are not consulted. Existing current permissions/feature limits still apply; Web BFF calls also bind a fresh scoped actor proof and configuration revision. Listing removes secret path/query details and exposes only a public origin.|CRUD/read remain available within their own permission/plan contracts. A successful enable does not prove dispatch readiness.|
|`ActionWorker.tick`|Only payloads explicitly containing `ruleRuntimeContract` or `ruleOperationIntentId` fail closed with `RULE_RUNTIME_UNSUPPORTED`; ordinary legacy action payloads continue through their existing path.|Intentional rejection of new rule intents by an unadapted worker, not a blanket legacy-action failure.|
|Existing deliveries without endpoint revision/safety epoch|They do not match the new send candidate query. No backfill or inferred admission is performed.|Intentional preservation. They require an explicit compatible adoption rather than automatic resend.|
|Adopted fixture path|Admission commits before mock transport; timeout/non-2xx/ambiguous outcome becomes `UNKNOWN` and blocks the endpoint. Expired admitted leases become `UNKNOWN`; late success cannot reopen them.|New no-resend contract. Stateful integration fixtures are prepared; this investigation did not execute DB tests.|

The actual default composition is `apps/worker/src/community-operations.ts`, not
`apps/worker/src/actions.ts`. The two workers use different persisted queues:
`webhook_deliveries` and `action_outbox` respectively.

## Concrete regression found and source correction

`enforceOperationsPlan` previously changed both `PENDING` and `RUNNING` deliveries
to `PAUSED_PLAN_LIMIT` when Webhooks became unavailable. Migration 068's monotonic
admission trigger forbids an admitted delivery from returning to a resumable
state. A plan downgrade during an admitted request could therefore throw
`WEBHOOK_ADMITTED_RESET_FORBIDDEN` and roll back the entire plan-enforcement
transaction. This affects both `CommunityOperationsWorker.tick` and the Operations
data GET, which runs plan enforcement before reading its sections.

The source correction in `packages/operations/src/plan-policy.ts` retains the
canonical scope -> legacy privacy -> Operations lock order and takes endpoint
roots in sorted order before delivery children. Admitted `RUNNING` rows become
`UNKNOWN`, lose their lease, keep the original admission/deadline/time anchors,
and set their endpoint to `UNKNOWN_BLOCKED` with a monotonic safety epoch. Only
never-admitted rows can become `PAUSED_PLAN_LIMIT`. Other feature pauses and the
plan fingerprint can then commit in the same transaction. Nothing automatically
resumes or retries an uncertain request.

`tests/integration/alpha16-webhook-plan-compatibility.test.ts` covers the downgrade,
the unchanged original clocks, an unadmitted pending row and an unrelated feature
pause committing together. Execution is delegated to the DB integration owner.

The adopted sender also selected only the oldest `OPEN` candidate before checking
target/secret expiry and authoritative safety. An ineligible oldest row could
therefore block another endpoint indefinitely. Candidate SQL now excludes known
expired/mismatched safety, expired secrets, already-admitted work and events before
the adopted activation boundary. At most 100 candidates are inspected; a false
current-safety check skips only that candidate without changing its state,
attempts or clocks. This pre-admission rejection never becomes a sent-result
`UNKNOWN`.

A shared, scope/profile-bound volatile cursor keeps exact PostgreSQL microsecond
queue ordering across freshly constructed workers. It contains queue time and
delivery UUID only, carries no authorization, and is capped at 10000 scopes.
Its initial five-minute cache deadline is shortened by original target/secret
expiry, never extended by progress, and a lazy unref timer deletes it. Profile
change and capacity eviction clear its timer. No cursor or timer is created on
the unconfigured path, and cursor expiry cannot activate dispatch. The existing
profile has no absolute expiry field; no invented profile deadline is substituted
for an approval. Current target/operator authorization remains mandatory on every
candidate. The sender still admits at most one request and invokes transport
only after the transaction commits; its result handling is unchanged.

The candidate regression fixture preserves three ineligible rows while sending
one eligible later row exactly once. A second case places 105 rejected rows and
one valid tail within one millisecond at distinct microseconds, then constructs
a fresh worker to prove bounded scan progress without changing rejected rows.

## Other findings sent to the integration owner

- The old `scripts/dev.ts` beta-work wrapper holds a legacy privacy shared
  session fence around `communityOperations.tick`. Plan enforcement now acquires
  canonical scope locks first, so concurrent privacy deletion can invert the
  order. The composition owner moved this call to `runCommunityMaintenance` in
  `apps/worker/src/community-work.ts`: legacy work completes within `betaWork`,
  then the community callback starts after release. This preserves the existing
  Beta rejection path and native community authorization checks.
- Webhook -> parent-run synchronization in `apps/worker/src/playbooks.ts` and
  `apps/worker/src/reports.ts` originally included `SUCCEEDED`/`FAILED` only.
  `UNKNOWN` could remain hidden behind a parent `QUEUED` state. The root source
  correction includes `UNKNOWN` in both synchronization queries without adding
  retry logic. The dedicated parent-uncertainty integration fixture exercises
  both public worker `tick` paths with stopped authoring definitions, verifies
  parent/execution uncertainty and unchanged original clocks, and rejects any
  additional render, intervention, outbox or transport work.
- Existing playbook/report delivery writers do not stamp endpoint revision and
  safety epoch. Their saved deliveries are intentionally not adopted. Those
  writers must be verified before any future `targetWritersCompatible: true`
  production adoption is accepted; this review did not populate old rows.
- The old Operations page conflated endpoint enabled/key-version state with
  delivery readiness. Its Webhook section now explains the saved `UNVERIFIED`/
  `UNKNOWN_BLOCKED`/`OPEN` gate in Japanese and English, retains ordinary disable,
  and disables ordinary re-enable for an uncertain target. The text explicitly
  separates enabled state from actual dispatch readiness. It does not fabricate
  an adopted profile or a server capability.

## Executed verification

Used only the installed local runner, with process-local `TEMP`/`TMP` set to
`C:\Users\reito\AppData\Local\Temp`. No package-manager download or configuration
change was needed:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/outbound-security.test.ts tests/unit/outbound-transport.test.ts tests/unit/alpha16-maintenance-authorization.test.ts tests/unit/alpha16-operations-completion.test.ts tests/unit/alpha16-webhook-worker-compatibility.test.ts --maxWorkers=1
```

Latest result after the source corrections: **5 test files passed, 25 tests
passed**, exit 0, duration 2.35 s.
The outbound transport suite mocks both `node:dns/promises` and `node:https`;
the checks cover public-only pinned DNS, rejection of mixed/private answers,
bounded stalled DNS, URL restrictions and current actor/scope/expiry proof.
The direct worker suite uses throwing DB/vault proxies and a mock transport;
missing options, an invalid runtime profile and an unapproved dispatch policy
each return before touching those dependencies or the authority callback.
These passing unit tests do not establish DB lock ordering, SQL trigger behavior
or successful delivery by the disabled application composition.

Focused ESLint passed (exit 0) for `webhooks.ts`, `plan-policy.ts`, the Operations
view, the direct worker unit and both new integration fixture files.
`git diff --check` passed for the three changed application source files (only
the repository's existing LF-to-CRLF notices were emitted).

DB integration, application/worker startup, actual network dispatch and production
deployment performed by this investigation: **0**. Relevant stateful suites are
`tests/integration/operations-api-webhooks.test.ts`,
`tests/integration/alpha16-integrations.test.ts`, the plan compatibility fixture
and `tests/integration/alpha16-webhook-candidate-compatibility.test.ts`. Their
execution/results belong to the DB integration owner. The root
agent separately owns whole-project type/lint/build and other unit results.

The DB owner subsequently reported **16 relevant integration cases passed**
across those four Webhook suites, using private PostgreSQL, embedded loopback
Redis and injected transport only. Inspection of
`.local/alpha16-db-webhook-source.log` confirms all named cases and exit 0; that
batch also contains six separate source-metadata cases (22 total). No real
Webhook or Discord delivery was used.

## Follow-up regression verification

`tests/unit/alpha16-community-work.test.ts` passed **5/5**, exit 0, duration
329 ms. Four tests execute the helper with a mock legacy-fence owner: legacy work
runs while held, community work starts only after release, Beta rejection and
legacy failure do not start community work, and a community failure is not
automatically repeated. A separate TypeScript AST guard verifies the actual dev
script calls this helper outside `betaWork` and passes `communityOperations.tick`
through its community callback. Importing the dev script would launch the app,
so the guard inspects wiring without starting it. These are callable-protocol
and composition tests, not a claim that a live DB deadlock was reproduced.

The additional fixture
`tests/integration/alpha16-webhook-parent-uncertainty.test.ts` contains the two
parent synchronization cases described above. It was saved and handed to the
DB owner; its result is tracked separately from the already-passing 16 cases.

The expanded DB run also exposed fixture-only version/identity errors:
`alpha16-rollback.test.ts` used a non-hash synthetic actor incompatible with the
current 64-hex SUBJECT-lock contract. Its synthetic actor now satisfies that
contract; production locks were not changed. `alpha15-events.test.ts` migrated
only through 52 and manually applied 54/57/59 while executing the current runtime,
omitting the correctly registered 075 execution-observation table. This runtime
acceptance fixture now runs the normal full migrator. No missing-schema fallback
or relaxed production guard was added. Its in-flight preflight wait also observes
early worker rejection directly instead of hiding a missing-table error behind
the 30-second test timeout. Both corrected fixtures were handed to the DB owner
for repeat verification.

The same strict SUBJECT-lock contract exposed 25 synthetic Actor declarations
in 25 alpha15 integration files. Each now derives a stable SHA-256 hex identity
from its original fixture label. Two corresponding bounded-waits database actor
references follow `actor.key`. The apparent 26th candidate is the deliberately
untrusted `key: 'web-admin'` API payload and remains unchanged, as do unrelated
`options.key`, independent record identifiers and request IDs. The events Actor
was already vault-hashed; the role-approval file remains with its separate owner.
Production identity/lock validation was not weakened. Focused ESLint passed for
the Actor fixture files and the community/event/parent-uncertainty follow-up files.
The DB owner was notified that all these fixtures are frozen and ready to rerun;
their rerun outcomes are not inferred from the lint result.
