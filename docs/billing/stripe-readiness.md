# Stripe readiness — alpha.5

**STRIPE: NOT CONFIGURED / NOT LIVE.** No Stripe SDK, API calls, CLI, Products,
Prices, Checkout sessions, Portal sessions, coupons or payments have been enabled.
Supplying credentials or setting `NEXUS_STRIPE_ENABLED=true` cannot activate the
unimplemented adapter. Real payment and webhook validation are **NOT RUN**.

## Authority and ownership

Stripe will own Stripe payment/subscription state; Discord owns its Premium Apps
state. PostgreSQL owns normalized NEXUS subscriptions and Effective Entitlement.
All clients consume `BillingService.view()`; React does not reconcile providers.
The public billing entrypoint is `packages/settings/src/billing/index.ts`.
`domain`, `service`, `entitlements`, `offerings`, `policy`, `promotions`,
`reservations`, `view` and `providers/` have explicit responsibilities.

Migration **038_stripe_readiness** follows shipped migrations 001–037 unchanged.
Historical EXTERNAL rows become **EXTERNAL_LEGACY**, preserving reference digests,
sealed identifiers, event ordering and campaign history. They are not declared
Stripe accounts. New inbox snapshots reject this provider, new campaign schemas
exclude it, and checkout cannot select it. Historical pending normalized events
can still project. A future operator-assisted conversion must authenticate the
actual provider, reconcile current state, create new STRIPE identities using its
digest namespace and replace historical allocations explicitly. Do not rename
legacy digests as though they were verified Stripe identifiers.

## Provider signals and reconciliation

```text
raw bytes + Stripe-Signature + configured webhook secret
  -> future signature-verifying adapter (currently unavailable)
  -> verified ProviderSignal
  -> deduplicated PostgreSQL billing_provider_signals
  -> background reconciliation lease
  -> retrieve authoritative current Subscription outside a DB transaction
  -> normalized snapshot with internally allocated retrieval revision
  -> normalized billing_provider_events projector
  -> Effective Entitlement
```

Stripe uses `RECONCILE_LATEST`; Discord/manual historical events use
`MONOTONIC_VERSION`. Stripe event creation time and webhook delivery order never
become subscription revisions. Account-level expiring leases prevent overlapping
retrievals; a lease that expires during retrieval cannot persist its result.
Internal sequence numbers are retrieval fences, not Stripe event versions. A
later snapshot wins even when its inbox row projects first. Duplicate signal IDs
do not cause duplicate projection. Specific-subscription retrieval returning no
snapshot is a failure, not an implicit successful cancellation.

The worker handles persisted signals, retains failed attempts, schedules bounded
exponential retries and dead-letters after eight failures. Both inboxes retain
`attempts`, `error_category`, `available_at`, `dead_lettered_at`. Operational review:

```sql
SELECT id, provider, attempts, error_category, available_at, dead_lettered_at
FROM billing_provider_signals WHERE dead_lettered_at IS NOT NULL;
SELECT id, provider, attempts, error_category, available_at, dead_lettered_at
FROM billing_provider_events WHERE dead_lettered_at IS NOT NULL;
```

Investigate before explicitly clearing a dead letter; never set `projected_at`
to conceal failure. Restarted workers reclaim expired leases. Adapter failure
does not grant or overwrite access; existing bounded grace applies.

`POST /billing/webhooks/stripe` returns 503 `BILLING_PROVIDER_NOT_CONFIGURED`.
It never parses unsigned JSON, pretends to verify a signature, or enters the
inbox. The unused external stub was removed. The future adapter must preserve
raw bytes, validate Stripe-Signature, resolve trusted customer/scope ownership,
deduplicate event IDs and persist only verified signals. It must acknowledge
quickly without analytics, Discord writes, UI rendering or entitlement projection.

## Plan and Offering

Plan represents NEXUS features/limits. Offering represents one purchasable plan
revision, provider, interval/count, currency, price and tax behavior. Monthly and
annual JPY offerings and monthly USD offerings can coexist. The existing
`final_price_minor` column remains the authoritative unit amount in minor units;
the public internal Offering type calls it `unitAmountMinor`. Product and Price
references are separate columns. No production provider IDs are configured by
migration 038. Annual/public price publication remains unchanged and unavailable.
Features never depend on Price IDs.

Discount policy compares each commercial representation with applicable Discord
offerings of the same plan revision and billing interval/count. A missing parity
review, unsupported currency comparison or ambiguous equivalent offering fails
closed. Button visibility does not remove a parity obligation. Partner/Debug
grants remain grants, not discounts.

## Checkout, Portal and stable mutation requests

`POST /billing/actions` accepts:

```json
{
  "action": "checkout",
  "offeringId": "internal UUID",
  "idempotencyKey": "request UUID",
  "promotionReservationId": "optional internal UUID"
}
```

and:

```json
{ "action": "portal", "idempotencyKey": "request UUID" }
```

