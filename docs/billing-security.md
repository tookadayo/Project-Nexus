# Billing security and privacy

| Actor | View | Initial Checkout | Portal | Change/cancel | Organization assignment |
| --- | --- | --- | --- | --- | --- |
| Current guild Owner | Yes | Yes, live reverified | Only if Primary | Only if Primary or existing Billing Manager | Existing Billing Manager |
| Discord Admin / Manage Server | Yes | No | No | No | Existing Billing Manager |
| NEXUS community manager | Yes | No | No | No | No |
| Primary Billing Principal | Yes | Current Owner only | Yes | Yes | Existing Billing Manager |
| Explicit organization Billing Manager | Yes | Current Owner only | No | Yes | Yes |
| Ordinary member | No | No | No | No | No |

Financial authority requires current membership/installation and does not grant
community access. Historical Customer bindings require principal review. Owner
transfer does not cancel contracts or expose the Portal to the new Owner.

Authorization reads current Discord membership, roles, permissions and settings.
Snapshots expire after ten seconds; cached role state alone is insufficient.
Web mutations require validated real OAuth, verified server connection and
same-origin POST. API tenant credentials are not billing actors. Discord billing
management and promotion replies are ephemeral. Ordinary members receive no
purchase paywall or public-channel upgrade advertisement.

Stripe HTTP events fail closed when unconfigured. The official SDK verifies the
exact raw bytes and Stripe-Signature on the Node.js route, with both declared and
actual 64KiB size limits. Events become deduplicated signals after trusted
Customer/Subscription/operation scope binding; they never directly become paid
entitlement. Core retrieves current Stripe API state and serializes snapshot
revisions. Event creation time, metadata guild IDs and success redirects confer
no authority. The generic HMAC helper is confined to test fixtures, never Stripe
verification. Checkout/session IDs are not proof of paid entitlement.

Commercial identity locks when used. Idempotency fingerprints bind full Offering
and promotion terms; leases fence overlapping Checkout/change/cancel calls.
Unknown transport or partial mutation outcomes require reconciliation. Customer
references use keyed lookup digests and tenant-sealed retrieval values, with one
Customer per Billing Account and one guild per subscription. Sandbox rejects live
keys/objects; enabled production rejects test keys. Live purchase additionally
requires all documented commercial and operational approvals.

Provider event/reference keys use keyed digests; required provider references are
encrypted with tenant IdentityVault encryption. Codes use random one-time plaintext
and HMAC lookup. Do not log codes, session tokens, customer/subscription IDs,
payment signatures, card details or provider payloads. Stored normalized events
include only scope, plan/status, safe clocks/order and protected references. No
message body, reaction meaning, member activity or channel metadata goes to a
payment provider. Card data is never collected.

Audit categories include subscription creation/upgrade, scheduled downgrade,
cancellation, payment state, provider sync, billing conflict, campaigns, code
generation/revocation, redemption and grant issuance/revocation. Audit metadata is
bounded safe categories, counts and internal UUIDs; actor references are HMACs.
Internal failures return an NXS reference and log a sanitized failure category.

Existing privacy fences serialize deletion with projection/redemption. Guild
deletion removes community-linked inbox, grants, redemptions, usage, rule/recovery
state and allocations, revokes/scrubs guild-bound codes/campaigns, removes unused
encrypted provider references and scrubs guild/actor/reason audit fields. Member
deletion clears scoped actor provenance and organization roles without canceling
the guild's subscription. Required organization billing roles for other still
assigned guilds remain scoped to that organization. Deleted guild tombstones reject
provider replay; grace never resurrects community state.

Legal invoice/financial record retention is **not** established by this foundation.
No invoice archive or card store exists. Before real billing, define provider-side
required records, legal basis, retention period, deletion response and paid-contract
cancellation coordination. Guild privacy deletion does not claim to cancel an
external paid contract automatically. Reconnecting a privacy-deleted guild requires
explicitly reviewed new billing linkage, never replaying the deleted account.

Multi-instance work uses PostgreSQL transactions, advisory/row locks and leases.
REST is outside short DB transactions and remains subject to the existing outbox
ownership/compensation rules. An already delivered Discord write cannot be made
atomic with PostgreSQL deletion. Unknown delivery is not a safe automatic resend.

See [privacy inventory](privacy-data-inventory.md), [promotions](promotion-system.md)
and [hosted blockers](hosted-beta-blockers.md).

Final hardening keeps the billing presentation read endpoint private and uncached,
requires fresh authorization for every mutation, and hides redemption controls
from viewers without billing management rights. It exposes active scoped grants,
not promotion code inventories or internal campaigns. Discord plan views now show
provider/subscription state; their existing ephemeral interaction flow is retained.
History reads explicitly reject privacy-deleted scopes. A contract visibility
limit and billing recovery cannot authorize access to privacy-deleted data.


Current alpha.7 details: [contracts](billing/contract-hardening-alpha7.md) and
[Stripe integration](billing/stripe-integration.md). Real Sandbox purchase and
signed delivery are tested. Stripe Live remains DISABLED; production keys/webhook,
Discord approval/parity and hosted operational readiness remain release gates.

## alpha.9 checkout boundaries

See [release/design](alpha9-owner-commerce.md). Purpose-bound encrypted OAuth
intents accept only enabled internal Offerings. Same-origin strict POST schemas
reject client amount/Price/owner claims. Live Owner revalidation runs inside claim
and pre-write transactions. Stripe Elements owns payment fields and provider
formatted totals. Receipts never carry customer/subscription IDs; stored operation
results remain tenant-sealed. Unknown mutation or expiry results stay fenced.
`corepack pnpm check:secrets` checks API/webhook/Discord/session secrets without
printing values; known invalid fixtures are allowed only under tests.
