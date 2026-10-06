# NEXUS v0.6.0-alpha.8 — Market Parity & Community Operations

Starting SHA: `20cef32fecc1fddd5dad38da05a425ef7396fc40` (latest fetched alpha.7).
Release version: `0.6.0-alpha.8`; commit title: `NEXUS v0.6.0-alpha.8`.
Final SHA and exact-SHA remote CI are recorded in the release report after push;
local validation below does not stand in for remote CI or production acceptance.

## Implemented product boundaries

| Tier                            | Implemented value                                                                                                                                                                                                                                             | Deliberate limits                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free — Observe & Check          | Shared Web/Discord 7/30-day PNG charts, observed daily evidence, basic Attention, one encrypted explicit intake form                                                                                                                                          | Chart reads require a configured staff/helper role or NEXUS membership; channel publication requires operation permission. No person selector or ranking.                  |
| Starter — Understand & Explore  | 90-day retained history, saved views, operational role/channel/category/surface/recipe filters, heatmaps, multi-channel breakdowns, aggregate CSV, comparable periods, editable intake and reusable ICS events                                                | Comparison consumes both retained windows; 90+90 days cannot fit a 90-day allowance. Hourly data beyond raw retention remains missing. No Google OAuth claim.              |
| Growth — Operate & Integrate    | Evidence-backed Inbox, immutable versioned Playbooks with Attention/trend triggers and escalation, measurements, weekly/monthly chart reports, branding, scoped read API, signed webhook delivery/retries/logs/rotation                                       | Notifications and reports record delivery outcomes separately from queue acceptance. No causal claim from before/after measurement.                                        |
| Scale — Team, Automate & Govern | Explicit five-guild organization license, OWNER/ADMIN/OPERATOR/ANALYST/VIEWER permissions, scoped teams, independent Playbook approval, redacted audit CSV/JSON, service accounts/selected Attention writes, historical dry runs, recurring aggregate exports | No reuse of a Stripe subscription reference for another guild. Organization aggregates contain no cross-server community-member identities. Dry runs perform zero actions. |
| Enterprise — Secure & Integrate | Existing scoped contract arrangements                                                                                                                                                                                                                         | SAML SSO, SCIM, residency, DPA and custom integration commitments remain PLANNED.                                                                                          |

Prices remain INTERNAL_PROVISIONAL: Free $0, Starter $15, Growth $49, Scale $149,
Enterprise Custom. API monthly limits are per server across all credentials;
minute limits are per credential. No automatic overage charge is introduced.

## Billing and Sandbox evidence

Runtime, management, Checkout and public-sales capabilities are independent.
Stopping new sales preserves webhook verification, latest reconciliation, cancellation,
portal and payment recovery. Discord monetization applicability is checked against
the current official US/UK/EU policy; applicable Live sales require native equivalents
and parity. Unknown applicability fails closed. Runtime is not disabled merely
because a non-applicable region has no Discord SKU.

A real Project Nexus Sandbox Starter → Growth upgrade used Stripe's documented
authentication-required test PaymentMethod. `pending_if_incomplete` left Starter
effective during required authentication; the trusted hosted invoice completed
test 3DS, signed webhook signals triggered latest reconciliation, and the paid
subscription projected Growth. No payment action URL grants access by itself.
Stripe Live remains DISABLED; real-money payment NOT RUN; production webhook and
Discord Native Billing NOT CONFIGURED. Stripe Tax was not enabled.

## Storage, security and execution

Migrations 001–040 retain their committed contents. New migrations 041–044 add normalized
views/segments, operations, organization roles/teams and capability catalog revision 3.
Purchased Offering/Price financial identity remains at its existing immutable revision.

Reads and external delivery use scoped privacy locks and current entitlement checks.
Explicit NEXUS roles constrain Discord administrators. Revoked memberships cannot
fall back to administrator authority, including after a linked guild is reviewed
and reactivated: revoked bindings remain authorization tombstones.
Browser scopes and prices remain server owned.
Downgrade retains configuration as PAUSED_PLAN_LIMIT; reactivation is explicit.
Report/webhook leases have ownership tokens; stale workers cannot overwrite a
new worker's result. Queued sends fence current source revisions and destination
state. API tokens are hashed, scoped and rate limited. Webhook keys are sealed,
old keys have a 24-hour grace, DNS answers are validated and pinned for each attempt,
redirects are not followed, and the total outbound deadline includes DNS.

Explicit intake fields are encrypted; plaintext never enters audit/outbound events.
No Discord conversation transcripts are collected. Community member identities
remain guild scoped. No Message Content, DM, Presence, audio/transcription, emoji
sentiment or individual activity scoring is introduced.

## Validation and remaining release gates

