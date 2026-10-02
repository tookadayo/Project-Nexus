# Alpha.5 repository audit

Base master: `557a5897a99fcb2c7a6d9766f84b476ac01f0f1f` (fetched 2026-10-02).
The working tree was clean. Work stays on master; no branch or PR.

The repository is a pnpm/Node 24 monorepo with apps/api, gateway, interaction,
worker and Next Web, and packages for events, lifecycle, analytics, presentation,
Discord, panels, settings, identity, security, DB, onboarding and shared domains.
There is no separate services directory. Migrations 001–026 are the starting schema.

Existing foundations retained: durable gateway_ingest + event_inbox, normalizeMany
and ordinal deduplication, adaptive_states/facts, discord_surface_state, scoped
membership episodes and IdentityVault, capability snapshots and refresh queue,
attention ACK/snooze/resolve, PostgreSQL outbox, Discord route/bucket/global limiter,
live Web authorization and Server Verification. Redis/BullMQ remain the existing
transport; PostgreSQL remains canonical. No Kafka.

Correctness findings: default false member fields lack independent observation
proof; references include forwards; private-thread partial coverage contaminates
all adaptive metrics; discovery infers intent health from a heartbeat; coverage
assumes Get Guild Channels is a census; dashboard scans raw facts on every render;
attention lacks explicit type/evidence and acknowledgement timestamps; outbox
lacks completion/update timestamps and a fenced lease owner.

Security reviewed: production auth fail-fast, encrypted OAuth cookie, selected
guild live authorization, manager roles, challenge expiry/one-use/rate limits,
unlink, privacy lock and queue scrubbing. OAuth refresh is presently absent and
must be assessed separately before Hosted Beta. Do not put Discord network reads
inside a settings/verification transaction.

Validation infrastructure: Vitest unit/integration/performance with isolated
Postgres + Redis, Playwright product and production-verification suites, real
Components V2 payload fixtures, seven community archetypes, Windows manager tests,
18-package Turbo build, eslint and TypeScript. Existing CI is preserved and expanded.
No format script exists at base; new domain files use Prettier check.

Baseline performance on this host, before edits: 10k dashboard 2798 ms, 50k
dashboard 2258 ms. The 600-person Voice result is recorded in the quality audit.
These are synthetic read/projection measurements, not hosted latency guarantees.

Official Discord resources were checked on 2026-10-02: message reference types,
channel obfuscation, Get Guild Channels, Gateway/intents, Threads/Forum/Media,
Poll, Voice State, Stage, Scheduled Events, AutoMod, Components and rate limits.
Installed discord-api-types exposes MessageReferenceType.Forward and
ChannelFlags.ChannelObfuscated. See the capability matrix for links and semantics.
