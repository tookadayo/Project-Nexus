# Promotions, partner grants and debug grants

A payment discount and an entitlement benefit are different. Types are DISCOUNT,
TRIAL, PLAN_GRANT, FEATURE_GRANT, PARTNER_GRANT and DEBUG_GRANT. Trial/plan/feature
benefits can apply without checkout. Partner/debug issuance is internal-only;
those campaign types cannot generate public redemption codes.

Campaigns store name/type, target plan/features, discount type/value, duration or
until-revoked, validity, total/per-guild caps, guild/organization bindings, allowed
plans/providers, stacking policy and creation/revocation provenance. Codes add
independent expiration, revocation, cap and bindings. Non-discount campaigns are
active on creation. Discount campaigns require explicit policy activation and
remain unusable until real provider discount integration exists.

Codes use 192 bits of cryptographic randomness. Store a short prefix and keyed
HMAC only, never plaintext. Plaintext is returned once at creation, is not logged,
is not included in URLs and cannot be recovered. Key rotation requires an
operator migration/rotation policy; do not change LOOKUP_KEY casually.

Redemption commits a persistent attempt throttle, then locks the guild privacy
fence and campaign/code rows. Binding, expiry, revocation, provider/plan eligibility,
stacking and both redemption caps are checked transactionally. A grant, redemption
and audit are written atomically. Cross-guild concurrent requests cannot exceed a
campaign cap. Discord interaction retries use a scoped request HMAC and return the
original result exactly once. A successful benefit does not alter any subscription.

Anonymous lifetime campaign/code counters preserve total caps even when guild
privacy deletion removes community-linked redemption history. No deleted guild
identifier is needed for those counters; deleted-guild tombstones prevent replay.
The public failure is PROMOTION_UNAVAILABLE regardless of private campaign details.

DENY prevents an additional benefit while a grant exists. MAX combines valid grants
by the effective resolver, not by additive subscription charges or stacked plan
rank. Redemptions record scoped actor, campaign/code UUIDs, benefit start/end,
created grant and optional provider-discount reference. No provider discount
reference is fabricated when external checkout is unconfigured.

`/nexus plan` responds ephemerally. A billing-authorized owner/current admin opens
the private Promotion code Modal; members never type codes into public commands.
The result explains the effective plan and expiry without campaign internals.
Web `/billing/promotions` uses a password input and same-origin POST. Transient
Discord modal data follows the existing short-lived encrypted interaction job
handling and is scrubbed on completion; it is never a permanent plaintext code
store or a log fixture.

`/billing/admin` requires real OAuth and NEXUS_INTERNAL_ADMIN_IDS, a separate
NEXUS internal allowlist. Discord Administrator/Manage Guild and NEXUS manager
roles do not grant internal rights. The internal form supports campaign creation,
code generation, search, revocation, redemption history, Partner/Debug/Contract
issuance and grant revocation. Each action/view is audited with a reason where
required. Operators must not put secrets or community member data in reasons.

Partner grants may be long-term or until revoked, displaying Growth / Partner
grant without falsifying paid/free subscription state. Production Debug grants
require an internal actor and reason, default to seven days and expire within 30
days. They cannot be issued by guild administrators. Enterprise contract limits
are scoped overrides, not global configuration.

Revoking a code/campaign stops future redemption. Already issued benefits retain
their documented term until their grants are separately revoked; explicit grant
revocation removes the overlay and refreshes rule/history state. Privacy deletion
can remove benefits immediately regardless of their expiry or billing grace.
See [security](billing-security.md) and [migration](plan-migration.md).

## Discount activation policy correction (2026-10-03)

DISABLED/NOT_CONFIGURED are checkout capability states, not blanket prohibitions
on external payment discount campaigns. Activation evaluates enabled plan
offerings, developer location and supported standard guild subscription plans.
An existing equivalent Discord offering always requires reviewed final prices.
Supported developer locations also require parity for supported offerings even
if checkout is disabled or incomplete; disabling the button cannot bypass policy.
Unknown applicability fails with DISCOUNT_POLICY_REVIEW_REQUIRED. Missing price
review, currency comparisons, or multiple ambiguous enabled offerings fail closed.
An unsupported developer location with no equivalent Discord offering permits a
verified external offering discount. Matching final prices pass; an external
price below Discord's equivalent final pre-tax price is rejected.

Partner/Debug/Trial/Plan/Feature grants are benefits, not payment discounts, and
remain independent of checkout capability. Activation does not make a payment:
DISCOUNT redemption still fails safely until a real provider discount adapter is
configured. No Discord coupon API is claimed. Policy was rechecked against
[Discord's official required support and discount guidance](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps)
on 2026-10-03; unsupported time-delimited discount exceptions are not automated.