Focused tests cover scope/role denial, Free/paid gates, UNKNOWN evidence, concurrent
intake and Inbox edits, immutable Playbook revisions, zero-action dry runs, report
dedupe/lease takeover, deletion/disable delivery fences, signed retries/key expiry,
atomic API limits, scoped organization licensing and independent approval.
Calendar checks cover DST folds/gaps, injection escaping and UTF-8 line folding.
Discord transport checks inspect actual multipart PNG bytes. Measured trends enter
the evidence-backed Inbox, deduplicate concurrent/daily evaluations and honor staff
dismissal before notification. Pending-upgrade tests verify fresh hosted invoice
binding and expiry of stale payment caches without changing the paid entitlement.

Final local validation on 2026-10-06:

| Required check                                           | Result                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Frozen dependency install                                | PASS                                                                                                          |
| Lint                                                     | PASS                                                                                                          |
| Typecheck                                                | PASS                                                                                                          |
| Unit tests                                               | PASS — 422 tests                                                                                              |
| Full build                                               | PASS — 19 workspace tasks                                                                                     |
| Web E2E                                                  | PASS — 28 tests                                                                                               |
| OAuth/billing/operations verification                    | PASS — 11 tests; EN/JA at 360px, actual PNG/CSV/ICS exports, tier transitions and Viewer denial               |
| Full integration                                         | PASS — 281 tests, 23 files, all migrations through 044                                                        |
| Performance                                              | PASS — 4 tests; 50,000-member community query 2,550 ms; existing raw/rollup and 600-user voice gates retained |
| Windows runtime                                          | PASS — original manager gate retained                                                                         |
| Secret/provider-reference scan and historical migrations | PASS — zero findings, 001–040 committed contents preserved, documentation links valid                         |

Initial failures were corrected without skips: stale revision/command/marketing
assertions, native module bundling, scoped request error handling, mobile layout,
test connection/lease/due-time setup and redundant verification attempts. One
embedded DB connection failed during concurrent heavy local suites; the affected
suite and subsequent full integration both passed without weakening the gate.

Live Discord acceptance, public pricing,
production secrets/webhook, Premium Apps/parity, tax/legal/refund/support, monitoring,
incident response and backup/restore remain separate Hosted Beta/Live gates.

## Market decisions

See [official-source market review](research/alpha8-market-parity.md).
Free/Starter/Growth/Scale provisional prices: KEEP for Sandbox validation.
Starter is exploration rather than more counters; Growth converts evidence to
repeatable operations; Scale adds actual team governance and organization workflow.
Remaining parity gaps include direct Google Calendar sync and external team
destinations. Moderation, XP/economy, giveaways, entertainment and cross-server
person intelligence are intentionally excluded. Next validation is staff usability,
workflow reliability and willingness to pay across small/mixed/multi-guild communities.

## Availability and market parity assessment

| Area                                                     | Decision          | Alpha.8 availability                                                                                                                        |
| -------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Cheap-bot aggregate charts, saved exploration and CSV    | MATCH             | Implemented with shared evidence and scoped staff permissions; no member drilldown or ranking.                                              |
| Ticket/forms operations                                  | ADAPT             | Explicit encrypted intake fields and Attention routing; conversation transcripts are excluded.                                              |
| Recurring calendar events                                | MATCH / INTEGRATE | Templates, timezone-safe recurrence and ICS links implemented. Google Calendar OAuth sync PLANNED.                                          |
| Channel status counters                                  | ADAPT             | PLANNED; no counter entitlement or marketing availability claim.                                                                            |
| High-end workflows, reports, team governance and sandbox | ADAPT             | Versioned Playbooks, chart reports, scoped organization/RBAC/approval/audit and zero-action historical dry runs implemented.                |
| Third-party team destinations and member billing         | INTEGRATE         | DISCORD/WEBHOOK destinations implemented. Slack/email/CRM and membership provider adapters PLANNED; NEXUS subscription billing is separate. |
| Ask NEXUS and Enterprise security                        | ADAPT / INTEGRATE | PLANNED. No fake AI, Calendar sync, SSO or SCIM endpoint.                                                                                   |
| Moderation, XP, economy, games, giveaways, starboard     | EXCLUDE           | Deliberate domain boundary.                                                                                                                 |

Free $0: KEEP; Starter $15: KEEP; Growth $49: KEEP; Scale $149: KEEP, all provisional.
Market position is evidence-led Discord operations between inexpensive utility bots
and sales-led community platforms. Growth supplies the repeatable operational loop;
Scale adds governance rather than only volume. Pricing and feature packaging still
need independent staff usability and willingness-to-pay validation. No market finding
constitutes public price approval or a paid-feature production launch decision.
