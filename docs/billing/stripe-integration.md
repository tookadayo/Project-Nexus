# Stripe Commerce Launch Foundation — 0.6.0-alpha.7

NEXUS owns capabilities and commercial policy. Stripe Billing, hosted Checkout
and recurring Prices handle financial subscriptions. No card-input UI is built in
NEXUS. The Stripe SDK is confined to `billing/providers/stripe.ts` at runtime.

## Purchase and authority

```text
Pricing → internal offeringId → fresh billing authorization
→ immutable Offering → scope lock / existing-subscription guard
→ verified promotion → idempotent operation → hosted Checkout

Success redirect → confirming subscription only
Signed raw Webhook → deduplicated ProviderSignal → RECONCILE_LATEST
→ Stripe API → authoritative snapshot → NEXUS subscription → entitlement
```

Plan/revision defines capabilities. Offering defines provider Product/Price,
currency, minor-unit amount, recurrence and tax behavior. A Price maps to an
Offering before projecting its Plan. No feature gate knows a Stripe Price ID.
Used Offerings lock their commercial identity. Disable the old Offering and
create a new one when changing prices. Migrations 001–038 remain immutable;
039 hardens contracts and 040 adds commerce bindings.

Browser purchase input accepts Offering ID, UUID idempotency key and an optional
reservation ID. Server code resolves everything else. Core passes encrypted
Customer/Subscription bindings and full trusted Offerings to the provider; the
provider never queries NEXUS DB. One Billing Account has one Stripe Customer;
one subscription has one guild until formal multi-guild provisioning ships.

## Mutations and recovery

CHECKOUT, CHANGE, PORTAL and CANCEL have independent semantics and authorization.
Scope leases prevent concurrent purchases and changes. Provider idempotency keys
namespace operation and scope with a digest. Request fingerprints bind full
commercial identity, current subscription/policy and verified promotion terms.
Checkout expiry is fixed by the durable operation, not recalculated on retry.
Open sessions block a second Checkout; verified completion closes that fence,
while the paid-subscription guard continues to apply.

Upgrades use `pending_if_incomplete` with `always_invoice` proration. The target
plan becomes effective only when the authoritative subscription changes after
payment. Downgrades create a Subscription Schedule with the paid current phase
and target next phase, no proration, and release at schedule completion. Current
entitlement remains until Stripe confirms the new Offering. Cancel releases only
a NEXUS-managed schedule and sets `cancel_at_period_end`. Access remains for
CANCEL_AT_PERIOD_END through the paid end; authoritative CANCELED ends access.

Accepted mutations remain RECONCILE_REQUIRED until their exact requested current
or scheduled Offering/cancel state is confirmed. Definitive API rejections may
fail. Transport timeouts and partial mutations require reconciliation/operator
review and cannot be blindly retried with a fresh UUID. Review unknown Checkout
outcomes using the bound Customer and operation correlation before resolving
them; automatic absence of a subscription alone cannot prove that no open
Checkout session exists. Operator recovery of unknown sessions is a live gate.

Portal permits payment-method management, invoice history and period-end cancel.
It refuses a configuration that enables unrestricted Price changes. Portal has
only `url`; its short retry cache uses NEXUS `cacheUntil`, never a fictional Stripe
expiry. Return/success/cancel URLs use `trustedWebOrigin()` from NEXUS_WEB_URL.

## Webhooks and projections

The Node.js route reads exact raw bytes before JSON parsing, enforces declared and
actual size limits, and calls SDK `constructEvent`. Required triggers are Checkout
completion, subscription create/update/delete, pending-update completion/expiry,
invoice paid and payment failed. The HTTP handler verifies and stores signals;
heavy API reconciliation runs in the worker. No raw provider payload is saved.

Customer/subscription/operation relationships determine scope. Metadata is only
correlation. Unknown relationships and forged guild metadata grant nothing.
Event IDs deduplicate signals; `event.created` is never a subscription revision.
Core serializes latest retrievals and generates local monotonic snapshot revisions.
Only complete pagination can establish empty census/absence; partial/error
responses retain bounded last-good policy. UNKNOWN, PAST_DUE and conflicts have
finite grace. SUSPENDED, EXPIRED and CANCELED do not. Privacy deletion wins.

