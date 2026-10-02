# Alpha.5 commercial and entitlement hardening report

Base SHA: `8ba55f83c91253eeeb218ee97340e2e821cda042`. Work is directly on
master; no branch, PR, detached HEAD or version bump. Release stays
`0.6.0-alpha.5`. The final SHA is supplied with the delivery and can be obtained
from `git rev-parse HEAD` after the hardening commits.

## Delivered foundation

- Free now includes core Reply, Thread, Forum, Reaction, Poll, Voice and Event
  observations, connections, basic Attention/Journey and evidence. Starter buys
  90-day history and analysis depth; Growth buys 365-day history, custom recipes,
  automation/escalation, routing, improvement tracking and aggregate CSV. Scale
  defines five slots and 730 days, with unfinished organization/security workflows
  marked PLANNED. Enterprise supports explicitly scoped contract overrides.
- Features and limits are separate at catalog revision 2. Internal provisional
  prices are preserved; public currency-denominated prices stay disabled. Existing
  usage is soft and deduplicated, without dropped observations or automatic overage.
- One PostgreSQL-backed EntitlementService combines confirmed subscriptions and
  scoped grants. The verified provider inbox, ordered idempotent projector, durable
  retries and reconciliation leases tolerate duplicate events and worker restarts.
  Unknown providers retain bounded known-good access; overlapping paid allocations
  warn of BILLING_CONFLICT. A preview never executes payment or changes access.
- Downgrade/cancellation respect confirmed paid periods. Excess aggregate history
  has a default 30-day recovery concept, bounded by privacy retention. Configured
  rules remain PAUSED_PLAN_LIMIT and paid side effects recheck at execution.
- Promotions model discounts separately from trials and plan/feature grants.
  Random codes are shown once and persisted as HMAC/prefix only. Locked caps,
  idempotent retries and anonymous lifetime counters survive races and privacy
  deletion. Partner grants may last until revoked; internal Debug grants default
  to seven days, expire within 30 days and require a reason. Underlying subscriptions
  are unchanged. Every internal campaign/code/grant action is audited.
- `/nexus plan` uses ephemeral Components V2 and a private promotion Modal. Web
  `/billing`, `/billing/plans`, `/billing/manage`, `/billing/promotions` and internal
  `/billing/admin` use real OAuth and current authorization. Billing management is
  distinct from a NEXUS manager; internal administrators are distinct from Discord
  administrators. Protected writes enforce server checks independently of UI.

## Correctness and migration

Announcement activity now reaches the singular typed `announcement` capability
and OBSERVED status. Mixed Voice/Stage/External attendance preserves observable
counts with PARTIAL coverage while omitting the unobservable all-event denominator
and ratio; Journeys follow the same rule. Forum support uses actual channel type,
and future unknown channel types remain tolerated. No dedicated LFG API is invented.

Additive migrations **035, 036, 037** build billing, promotions and operational
leases/custom recipe keys. Tests migrate a seeded alpha.5 database through 034
into the new state, preserve explicit legacy paid/helper/digest access and check
immutable catalog revision 2. Legacy aliases are explicit; existing usage is not
reinterpreted. Privacy deletion takes precedence over every grant or grace period
and prevents provider/worker resurrection.

## Discord policy and operational status

Official Developer/Monetization policies, eligibility, Guild Subscriptions,
Entitlements, SKUs/Store links, price parity, discount exceptions and plan-change
semantics were reviewed on **2026-10-03**, with primary-source links and differences
in [Discord Premium Apps](discord-premium-apps.md).

Native billing status: **NOT CONFIGURED** (inspected capability **DISABLED**).
Configuration contains no shipped production SKU IDs. Only AVAILABLE shows
official native Store purchase actions; other states show Web plan links.
External billing is NOT_CONFIGURED and its webhook/checkout path fails closed.
Equivalent supported discounts require reviewed final prices and matching currency;
external-only parity-breaking discounts are rejected. No Discord coupon API exists
in this implementation.

No actual payment, Discord approval, live SKU purchase or production Stripe checkout
was performed. Native Subscription renewal metadata and immediate billing events,
real external provider signatures/payment flows and legal financial retention are
hosted blockers. Scale allocation/RBAC/commercial API/audit export, custom scheduled
reports, Webhooks and AI remain planned. No SSO/SAML claim is made.

## Validation record

Validation is local on Windows with Node 24.18.1, discord.js 14.27.0 and
discord-api-types 0.38.55. Integration/performance use isolated real embedded
PostgreSQL and Redis infrastructure; this is not a claim that a hosted payment
provider or live Discord client was exercised. The CI workflow's Ubuntu/Docker
runner result is separate from these local CI-equivalent checks.

All final checks passed; no failing test was excluded or skipped.

| Check                      | Result                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Lint                       | PASS                                                                                                 |
| Format                     | PASS for every changed supported source/document file; SQL and all diffs also pass whitespace checks |
| Typecheck                  | PASS                                                                                                 |
| Unit                       | 337 passed in 31 files                                                                               |
| Integration                | 165 passed in 14 files; final commerce-specific rerun 18 passed                                      |
| Build                      | 19/19 packages successful, cache bypassed; final production Web build also passed                    |
| Browser E2E                | 22 passed, JA/EN and desktop/mobile                                                                  |
| Verification / billing E2E | 8 passed, real fixture OAuth/current authorization and PostgreSQL                                    |
| Performance                | 4 passed in 3 files; analysis fixtures explicitly use Starter while Voice remains Free               |
| Windows runtime            | Runtime manager tests passed                                                                         |

Representative final measurements: 10k-member overview/comparison/channels 456 ms;
50k-member mixed community 2,595 ms; 600 Voice participants 2,573 ms with 600
sessions, one channel clock and zero participant pairs. Compact rollup reads were
96 ms versus 392 ms for raw reads. These are local synthetic-fixture measurements,
not hosted service guarantees. Existing thresholds were retained.

Existing representative fixtures cover Reply, Thread-heavy, Forum Support,
Reaction/Poll Creator, LFG + Voice, Voice-first, Event/Stage and large mixed servers.
Regression suites retain metric-specific coverage, legacy member UNKNOWN,
Reply/Forward provenance, current Reaction state, Poll multi-answer, linear Voice
state, privacy deletion and Action Outbox checks.

See [repository audit](commercial-repository-audit.md),
[plan catalog](pricing-entitlements.md), [billing architecture](billing-architecture.md),
[promotion system](promotion-system.md), [migration](plan-migration.md),
[security](billing-security.md), [privacy inventory](privacy-data-inventory.md) and
[Hosted Beta blockers](hosted-beta-blockers.md).
