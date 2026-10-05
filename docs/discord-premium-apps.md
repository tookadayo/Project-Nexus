# Discord Premium Apps review

Official documentation reviewed **2026-10-05**. Installed discord.js 14.27.0 and
discord-api-types 0.38.55 were inspected before implementation. Recheck eligibility
and policies before activating a public offering; this review does not establish
approval, an actual SKU purchase or successful live billing.

NEXUS is guild-scoped. Configure real **Guild Subscription** SKUs for STARTER,
GROWTH and SCALE, never personal subscriptions or invented production IDs. Native
capability is AVAILABLE, UNSUPPORTED_DEVELOPER_LOCALE, NOT_CONFIGURED or DISABLED.
AVAILABLE requires explicit enablement, operator-recorded approval, a supported
developer country, application ID and three distinct valid SKU IDs. The shipped
example is disabled with empty IDs: **DISABLED / NOT CONFIGURED**. Alpha.7's
real Stripe Sandbox tests do not enable Discord Native Billing or approve parity.

[Monetization eligibility](https://support-dev.discord.com/hc/en-us/articles/17297949965079-How-Do-I-Monetize-My-App)
currently lists developers based in the US, UK and EU. Japan is unsupported in
that list. This concerns the developer's location, not the guild language, user's
language or host timezone. [Enablement requirements](https://docs.discord.com/developers/monetization/enabling-monetization)
include team/application eligibility and Discord's setup/review requirements.
An environment flag cannot replace Discord approval. Validate actual SKU type,
guild flags, application ownership and price mappings in the Portal/API before
enabling production; these have not been validated with live credentials here.

The [subscription implementation guide](https://docs.discord.com/developers/monetization/implementing-app-subscriptions)
supports multiple tiers. **Entitlements** establish access; Subscription objects
describe renewal/cancellation lifecycle. Active recurring entitlements can have a
null end. Cancellation keeps access until the period ends; upgrade replaces the
old entitlement promptly, while downgrade retains it through the current period.
The guide is newer/more specific than older FAQ wording about multiple SKUs.
NEXUS follows authoritative guild Entitlement data, with Subscription metadata
still a hosted blocker. Test-mode and user-only entitlements do not unlock a guild.

Only AVAILABLE shows purchase actions. Official
[SKU and Store links](https://docs.discord.com/developers/monetization/managing-skus)
use `https://discord.com/application-directory/{applicationId}/store/{skuId}`
or the application's `/store`. All other capabilities show a Web plan link.
No imitation payment form exists inside Discord. REST reconciliation feeds the
verified inbox before projection; clicking the link grants nothing.

[Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
and the [monetization support explanation](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps)
require equivalent supported Discord offerings at no higher final pre-tax price,
including discounts. The explanation allows certain technically unsupported
first-month/time-limited subscription discounts; repeated/permanent discounts
remain constrained. NEXUS uses a conservative compatibility check: equivalent
currency and reviewed prices are required, and external-only discounts that make
Discord more expensive are rejected. The documented exception is **not** an
implemented checkout exemption. No Discord coupon API is invented. Payment
discount application uses real Stripe Coupons in Sandbox. Live activation stays
blocked without an approved compatibility path and current equivalent final-price
review. The Sandbox run used explicit Discord-price fixtures, not approved SKUs.

[Monetization Policy](https://support.discord.com/hc/en-us/articles/10575066024983-Monetization-Policy)
and [Monetization Terms](https://support.discord.com/hc/en-us/articles/5330075836311-Monetization-Terms)
also apply. Store localized price, tax and proration are never fabricated in a
NEXUS preview. No live checkout, Premium Apps approval or production purchase was
performed during this release. Stripe-hosted Sandbox purchase and Webhook tests
are recorded separately in [Stripe readiness](billing/stripe-readiness.md).

The current [Channel API](https://docs.discord.com/developers/resources/channel)
has no stable dedicated LFG channel type in the inspected type table. LFG remains
an administrator-mapped Forum/Thread purpose. Unknown future numeric channel types
are tolerated and remain UNKNOWN until documented. Forum support comes from
observed channel type/capability, never the Community flag alone.
