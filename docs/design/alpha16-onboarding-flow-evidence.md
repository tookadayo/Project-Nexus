# alpha16 ONBOARDING_FLOW authoring evidence

Status: source implementation and synthetic test code prepared. No test, type check, lint, build, migration, database, browser, Discord, deployment or production operation has been run for this change. Original specification files are unchanged.

## Native configuration boundary

`packages/onboarding/src/flow-drafts.ts` adds immutable configuration snapshots in migration 072 (`onboarding_flow_workspaces`, `onboarding_flow_drafts`, `onboarding_flow_publications`). Save, edit, duplicate and delete affect configuration copies only. No member answers, identities, sessions or automatic activation are created. The graph uses the existing strict `Flow` schema and `validateFlow`, with native node/choice limits and no arbitrary code.

Explicit publication joins `SettingsService.mutateInTransaction` and the existing OnboardingService allocator via `publishOnboardingFlowInTransaction`. Settings, immutable native `flow_versions`, native audit, publication mapping and request result commit or roll back together. Regular publish/rollback and the new writer use the same canonical scope and guild configuration locks, settings CAS, and `MAX(version)+1` allocator. MAIN changes only the main flow reference; HYBRID changes only the hybrid flow reference. Enablement/mode and existing pinned sessions are preserved. Hybrid native prompt overlap uses the existing current capability record and existing freshness boundary.

The typed rule adapter factory `createOnboardingFlowDraftAdapter` validates the native current flow target and a bounded token sealing both current heads, definition hash and settings revision, then writes an immutable draft within the caller transaction. It never publishes or enables a flow. The common rule catalog remains REVIEW_ONLY; viewing recommended responses does not require approval.

## Current authorization and transport

Every new service read/write receives a trusted server proof for the current actor and scope. BFF constructs its ten-second expiry from `operationsContext`; clients cannot supply the proof. The service checks current READ/CONFIGURE, existing fallback/hybrid feature entitlements, tombstones, proof after locks/waits and before native writes. The BFF requires the displayed guild, same origin/CSRF boundary, bounded strict bodies, If-Match and a prepared server request identity.

`flow-authoring.ts` prepares an exact operation fingerprint and reuses the existing minimal LIFECYCLE_WEB_REQUEST purpose; the ledger stores no definition/answers. Publication target probes for existing allowed channel/role IDs run after the read transaction closes. A second transaction compares the sealed immutable definition, selected slot, current native head/settings/plan/proof and checked targets. A completed request replays its known minimal result; a claimed unknown request is stopped before any re-probe or resend. Expired/deleted identities cannot become new operations. Request result and native writes share one transaction.

Flow drafts use the existing Flow configuration purpose; deletion removes the configuration copies. No arbitrary retention duration was invented. `purgeOnboardingFlowDrafts(tx,scope,userId?)` is exported for existing guild/subject erasure; subject cleanup removes draft groups containing an exact synthetic/native ID mention without adding creator/member tracking. The shared request retention policy is still unset in the source at implementation time, so API mutations remain explicitly disabled until its existing-purpose policy is aligned by the parent integration task. READ/local preview remain usable. This policy gate is distinct from source implementation completeness.

## Web surface

`/onboarding-flows` (GET/HEAD) and `/onboarding-flows/data` (GET/HEAD/POST) provide bounded draft/current/published lists, version detail, copy/edit/delete, structured graph editing, pure local simulation and explicit publication preview/commit. READ displays current authorized configuration directly. Channel/role choices are current server-side Discord reads. Local preview keeps answers in browser memory only and calls the existing pure graph runtime. Japanese/English strings, plan/permission/retention gates, empty/loading/error states, back/cancel, stale base conflicts and synchronous double-click protection are implemented. Unknown transport results allow saved-key status checks only, with no automatic resend.

The public route allowlist/navigation integration is owned by `datetime_contract_audit`. Migration registration, privacy hooks and retention-purpose alignment are owned by the parent.

## Prepared verification (not executed)

- `tests/unit/alpha16-onboarding-flow.test.ts`: six tests covering strict finite authoring fields, graph requirements, version/slot pairing, immutable publication binding, bounded sealed native target version and pure shared-branch preview.
- `tests/integration/alpha16-onboarding-flow.test.ts`: eleven tests covering immutable revision save/edit, caller transaction rollback, native publication/rollback allocator compatibility, hybrid-only publication, guild/CAS conflicts, current proof expiry after waits, final-write rollback, external probe lock boundaries, unknown/no-resurrection behavior, typed draft-only adapter and deletion isolation.
- `tests/e2e/alpha16-onboarding-flow.spec.ts`: twelve synthetic UI cases (including locale/status expansions) covering 320px Japanese/English, plan/permission/communication states, local simulation/cancel, double click/prepared identity/CSRF headers, stale preview, explicit publication, conflict and unknown status checks.

Required next verification remains the agreed whole-implementation test/type/lint/build/UI phase. All assertions above describe source structure or prepared test intent, not passing execution evidence.
