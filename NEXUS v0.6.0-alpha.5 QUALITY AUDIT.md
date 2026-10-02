# NEXUS v0.6.0-alpha.5 QUALITY AUDIT

Audit date: 2026-10-02. Environment: Windows, Node.js 24.18.1, pnpm 11.19.0, isolated PostgreSQL and Redis fixtures.

## Executive summary

NEXUS now connects administrator-confirmed community purpose, immutable measurement recipes, observed evidence, surface-specific attention, operations and subsequent measurement. UNKNOWN is not eligible false, zero or complete. The existing Discord gateway/REST, identity, auth, verification, rate limiter, durable inbox and privacy architecture are retained.

This is a development alpha release, not hosted-beta approval. Automated acceptance and read-only live REST discovery are distinguished from controlled live Discord actions and production operations.

Base master SHA: `557a5897a99fcb2c7a6d9766f84b476ac01f0f1f`. The starting tree was clean. All work is committed directly to master; no branch, PR, detached HEAD or destructive reset is used.

## What changed

- Independent member observation proof, explicit direct reply/forward semantics and versioned metadata-only message projections.
- Per-metric evidence, collection epochs, integration health and channel-census lower bounds.
- Community Model v2, seven immutable recipe presets, a staged wizard and aggregate journey transitions.
- Text/support/LFG/event/collection attention, saved queue operations, team latency distributions and gated recommendations.
- Typed reaction/poll/voice state, daily contributions, eligible retention, privacy propagation, fenced action outbox and prioritized refresh workers.
- Adaptive Components V2 and Web operations views, consistent JA/EN measurement language and public Community Operations positioning.

## Observation correctness

Migrations never infer observation from old default-false flags. Member eligibility requires independently observed screening and guest flags; pending, guest and unknown are excluded. REST observation uses fetch-completion time rather than an old event timestamp. Independent clocks protect against stale updates. Activity before the proved eligible start does not enter eligible newcomer measurements.

Direct replies require installed Discord `MessageType.Reply` and `MessageReferenceType.Default`, another human, and matching channel/guild. Forward, mention, unrelated later messages and self/bot events do not qualify. Other-human posts in a thread retain their distinct response signal. A newcomer contributes one first scoped post within three days; a reply after the measurement window cannot leak into its historical numerator. Old ambiguous reply facts remain unproved.

Reaction current state is separate from event count; a user/message pair is not a unique server-wide person. Poll participation deduplicates multiple answers per user/poll. Neither establishes connection. Event subscription is not attendance; external/unknown event attendance is UNKNOWN. Voice co-presence requires the saved threshold and observed Gateway continuity, does not claim conversation, records no audio and creates no participant pair graph. Archive/lock never implies resolution. Purpose and resolved-tag semantics require administrator mapping.

## Metric Evidence Contract

Canonical and adaptive measurements retain API compatibility fields and carry definition/version, value, numerator, denominator, sample, sources, required surfaces, window, epoch IDs, coverage reasons and comparison blockers. Observation states distinguish OBSERVED, NO_ELIGIBLE, COLLECTING, INSUFFICIENT_SAMPLE and UNKNOWN. Coverage independently distinguishes COMPLETE, PARTIAL, LOWER_BOUND and UNKNOWN.

Unknown/collecting values and unknown denominators are null. Known small counts remain useful; they do not authorize ratios or recommendations. Ratios require a proved positive denominator and sufficient sample. Empty saved backlog can be a proved zero, while an empty latency sample cannot be a zero-second response. Legacy/mixed recipe-sensitive windows and unproved reply definitions remain unavailable. Compatible definitions and equal, non-overlapping observation windows are required for comparisons.

## Collection Epoch and coverage semantics

Tenant-scoped epochs record connection, resume/gap/restart, intent, permission and capability changes. New facts receive an epoch only when the event timestamp falls inside a known interval; historical attribution is not fabricated. Gaps, holes, severe integration failures and relevant scope changes block comparisons. Voice clocks stop at observed Gateway time and are invalidated across gaps.

Required surfaces are defined per metric. Private-thread limitations do not automatically affect voice or direct-reply coverage. An explicit visible include scope can be complete even when the server census is a lower bound. Permission inspection uses confirmed evidence; failed discovery does not invent a missing VIEW_CHANNEL permission.

## Community Model v2 and recipes

Existing profiles and explicit mappings remain compatible. Capability, observed usage, administrator intent and inferred candidates are distinct. Model context includes scale, traffic/newcomer volume, staff capacity, interaction/entry mode, goals, observed coverage and recipe. The wizard asks for purpose and mapping confirmation through four stages, with advanced details collapsed.

Seven presets are implemented: SOCIAL, LFG_GAMING, SUPPORT_FORUM, CREATOR_FAN, EVENT_STAGE, VOICE_FIRST and LARGE_MIXED. Immutable revisions freeze definition, thresholds, mappings, scope, operational context and later-activity windows. Old confirmed profiles retain a schema-0 legacy recipe; old facts are not relabeled. Recipe changes create revisions and block incompatible historical comparison.