Both actions freshly verify OAuth, scope, server verification, billing authority
and same-origin request protections. Checkout resolves an enabled internal
Offering and constructs the provider contract. Stripe sessions return 503
`BILLING_PROVIDER_NOT_CONFIGURED`; there are no fake URLs. Existing Discord
purchase remains its supported store capability. No GET status call creates a
session. Provider contracts include keyed checkout, Portal, plan mutation and
cancellation, preview, reconciliation, webhook verification and current state.
`BillingOperationService` persists scoped request/payload digests and states in
`billing_operations`. Retries reuse the same UUID; changed payloads fail closed.
Expiring leases fence concurrent requests and failed sessions remain FAILED.
Successful future results are sealed and cached only for POST retries, for at
most five minutes and never beyond provider expiry. Stripe adapters must supply
an explicit expiry. An expired result requires a fresh request UUID. Provider
retrieval happens outside transactions; expired leases cannot save results.
No successful provider operation is fabricated in this pass. Names/email are not keys.

The presentation revision remains **1**: the additions are backward compatible.
`presentation.billingActions` exposes provider, method, availability and the
requirement to select an Offering. Existing native fields remain for supported
Discord clients. Stripe purchase/management availability stays false. There is
no static Portal URL, Price ID, customer ID, webhook secret or ciphertext in view.

A success redirect means **payment is being confirmed**. It must poll/refresh
the entitlement endpoint until an authoritative snapshot changes the Plan.
Redirect parameters and success page visits cannot write billing state.

## State mapping and entitlement policy

| Stripe status                      | NEXUS state          | Entitlement                                                 |
| ---------------------------------- | -------------------- | ----------------------------------------------------------- |
| trialing                           | TRIALING             | Only when account trial policy permits                      |
| active                             | ACTIVE               | Confirmed plan                                              |
| active with scheduled cancellation | CANCEL_AT_PERIOD_END | Authoritative remaining paid period                         |
| past_due                           | PAST_DUE             | Bounded last-known-good grace                               |
| paused / unpaid                    | SUSPENDED            | No paid access, including saved grace                       |
| incomplete                         | INCOMPLETE           | No paid access                                              |
| incomplete_expired                 | EXPIRED              | No paid access                                              |
| canceled                           | CANCELED             | Stripe only: explicitly authoritative remaining paid period |
| unrecognized                       | UNKNOWN              | Bounded saved grace only                                    |

CONFLICT also has bounded saved grace and explicit conflict visibility. Existing
GRACE remains compatible. The future Stripe adapter must set `periodEnd` to an
authoritatively valid paid-through period, not blindly retain an obsolete period
after immediate cancellation/refund. Missing confirmation never grants access.
Privacy deletion overrides every provider, trial and grant.

## Discount reservations

`PromotionReservationService` is an internal contract, not a public redemption
endpoint while payments remain unavailable. It enforces persistent attempt
throttling, code HMAC, activation, dates, revocation, guild/organization bindings,
allowed plans/providers, stacking, Offering compatibility and parity checks.
Campaign then code row locks serialize cross-guild instances. Active pending
reservations plus finalized counters consume quota; expiration/cancellation
release pending quota. Repeating a scoped UUID returns its existing reservation;
reusing it with another code/Offering fails.

```text
validate discount -> PENDING reservation (at most 30 minutes)
  -> future verified checkout adapter binds subscription reference digest
  -> associated authoritative ACTIVE subscription snapshot is projected
  -> FINALIZED, increment anonymous counters exactly once
abandon -> EXPIRED; cancel -> CANCELED
```

Finalization rechecks campaign/code dates, revocation, binding and Offering/parity
policy; verifies current projected snapshot, scope, plan and bound reference;
and atomically records redemption/counters. It cannot accept browser success
claims. Partner and Debug continue through audited internal grants without this
flow. Public discount redemption still fails closed without consuming quota.
New scoped reservations/signals/operations participate in privacy deletion;
anonymous lifetime redemption counters remain preserved.

## Configuration and Hosted Beta gates

Optional server-only placeholders: `NEXUS_STRIPE_ENABLED=false`,
`STRIPE_SECRET_KEY=`, `STRIPE_WEBHOOK_SECRET=`. Disabled development/tests need
no Stripe credentials. There are no NEXT_PUBLIC secrets. Customer/subscription
lookups use digest plus sealed provider reference; card PAN/CVC/payment method
details are never stored.

Before Hosted Beta payments: implement and validate the actual Stripe adapter,
trusted customer and scope mapping, Checkout/Portal lifecycle and durable retry
results, signed webhook intake, production offerings/parity, paid-through and
promotion association evidence, payment failure/refund/dispute policy and hosted
deployment/security/retention acceptance. Discord retains its independent
approval/SKU/developer locale and live acceptance gates. See
[Hosted Beta blockers](../hosted-beta-blockers.md).

Web Experience v2 consumes the canonical view and action contracts. It needs no
webhook enums, event-order logic, provider Price IDs, SKU reconciliation or
promotion race logic. Visual redesign is outside this task.
