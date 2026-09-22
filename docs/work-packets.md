# Work Packet reports

Scope: Technical Validation and WP-00–WP-08 only. The user approved deriving acceptance criteria from the master instruction and using the four sections below. Real Discord acceptance is distinct from local tests.

## Technical Validation — local validation passed; live Discord unverified
- Changes: architecture baseline and ADR 0001; Node 24/pnpm confirmed; current Discord protocol checked.
- Verification: PostgreSQL 18 and Redis 8.10.2 run on Windows; Components V2 payloads compile against discord-api-types. Streams reclaim, BullMQ, migration and browser tests passed.
- Privacy / permissions: Guilds/GuildMembers/GuildMessages only; ViewChannel/SendMessages/ManageRoles; no content intent or Administrator request.
- Unresolved: user confirmed Discord .env is not prepared. Linux Docker/Testcontainers unavailable on this host. No claim of live Discord acceptance.

## WP-00 Repository Foundation — local gate passed
- Changes: workspace/apps/packages, strict TypeScript, lint, Vitest, config validation and lockfile.
- Verification: lint/typecheck and 2 foundation tests passed at completion. TypeScript 6 chosen to satisfy eslint peer support.
- Privacy / permissions: environment secrets excluded from version control; explicit validation.
- Unresolved: production credentials and deployment are not configured.

## WP-01 Database Foundation — local gate passed
- Changes: migrations for scoped organizations/guilds, identity vault, episodes, immutable flows, settings/audit, jobs/events/outbox and metrics.
- Verification: native PostgreSQL migration rerun, tenant conflict/foreign key rejection; unit encryption isolation. Later packets extend integration coverage.
- Privacy / permissions: authenticated encryption with guild AAD; guild-scoped HMAC; composite foreign keys.
- Unresolved: production PostgreSQL provisioning and backup policy are outside this local build.

## WP-03 Interaction Service — local gate passed
- Changes: HTTP signatures, timestamp window, ephemeral defer, durable encrypted jobs and MAC-protected component references.
- Verification: signed HTTP injection, ACK <2.5s locally, duplicate delivery, tamper/owner rejection, content stripping; lint/typecheck passed.
- Privacy / permissions: raw request bytes used only for signature verification, never persisted. Deferred replies are queued through outbox.
- Unresolved: public HTTPS endpoint and actual Discord delivery latency not verified.

## WP-04 Control Panel — local gate passed
- Changes: permanent Components V2 root, private settings, member setup/privacy, deleted-panel recreation through outbox.
- Verification: PostgreSQL + FakeDiscord integration proves admin rejection, panel creation/recreation; payload types and unit tests pass.
- Privacy / permissions: live membership/permissions fetched for actions, no raw IDs in component identifiers.
- Unresolved: actual client rendering awaits a test application.

## WP-05 Settings Service — local gate passed
- Changes: sole settings mutation service, optimistic revisions, validation and transactional audit.
- Verification: concurrent updates admit one winner; unauthorized or incomplete settings roll back; lint/typecheck pass.
- Privacy / permissions: tenant-scoped mutations, HMAC actor audit key, default SUGGEST.
- Unresolved: web overview connection belongs to WP-08.

## WP-06 Minimal Adaptive Onboarding — local gate passed
- Changes: six templates, branching state machine, Discord modal question/option editing, managed role mapping, immutable publication, pinned sessions, rollback-as-copy, restart/preferences and preview.
- Verification: property test for valid transitions; integration for pinning, immutable DB trigger, ownership-safe grants/revocation, manual-role preservation and preview isolation.
- Privacy / permissions: elevated roles cannot be selected for grants. No preview role action is emitted. Ambiguous REST success does not create ownership.
- Unresolved: live Modal interaction/rendering and actual role hierarchy verification require Discord credentials. Ownership evidence expires with the 45-day detailed retention limit.

## WP-02 Gateway — local gate passed
- Changes: metadata allowlist, scoped encrypted user identifiers, shard/session/sequence, Redis Streams publication and disconnect/loss health.
- Verification: real Redis duplicate/reordered dispatch, pending consumer reclaim; unit assertions for content/attachment/embed/DM/bot exclusion.
- Privacy / permissions: Guilds/GuildMembers/GuildMessages only. No message-content intent and no REST work in Gateway handlers.
- Unresolved: real Discord Gateway restart/RESUME not exercised; Windows Redis was used for tests.

## WP-07 Lifecycle — local gate passed
- Changes: episodes and rejoins, event dedupe, activation, explicit-reply facts, action retries/UNKNOWN, deletion and retention jobs.
- Verification: real PostgreSQL/Redis integration; Discord 429, 500, timeout, deleted role, revoked permission and deletion tests via FakeDiscord.
- Privacy / permissions: reply facts contain no responder identity; suppression tombstones prevent deleted identities from being recreated; UNKNOWN never implies ownership.
- Unresolved: actual external API errors were simulated. No production credentials or deployment were used.

## WP-08 Minimal Analytics — local gate passed
- Changes: deterministic overview metrics, mature-cohort denominators, coverage, scoped authenticated API and optional authenticated Next.js overview.
- Verification: duplicate/reorder property tests, full signed HTTP→BullMQ→Outbox→Redis→Activation→Overview→Preference reconciliation test. 17 workspace builds succeeded; desktop/mobile browser rendering and unauthenticated rejection passed.
- Privacy / permissions: only aggregate metrics leave the API. No individual lookup, scores or graph. Zero coverage renders null; TEST/PREVIEW excluded.
- Unresolved: live Discord acceptance remains unverified by explicit environment constraint. Web is a single configured guild, read-only companion; advanced analytics are outside this slice.

## Post-implementation quality review

User requested quality verification and improvements after implementation, within usage limits. Review is in progress; findings and final command results are recorded in docs/validation.md.