## Journey analysis

Journeys are aggregate, recipe-dependent transitions, not one fixed funnel or individual surveillance. Member/post/event-member units and chronological order are retained. Support resolution matches the same post; repeated attendance uses distinct observed event IDs. Dynamic later activity displays the actual saved window, including days 7–14; legacy fixed follow-up definitions display their own true window. Prepared and standalone journey results are regression tested for equivalence.

## Attention v2 and team operations

Attention distinguishes text newcomer response, forum support, LFG response, event issue and integration/data health. It records reason, surface, threshold, evidence, coverage and ACK/snooze/resolve clocks and reason. Existing saved work remains visible/actionable when new collection is unavailable. Race and duplicate-action tests protect lifecycle transitions.

Team operations show backlog, oldest item, opened/resolved/snoozed counts and median/p75 acknowledgement/resolution times, without staff productivity ranking. Actions and a deduplicated PANEL_REFRESH outbox entry commit atomically. Recommendations require adequate sample, acceptable required coverage, compatible definitions/windows, continuity, integration health and absence of a major incident caveat. Each proposal explains observed change, evidence, importance, action and subsequent measurement. Insufficient evidence produces no forced recommendation.

## Integration Health and reliability

Web operations exposes intent delivery, Gateway state, REST/refresh state, coverage, collection intervals, projection lag and inbox/outbox/refresh backlogs. Discord Home shows a short warning when needed. A heartbeat alone never proves Guild Members availability.

PostgreSQL remains canonical. Existing Redis transport and at-least-once inbox/ordinal deduplication remain. Typed projector clocks, reset watermarks and tombstones protect replay/remove/add/restart sequences. Outbox/refresh claims use tenant-scoped fenced leases and short transactions. Discord REST runs outside long DB locks; completion rechecks leases and deletion state. Safe edits retry 429/5xx/timeout through the existing limiter. Ambiguous message creates become UNKNOWN and are not automatically retried. Compensating deletion/removal handles late writes where possible; a network side effect cannot be atomically rolled back with PostgreSQL.

Refresh priorities, bounded batches/concurrency, revision coalescing, bounded retry and organization/guild jitter prevent synchronized polling. OpenTelemetry-compatible spans/instruments and safe NXS correlation extend existing logging without storing bodies, tokens or sensitive identifiers.

## Privacy review

No Message Content Intent, Presence, DM analytics, voice recording/transcription, individual engagement score, moderator ranking, cross-server identity/benchmark, emoji sentiment or semantic content classification is added. IdentityVault remains tenant-scoped. New member-linked state, message observations, daily contributions, inbox, attention and retention tracking participate in deletion and detailed retention. Anonymous eligible counters follow the existing aggregate policy without preserving member identity. Guild deletion removes both personal and anonymous scoped data. Rebuilds respect scoped privacy locks.

Tests cover member/guild deletion, retention, late-worker completion, tenant collisions, content exclusion, and rollup propagation. See [privacy inventory](docs/privacy-data-inventory.md) for stored fields and lifetimes.

## Security review

Production development-auth fail-fast, encrypted OAuth session expiry, current selected-guild authorization, manager-role loss, cross-guild/cross-organization isolation, unlink, one-use challenge expiry/concurrent redemption/rate limits and Server Verification remain tested. Discord command visibility is not authorization. Selected-guild operations avoid enumerating all installed guilds for every action. Discord network calls are kept outside long settings/verification/write transactions.

OAuth refresh was re-evaluated and deliberately deferred: secure server-side refresh custody, rotation, concurrent refresh control and durable revocation are not complete. Access/session expiry fails closed. A partial refresh implementation is not shipped.

## Migrations and upgrade path

| Migration | Purpose                                                             |
| --------- | ------------------------------------------------------------------- |
| 027       | Independent member observation proof and reply definition           |
| 028       | Collection epochs, health, scoped tenant guild identity             |
| 029       | Immutable measurement recipe revisions                              |
| 030       | Typed attention lifecycle and action outbox evidence/fencing        |
| 031       | Typed high-volume participation state and daily contributions       |
| 032       | Prioritized refresh leases, action timestamps and queue reliability |
| 033       | Metadata-only message observations and proved reply latency         |
| 034       | Separately proved eligible retention tracking/counters              |

Migrations are additive to the master schema convention. Production-like alpha.3/alpha.4 fixture upgrades preserve old defaults as UNKNOWN, legacy recipe/fact versions and absent epoch attribution. Old anonymous retention counters are preserved rather than silently turned into eligible counts. Migration replay is idempotent.

## Performance results

Final representative measurements and alpha.4 comparison are recorded in [scaling architecture](docs/scaling-architecture.md). The acceptance goal is at most 20% regression, with the existing timeout assertions retained. The 600-participant Voice fixture proves bounded channel/session processing without pair generation. The independent 200,000-fact rollup fixture checks equivalent activity results and compares raw versus compact reads. Planner statistics are explicitly refreshed after synthetic bulk loading; no production latency guarantee is inferred.

