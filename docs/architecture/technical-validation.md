# Technical Validation

Report format: changes / verification / privacy and permissions / unresolved items (approved by user).

## Findings

Node 24.18.1 and pnpm 11.19.0 are available. Repository initially empty. Discord's current protocol supports signed HTTP interactions and Components V2; initial response deadline is three seconds. Member join/leave requires GuildMembers (privileged); message metadata requires GuildMessages. Guilds is required for installation/configuration. No MessageContent, DM, presence, reaction or voice intents are needed for this slice.

Initial permission baseline: ViewChannel, SendMessages, ManageRoles only in configured channels and below the bot's highest role. Administrator is never requested. User administration is restricted to ManageGuild or the explicitly configured NEXUS admin role. All component dispatches re-authorize server-side.

Protocol feasibility is confirmed from official documentation. Actual Discord guild installation, privileged-intent enablement, client rendering and permissions need a test application/guild and remain unverified.

PostgreSQL and Redis are mandatory. Docker is absent. Native PostgreSQL binaries may be used for local integration tests; production and CI use PostgreSQL/Redis via Docker Compose/Testcontainers. Windows Redis feasibility is still under investigation. In-memory substitutes do not satisfy integration acceptance.

## Test gates

- Signature/raw body/replay-window/ACK tests.
- Database migrations, cross-tenant constraints, revisions and rollback transactions.
- Gateway metadata projection, consumer dedupe and reclaim.
- Flow branching, stale components, version pinning, context separation.
- Role pre-existence, hierarchy failure, timeout UNKNOWN and retry behavior.
- Event duplication/reordering property tests.
- Full integration vertical slice plus browser overview E2E.

This document records validation findings, not a claim that runtime validation has passed.