## Promotions, parity and tax

NEXUS validates active campaign/code, scope, Offering, provider, allowed plan,
stacking, quota, expiry and Discord final-price parity before a provider call.
A product-scoped, one-redemption, once-only Coupon represents the initial-invoice
discount. Coupon lookup expands `applies_to` and verifies all terms before reuse.
The plaintext NEXUS code is never mirrored. Checkout uses `discounts` or disables
entry of Stripe promotion codes; those API parameters cannot be sent together.

Finalization requires the correct paid Invoice, Subscription, Customer, Price,
reservation, coupon and exact pre-tax discount/total. ACTIVE alone is insufficient.
No provider trial or unrestricted stacking is enabled. Sandbox parity fixtures
are research evidence only. Applicable production sales need an approved
equivalent Discord SKU and current base/discount price and currency review.

Tax collection remains a production decision. Prices retain tax_behavior;
`automatic_tax` and Managed Payments are explicitly disabled on these sessions.
Managed Payments can otherwise control Tax and adaptive pricing, so an account
default cannot silently change NEXUS's commercial model. Smart Retries and Stripe
customer emails were researched; no live settings changed. NEXUS projects failure
and recovery; future product notices are separate from Stripe billing emails.

## Configuration and catalog sync

Server-only variables: NEXUS_STRIPE_ENABLED, NEXUS_STRIPE_MODE, STRIPE_SECRET_KEY,
STRIPE_WEBHOOK_SECRET, STRIPE_PORTAL_CONFIGURATION_ID and trusted NEXUS_WEB_URL.
Never put credentials in NEXT_PUBLIC variables. Sandbox rejects live keys/objects.
Production rejects test keys when Stripe is enabled. Live additionally requires
NEXUS_STRIPE_LIVE_ENABLED and all launch approvals in `.env.example`.

```powershell
# With ignored local Sandbox environment configured; use the operator-selected account.
corepack pnpm exec tsx scripts/stripe/sync-sandbox-catalog.ts --account=<sandbox-account>
corepack pnpm exec tsx scripts/stripe/sync-sandbox-catalog.ts --account=<sandbox-account> --apply
```

Dry run inventories before mutation. Apply checks account and livemode, creates
only missing matching resources, validates mappings and inserts immutable
Offerings. It never deletes unrelated objects. A mismatched/ambiguous mapping
fails closed. Provider IDs are runtime configuration, not migration constants.
Restricted Sandbox Portal configuration can be prepared with the provider admin
method; record its resulting ID only in the ignored local environment.

SDK 23.0.0 pins API 2026-09-30.endive. Hosted Checkout uses the default hosted-page
UI. The Sandbox account's CLI webhook version may differ: events remain signals
and snapshots come from the pinned SDK API. Upgrade both against official types
and Sandbox acceptance when changing API versions.

## Sources and evidence

Stripe skills (`stripe-best-practices`, `stripe-docs`), Integration Planner,
Documentation Search and API Search/Details/Read/Write were used before code.
Primary references: [Billing](https://docs.stripe.com/billing/quickstart),
[Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions),
[pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates),
[schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules),
[proration](https://docs.stripe.com/billing/subscriptions/prorations),
[Portal](https://docs.stripe.com/customer-management/integrate-customer-portal),
[Webhooks](https://docs.stripe.com/webhooks),
[test clocks](https://docs.stripe.com/billing/testing/test-clocks),
[revenue recovery](https://docs.stripe.com/billing/revenue-recovery),
[Tax](https://docs.stripe.com/tax),
[Managed Payments](https://docs.stripe.com/payments/managed-payments/update-checkout)
and [official Node SDK](https://github.com/stripe/stripe-node).

See [readiness](stripe-readiness.md), [validation](contract-hardening-alpha7-validation.md),
[market decisions](../research/alpha7-market-validation.md),
[Discord requirements](../discord-premium-apps.md) and
[remaining hosted/live gates](../hosted-beta-blockers.md).