## Discord API compatibility and Channel Obfuscation readiness

Official Discord Developer Documentation and the installed library enums/types were checked on 2026-10-02 for references/forwarding, Guild Channels, obfuscation, Gateway/intents, Threads/Forum/Media, Poll, Voice, Stage, Scheduled Events, AutoMod, Components V2, application commands and rate limits. Sources and support boundaries are in the [capability matrix](docs/discord-capability-matrix.md).

Automated Channel Obfuscation readiness: **PASS**. After the announced 2026-11-16 change, visible-only channel lists establish a lower bound, not a complete total/percentage. Older snapshots do not reconstruct a current census. Obfuscated payloads retain only officially usable metadata. Both early visible-only fixtures and pre/post-rollout behavior are tested. Real Developer Portal opt-in and post-rollout omission: **NOT RUN**; the controlled acceptance plan is documented.

## Privileged Intent readiness

Code fallback and operating documentation: **PASS**. Discord approval and annual renewal: **NOT VERIFIED**. The [runbook](docs/privileged-intent-operations.md) documents Guild Members purpose/data/retention/deletion, excluded privileged intents, intent loss, the published 10,000 unique reachable-user threshold, annual reapplication, owners and review evidence. A local code test does not prove app-level review approval.

## Web visual QA and Discord payload QA

Web fixtures cover all seven archetypes plus non-Community, healthy/attention/no-data/collecting/partial/unknown/intent-loss/Discord-unavailable states, JA/EN and desktop/mobile. 164 alpha.5 screenshots include saved attention during intent loss. Actual images were inspected across all seven archetypes, integration/coverage/model and public landing views; overflow checks run on the fixture matrix. Full browser E2E also exercises real setup, improvement preview/confirmation/activation and ACK/snooze/resolve flows. Dark-card text contrast was corrected.

Components V2 payload tests cover small/large Home, text/support/LFG attention, no data, partial coverage, integration warning and error states; snapshots enforce component/row/button/custom-ID/text limits and ephemeral/public semantics. Payload snapshots and layout approximation are not proof of actual Discord-client rendering.

## Live Discord Acceptance

**PARTIAL**. Read-only bot-member and REST capability discovery passed against the configured development guild: three visible channels, known current total, explicitly returned bot screening/flags. No Discord writes were performed and no IDs/secrets are in the public record. Controlled multi-account activity across seven guild scenarios, real Voice/Stage/events, Gateway reconnect/intent loss, live OAuth and Portal obfuscation were **NOT RUN** because the configured environment lacks the controlled participants and full acceptance setup. See [live acceptance](docs/discord-live-acceptance.md).

## Exact test results

The release's final check totals and durations are recorded in [validation](docs/validation.md). No failing test is skipped and no existing CI step or timeout assertion is removed. PostgreSQL/Redis tests run on this Windows host; the Linux Docker/Testcontainers route and remote GitHub Actions are not represented as locally executed.

## Known limitations and deferred items

- Full controlled live Discord/Portal acceptance and hosted operations are incomplete.
- OAuth refresh/rotation/durable revocation remains deferred; expired access requires reauthentication.
- External/unknown event attendance and unavailable/private-thread history remain unknown. Recurring-series aggregation is deferred without a verified stable series identity.
- Legacy flags, ambiguous replies and unattributed recipe/epoch history cannot be truthfully repaired by inference.
- Raw observations on window edges remain necessary; exact distributions are calculated from metadata observations, not daily averages.
- An already in-flight Discord side effect may require compensation/operator review after deletion; PostgreSQL cannot atomically undo Discord REST.
- Hosted exporter/pool-saturation/p95 monitoring and encrypted backup/PITR restore drills require deployment infrastructure.

No Discord replacement, generic moderation casebook, content AI/search, cross-server graph or Kafka is introduced.

## Hosted Beta blockers

1. Complete secure OAuth refresh-token lifecycle and durable revocation, or explicitly constrain hosted sessions pending reauthentication.
2. Confirm actual app-level Privileged Intent approval/renewal ownership and submit genuine review evidence.
3. Run controlled live Discord and Developer Portal obfuscation acceptance; verify real omission after rollout.
4. Provision production OAuth secrets/HTTPS, encrypted backups/PITR, an isolated restore drill and tested recovery targets.
5. Configure alerting/exporters for pool pressure, lag, 429s, failed compensation and durable outbox/refresh backlogs; validate hosted load and worker recovery.

## Final commit SHA

The release commit is the commit introducing this finalized audit and alpha.5 version. Resolve its exact immutable SHA with:

```powershell
git log -1 --format=%H -- "NEXUS v0.6.0-alpha.5 QUALITY AUDIT.md"
```

The exact SHA is also included in the final delivery report. A tracked document cannot embed the SHA of its own containing commit without changing that SHA; the Git identity above is authoritative.
