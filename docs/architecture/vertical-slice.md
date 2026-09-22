# NEXUS v0.1 Vertical Slice — implementation baseline

Status: proposed baseline; the separately referenced Build Plan and reporting format have not been supplied.

## Existing repository and environment

- Inspected 2026-09-22: workspace is empty; no existing implementation, dependencies or AGENTS.md found.
- Node.js v24.18.1; pnpm 11.19.0 are available.
- Docker, PostgreSQL and Redis executables were not found on PATH; the usual Docker Desktop executable is absent.
- No Discord credentials have been requested or inspected.

## Scope and order

Technical Validation → WP-00 → WP-01 → WP-03 → WP-04 → WP-05 → WP-06 → WP-02 → WP-07 → WP-08.

Only the first vertical slice is authorized. No AI, experiment implementation, advanced diagnosis, helper automation, moderation or external integrations. Preserve future experiment boundaries without implementing future packets.

## Architecture

- pnpm/Turborepo workspace with Node 24, strict TypeScript and the mandated stack.
- HTTP interactions: verify Ed25519 over the exact request bytes, acknowledge within three seconds, queue work and render ephemeral admin controls.
- Shared SettingsService is the sole mutation boundary; optimistic revision, tenant scope and audit record update atomically.
- Gateway only projects an explicit metadata allowlist and publishes to Redis Streams. Never retain message body, embeds, attachments or DMs, even when Discord supplies them without an intent.
- Consumer group workers deduplicate by dispatch identity (shard/session/sequence), persist transactions, then acknowledge; reclaim pending work after crashes.
- Every repository operation carries organizationId and guildId. Database constraints enforce tenant relationships.
- Guild-scoped HMAC lookup and authenticated encryption isolate Discord user IDs in an identity vault. Membership episodes distinguish rejoins.
- Immutable published flow versions; sessions pin versions. Preference changes reconcile only provably owned role grants through a transactional action outbox.
- Outbox actions have PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN states. Timeouts must never manufacture proof of role ownership. Ambiguous non-idempotent effects require reconciliation.
- Deterministic lifecycle and analytics, membership-episode denominators, event-time processing, coverage metadata and strict TEST/PREVIEW isolation.
- Minimal API/Web overview uses the same domain services and tenant authorization. Routine configuration remains in Discord.

## Proposed acceptance checklist

- [ ] Technical Validation: Discord protocol, Components V2, permission boundaries, runtime/dependency compatibility and infrastructure feasibility.
- [ ] WP-00: workspace, reproducible dependency lock, build/lint/typecheck/test commands, environment validation and developer instructions.
- [ ] WP-01: reversible migrations, tenant isolation, identity vault, settings/audit, episodes, flows, events and action outbox persistence.
- [ ] WP-03: signed HTTP endpoint, invalid-signature rejection, opaque authenticated custom IDs, dedupe, ACK and queued replies.
- [ ] WP-04: permanent control panel entry, ephemeral authorized controls, member Personalize/preferences/privacy entry points, deleted-panel recovery.
- [ ] WP-05: shared revisioned settings service, template/start-channel/onboarding configuration, audits, unauthorized/stale update rejection.
- [ ] WP-06: branching flow, pinned immutable versions, answer validation, role mapping, preference restart/update, ownership-safe reconciliation and rollback.
- [ ] WP-02: minimal Gateway intents, metadata-only Streams publication, shard/session/sequence, resume/disconnect health and recovery.
- [ ] WP-07: deduplicated episodes/lifecycle, activation, worker recovery, side-effect retries/UNKNOWN and context isolation.
- [ ] WP-08: deterministic overview with coverage and maturity-aware denominators; full joined-to-preference-change vertical-slice E2E.
- [ ] Per packet: inspect, implement, migrations where necessary, tests, lint, typecheck, documentation, audit/tenant/privacy/permission review and report.

## Verification policy

Unit/property tests do not substitute for PostgreSQL/Redis integration or actual Discord acceptance. Unavailable infrastructure and credentials must be reported as unverified, never as passing. No skipped/removed/weakened tests to conceal failures.

## Sources checked

- https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx
- https://github.com/discord/discord-api-docs/blob/main/developers/components/using-message-components.mdx
- https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx

Discord requires signature validation and an initial response within three seconds; follow-up tokens expire after 15 minutes. Components V2 messages require the corresponding flag and have endpoint-specific restrictions. Validate the concrete payloads against the installed discord-api-types package before acceptance.
