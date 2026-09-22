# v0.1 audit before v0.2 source changes

Inspected 2026-09-22. The repository has no commits; existing source is untracked. No reset, destructive replacement, or automatic commit is part of this migration. The two final user-provided v0.2 documents supersede the older WP-00–08 scope and ADR intent/retention limits.

## Inventory

Apps: gateway (allowlist → Redis Streams), interaction (signed HTTP → encrypted PostgreSQL jobs), worker (BullMQ scheduling, stream projection, interaction jobs, action outbox), api (guild-scoped HMAC-authenticated overview), web (Next.js server-rendered read-only overview with Basic authentication).

Packages: config (environment validation), db (Kysely SQL, migrations, tenant/privacy locks), shared (scope/errors/context), identity (guild HMAC/AES-GCM), security (signatures, authorization, component tokens, deletion/purge), settings (optimistic revisions/audit), onboarding (single-choice branching, immutable versions and pinned sessions), discord (REST/permissions/outbox), discord-panels (Components V2), events (strict envelope and raw allowlist), lifecycle (membership episodes, message activation and explicit replies), analytics (mature denominators, quantiles, time coverage).

Inspected every source and test file, scripts, workspace configuration, manifests, architecture/ADR/validation reports and all migrations. Migration order: 001 foundation/tenant/identity/flow/events/outbox; 002 job leases/session timestamps/indexes; 003 telemetry cursor/departures/deletion hashes; 004 message and lifecycle uniqueness/member state. Down migrations reverse their own additions; do not run them on production during rollout.

## Working baseline

Signed HTTP ACK is durable and bounded. Components reauthorize against live Discord membership. Settings updates serialize and audit. Flow versions are database-immutable, sessions pin versions, preference reconciliation preserves manual roles. Redis pending reclaim, dispatch/message dedupe, missing-reply retry and telemetry gaps exist. Privacy deletion uses suppression tombstones and tenant locks. TEST/PREVIEW are excluded. Existing tests cover these paths with PostgreSQL/Redis and simulated Discord; browser tests cover the real scoped API.

## Gaps and risks

No existing experiment or DSL implementation exists despite specification references to v0.1 foundations. Activation is hard-coded to a start-channel message. Fallback nodes are single choice only. Native capability/snapshot, reaction/voice/event projection, diagnoses, interventions, entitlements, usage and billing are absent. Metrics have a common guild time coverage rather than per-signal coverage/versioning. Details expire at 45 days; aggregate table exists but is not populated. Role and panel REST effects currently occur inside database transactions, which the final directive forbids. HTTP callbacks are deferred after durable persistence; that behavior must remain bounded. Redis publication has a loss window before PostgreSQL persistence. The web API is read-only and cannot be reused as an unauthenticated configuration endpoint.

## Migration map

| Decision | Components | Work |
| --- | --- | --- |
| KEEP | identity, tenant constraints, signatures, component MACs, flow version/session model, outbox states, privacy tombstones | Extend through existing boundaries |
| MODIFY | Discord REST, settings, flow engine, event envelope, projector, metrics, workers, API/panels/web, purge | Native reads, typed/versioned configuration, signals, observed-time projection, safe intervention/experiment loop |
| DEPRECATE | personalize as primary entry, onboarding as primary product, unversioned message-only activation | Preserve legacy compatibility and migrate existing guilds to explicit fallback |
| ADD | capability/config revisions/snapshot queue/coverage/activation/diagnosis/intervention/experiment/entitlements/usage | Additive tables, scoped services, feature gates, integration and regression tests |

## Execution and acceptance

Follow directive sections 48 and 47: domain first, UI later; additive migration and backfill; rollout flags default off. First run existing checks, then validate each changed domain with targeted tests, followed by lint/typecheck/unit/property/integration/build/E2E. No skipped tests to conceal failures. Live Discord acceptance remains distinct and requires configured credentials; no live validation has occurred in this audit.
