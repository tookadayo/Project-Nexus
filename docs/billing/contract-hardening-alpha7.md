# Commercial contracts — 0.6.0-alpha.7

These contracts underpin **Stripe Commerce Launch Foundation**. The official
SDK, hosted Checkout, Customer mapping, Portal, updates and signed Webhooks are
implemented and tested in real Sandbox. Stripe Live stays DISABLED; real-money
payments and production Webhooks remain NOT RUN / NOT CONFIGURED. See the
[integration](stripe-integration.md) and [readiness](stripe-readiness.md) records.

The root `package.json` is the only release-version source. Workspace manifests
are synchronized mirrors; runtime `VERSION` imports the root. A unit test checks
the root, exported version, README, docs index and workspace mirrors. Historical
reports retain their original release and validation results.

## Research and starting point

Fetched `origin` before work. Latest master and the requested baseline were both
`b8ca1f83bbc62523f3ff001094a6f6bf25206a1c`; no newer remote delta required review.
That commit still declared alpha.5 in the manifest and current docs. The initial
contracts omitted Product/Price from the Offering, required Stripe expiry for
Portal, accepted ACTIVE without discount evidence and lacked explicit census
absence and unknown-operation semantics.

Official documentation was reviewed on 2026-10-05:

- [Stripe raw-body signature verification](https://docs.stripe.com/webhooks/signature):
  exact body and `Stripe-Signature` must reach the official SDK verifier unchanged.
- [Stripe API idempotency](https://docs.stripe.com/api-v2-overview): replay windows
  are finite; current Billing v1 contracts cannot assume indefinite deduplication.
- [Stripe customer portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal):
  Portal is a customer-bound management session; its contract does not invent a
  Checkout-style provider expiry.
- [Discord price parity and applicability](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps):
  applicable offerings compare final pre-tax prices after discounts. Developer
  locale and offering support matter; disabling purchase UI is not an exemption.

## Commercial identity and ownership

NEXUS owns Plan/revision and the immutable Offering row. A configured external
provider owns its real Product/Price/Offering objects. Core loads and validates
`providerProductId`, `providerPriceId`, `providerNeutralOfferingId` (the legacy
`provider_offering_id` column), interval/count, currency, unit amount, tax behavior,
provider and enabled status before calling an adapter. `final_price_minor` remains
the stored unit amount; it is not renamed or reinterpreted. Discord's selected
Offering must match its actual configured SKU, rather than resolving only planKey.

Migration `039_billing_contract_hardening.sql` leaves 001–038 untouched. An Offering
is permanently locked after first enablement or commercial use. Every pre-039 row
is conservatively frozen because historical ever-enabled state cannot be inferred.
New never-enabled drafts remain editable. Plan/revision,
provider mapping, cadence, currency, amount and tax behavior cannot change in
place, including after disabling. New prices/mappings require a new row.
Enabled/disabled and parity-review state remain mutable. Stripe enablement
requires complete Product/Price mappings, currency, amount and explicit tax behavior
at both DB and service boundaries. No migration seeds production provider IDs.

Core owns provider customer/subscription bindings. References use keyed digests
and guild-scoped encryption; adapters receive the already resolved references and
never query NEXUS DB. Historical customer ciphertext has no guessed guild binding.
Checkout may receive an existing trusted Customer. A Customer reference is optional
at session creation because the provider may create it only at completion. Core
binds an authoritative returned Customer, or a verified Checkout/subscription/
Customer object relationship, against the completed NEXUS operation and protected
session-reference digest. Metadata alone cannot create a Customer binding, and
existing account/guild ownership cannot be overwritten.
Until Scale provisioning ships, one subscription reference belongs to one guild.
Cross-guild projection fails closed before creating an unusable ciphertext binding.

## Checkout, change, cancellation and Portal

New Checkout requires no existing paid subscription. An existing subscription
uses explicit CHANGE or PORTAL; another provider requires an explicit migration
policy and currently fails closed. A paid conflict cannot create another Checkout.
Core serializes requests and checks trusted state before the external call.

Portal receives a trusted provider customer reference. Change receives a trusted
subscription reference, target Offering, stable idempotency key and effective/
proration policy. Cancel receives the trusted subscription, immediate or period-end
policy and stable key. Retrieval/reconciliation receive trusted references rather
than guessing Stripe objects from scope or metadata.

Checkout results require `url` and provider-authoritative `expiresAt`. Portal
results require `url`; adapters must not synthesize a provider expiry. NEXUS may
cache a result briefly under `cacheUntil`, which is its own retry cache deadline.
The historical `result_expires_at` storage column records that cache deadline.
Checkout cache also cannot outlive provider expiry.

Input digests bind trusted Offering financial terms, provider, promotion context
and relevant reference/policy. Reusing a key with different terms produces
`IDEMPOTENCY_CONFLICT`; the key sent to the provider stays stable. Legacy digests
are retained and ambiguous legacy retry inputs fail closed. A definitive failure
is distinct from an unknown external outcome. Expired/crashed leases or uncertain
provider errors require reconciliation and cannot trigger blind mutation retries,
especially CHANGE/CANCEL. Definitive failures may retry only within the persisted
23-hour horizon; uncertain outcomes never replay automatically. Signal/event
retries are capped at eight attempts and then dead-lettered.

## Reconciliation and webhook ownership

Stripe retains `RECONCILE_LATEST`: event creation time and delivery order never
become revisions. Core allocates fenced retrieval revisions. Reconcile results
distinguish targeted FOUND, targeted authoritatively ABSENT, COMPLETE census and
INCOMPLETE/FAILED retrieval. Complete census absence removes stale paid access;
network failure, partial retrieval and ambiguous absence preserve only existing
bounded grace and never imply cancellation. No prior confirmation grants access.

The App Router Node.js endpoint reads exact request bytes before parsing, carries
the original signature and declared Content-Length, and enforces an actual 64KiB
limit even when the header understates the body. The official SDK performs
exact-body signature verification. The configured-adapter verification
gate is the only HTTP path into `BillingService.receive()` and the signal inbox;
current requests still fail closed with 503.

A signature proves provider origin, not tenant authorization. Core checks signal
scope against a stored subscription binding, customer binding or NEXUS-created
Checkout operation and its protected provider reference. Future `client_reference_id`
or metadata identify an operation to match; they are never authorization tokens.
Customer/subscription IDs, Checkout Session IDs and redirect queries alone cannot
grant entitlement. Generic `verifyBillingHmac` is isolated as a test helper and
must never replace Stripe's official SDK signature verification.

## Promotions and parity

Core revalidates reservation scope, Offering, PENDING state, expiry, campaign/code
activation and revocation, target bindings, allowed plan/provider, stacking and
parity immediately before Checkout. Adapters receive a safe validated
`PromotionCheckoutContext`; raw public reservation IDs and plaintext codes are
not sufficient provider inputs. Unknown or mismatched reservations never invoke
Checkout. Campaign/code quota and privacy locks remain transactionally enforced.

Finalization requires safe authoritative commercial evidence matching reservation,
Offering association, currency/cadence/tax, base amount, discount type/value and
actual final pre-tax amount. ACTIVE status, a redirect or Session ID alone cannot
finalize. Alpha.7 forbids combining payment discounts with provider or NEXUS trials,
including MAX stacking. Unsupported inclusive-tax discount decomposition fails
closed; no adapter guesses a pre-tax amount.

Base external prices and discounted final prices both require applicable Discord
parity: Discord final pre-tax price must be no higher than the other option.
Missing review, unknown applicability, incomparable currency or ambiguous/missing
equivalent Discord Offering fails closed. Immutable prices prevent changing a
reviewed row's price after approval.

## Compatibility, privacy and release gates

`presentation.billingActions` is canonical. Discord `nativeCapability` and
`nativePurchaseUrl` remain deprecated compatibility fields. Presentation revision
stays 1 because this is additive. Existing product-site surfaces, alpha.5
regressions, Windows entrypoints, public billing exports and privacy logic remain.

Operations/signals/reservations share existing privacy fences and deletion. Late
provider completion cannot recreate records after deletion. Legacy EXTERNAL_LEGACY
digests, ciphertext and historical audits are preserved. Signal/event retries
remain bounded and dead letters require operator review.

Migration tests cover 034 → latest, 037 → latest, 038 → 039–040 and fresh → latest.
The release validation record is [alpha.7 validation](contract-hardening-alpha7-validation.md).
Remaining hosted gates are recorded in [Hosted Beta blockers](../hosted-beta-blockers.md):
real Discord approval/SKUs and live operational acceptance, approved prices/tax/
parity, refunds/disputes and legal
retention, key lifecycle, production operations and formal Scale provisioning.
Passing this contract release is not approval for live payments or Hosted Beta.
