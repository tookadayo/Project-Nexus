# Stripe readiness — 0.6.0-alpha.7

Release: **Stripe Commerce Launch Foundation**. Production-capable code does not
enable production billing. Default configuration remains disabled.

| Component | Actual status |
| --- | --- |
| Official Stripe Node SDK | IMPLEMENTED — 23.0.0, server-only provider |
| Project Nexus Sandbox | CONFIGURED — account/mode checked, livemode=false |
| Sandbox catalog | CONFIGURED — Starter/Growth/Scale monthly USD, mapped Offerings |
| Sandbox hosted Checkout | TESTED — Web purchase, official test card, real subscription |
| Sandbox signed Webhook | TESTED — real Stripe CLI delivery to the Node.js raw-body route |
| Subscription reconciliation | TESTED — API snapshot → projection → effective entitlement |
| Customer Portal | TESTED — payment methods/history; free Price changes disabled |
| Upgrade / scheduled downgrade / cancel | TESTED — immediate invoiced upgrade, period-end schedule, paid-through cancellation |
| Promotion | TESTED — 10% first-invoice discount and financial evidence before finalization |
| Test Clock | TESTED — period-end downgrade/cancellation, renewal failure and recovery |
| Stripe Live | DISABLED |
| Real-money payment | NOT RUN |
| Production Webhook | NOT CONFIGURED |
| Discord Native Billing | DISABLED / NOT CONFIGURED |

The Sandbox run used an isolated PostgreSQL database, real NEXUS Web routes and
Core processing. Discord authorization and equivalent-price records were test
fixtures; they establish no Premium Apps approval or production parity review.
Runtime object IDs and secrets remain outside source control.

The 64KiB limit checks declared and actual raw bytes. The official SDK verifies
the unchanged body/signature before storing a deduplicated signal. The worker
retrieves authoritative current state; webhook creation time grants nothing.
Checkout success redirects display confirmation only.

Migrations 039–040 follow 001–038 unchanged. Historical EXTERNAL_LEGACY rows,
digests, ciphertext and audits retain their meaning. Privacy deletion overrides
provider state and bounded grace. CANCELED, SUSPENDED and EXPIRED grant no access.

Live purchase requires all price, production-secret/webhook, Discord compatibility,
parity, paid-feature, tax/legal, refund/support, monitoring/incident and backup/
restore gates. Scale additionally requires its planned team/multi-guild/API
capabilities to ship. No live Dashboard, Tax or revenue-recovery setting was changed.

See [integration](stripe-integration.md), [contracts](contract-hardening-alpha7.md),
[validation](contract-hardening-alpha7-validation.md),
[architecture](../billing-architecture.md), [security](../billing-security.md),
[promotions](../promotion-system.md) and [Hosted Beta blockers](../hosted-beta-blockers.md).
The [previous readiness validation](stripe-readiness-validation.md) and
[cleanup audit](repository-cleanup.md) are historical evidence.
