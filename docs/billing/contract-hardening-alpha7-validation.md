# alpha.7 validation record

Release: **0.6.0-alpha.7 — Stripe Commerce Launch Foundation**.
Starting master: `b8ca1f83bbc62523f3ff001094a6f6bf25206a1c`.
Date: 2026-10-05, Windows, Node.js 24, PostgreSQL 18 fixtures.

## Real Stripe Sandbox validation

The selected account was **Project Nexusサンドボックス**. The official Node SDK
and Stripe tooling checked the selected account and `livemode=false` before
catalog writes. The SDK reused the matching Starter/Growth/Scale Products and
monthly USD Prices; unrelated catalog entries were preserved. No runtime Stripe
IDs or secrets are committed.

The isolated local NEXUS Web application used a real Sandbox key, real hosted
Checkout, official test payment methods, and real signed Stripe CLI webhook
delivery. The durable ProviderSignal, Core reconciliation, projection and
promotion services ran against an isolated PostgreSQL fixture. Discord OAuth,
guild authorization and equivalent Discord prices were fixtures. These results
do **not** approve Discord Premium Apps eligibility or production price parity.

| Path | Result | Observed outcome |
| --- | --- | --- |
| Product / Price sync | PASS | Three monthly USD tiers; repeated sync reused the catalog |
| Customer mapping | PASS | Core-owned digest/sealed reference before Checkout |
| Free → Starter purchase | PASS | Actual hosted Checkout, test payment, signed signals, authoritative ACTIVE and Starter entitlement |
| Success redirect | PASS | Confirmation view waited for NEXUS subscription state |
| Starter → Growth | PASS | Immediate prorated invoice paid, current Offering reconciled, Growth entitlement |
| Growth → Starter scheduling | PASS | Paid Growth retained; scheduled Starter displayed |
| Period-end downgrade | PASS | Test Clock advanced; real subscription Price became Starter; NEXUS projected Starter ACTIVE |
| Customer Portal | PASS | Real hosted Portal showed invoices/payment management; free Price changes disabled |
| Period-end cancellation | PASS | CANCEL_AT_PERIOD_END retained paid access; Test Clock then produced CANCELED and Free |
| Promotion | PASS | Reserved 10% initial-invoice discount appeared in the actual $13.50 invoice; verified financial evidence finalized exactly once |
| Payment failure / recovery | PASS | Official failing test method and Test Clock produced invoice.payment_failed / PAST_DUE; paid recovery returned ACTIVE |
| Signed Webhook | PASS | Real Checkout, subscription and invoice signals acknowledged through the Node raw-body route |

Sandbox testing exposed and fixed Checkout defaults for Managed Payments,
hosted UI parameters, mutually exclusive promotion parameters, expanded Coupon
product restrictions, and terminal cancellation with a future period boundary.
Diagnostic unknown operations were resolved only in the isolated fixture after
an actual complete Checkout-session census confirmed no Session existed. The
product continues to fence unknown mutation outcomes; production operator
recovery remains an operational readiness requirement.

## Automated local verification

| Command / check | Result |
| --- | --- |
| corepack pnpm install --frozen-lockfile | PASS |
| corepack pnpm lint | PASS |
| corepack pnpm typecheck | PASS |
| corepack pnpm test | PASS — 36 files / 395 tests |
| corepack pnpm build | PASS — 19 tasks |
| corepack pnpm test:e2e | PASS — 28 tests |
| corepack pnpm test:e2e:verification | PASS — 8 tests |
| corepack pnpm test:integration | PASS — 19 files / 252 tests |
| corepack pnpm test:performance | PASS — 3 files / 4 tests |
| corepack pnpm test:runtime | PASS — native Windows runtime manager tests |
| Japanese / English mobile QA | PASS — 360px Pricing and Billing layouts, no page overflow |
| Original migrations 001–038 | PASS — unchanged |
| Actual secret / provider reference scan | PASS — no actual keys or runtime Stripe IDs in release files |

Negative and concurrency coverage includes live/test mode guards, immutable
Offering identity, idempotency conflicts, existing subscriptions, unknown and
forged scope bindings, signature/body tampering and limits, duplicate/reordered
signals, complete-empty versus incomplete reconciliation, promotion eligibility
and financial evidence, quota/finalization races, operation overlap and privacy
deletion fences. See the billing contract, Stripe provider, promotion contract
and Web boundary tests.

Exact final SHA and GitHub Actions conclusions are reported after pushing and
checking both `verify` and `windows-runtime` for that SHA. This document cannot
embed the SHA of its own release commit.

## Commercial boundaries

Stripe Live: **DISABLED**. Real-money payment: **NOT RUN**. Production Webhook:
**NOT CONFIGURED**. Discord Native Billing: **DISABLED / NOT CONFIGURED**.
Tax collection remains a production decision; automatic tax and Managed
Payments are explicitly disabled for the tested Checkout.

Starter/Growth/Scale amounts remain $15/$49/$149 **INTERNAL / PROVISIONAL**.
Scale multi-guild, RBAC and API capabilities remain planned and block its Live
Offering. One subscription remains limited to one guild assignment.

Code and Sandbox readiness are separate from Hosted Beta and Live approval.
Hosted Beta remains **NO-GO** until Discord compatibility, current parity,
paid feature readiness, public prices, production secrets/Webhook, tax/legal,
refund/support policies, monitoring, incident handling and backup/restore gates
are satisfied. See [integration](stripe-integration.md),
[market validation](../research/alpha7-market-validation.md),
[readiness](stripe-readiness.md) and [blockers](../hosted-beta-blockers.md).
