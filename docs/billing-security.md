# Billing security and privacy

| Actor                                        | View guild billing                       | Upgrade / downgrade / cancel / redeem           | Assign organization slots               | Internal promotions/grants |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------- | --------------------------------------- | -------------------------- |
| Current guild owner                          | Yes                                      | Yes                                             | No, unless organization billing manager | No                         |
| Current Discord Manage Guild / Administrator | Yes                                      | Yes                                             | No, unless organization billing manager | No                         |
| NEXUS manager                                | Yes                                      | No                                              | No                                      | No                         |
| Organization billing manager                 | Yes, current membership/install required | Yes                                             | Authorized model; workflow planned      | No                         |
| Ordinary member                              | No                                       | No                                              | No                                      | No                         |
| NEXUS internal allowlist + OAuth             | Separate internal administration         | Guild authority still checked for guild actions | Separate scope                          | Yes, audited               |

Authorization reads current Discord membership, roles, permissions and settings.
Snapshots expire after ten seconds; cached role state alone is insufficient.
Web mutations require validated real OAuth, verified server connection and
same-origin POST. API tenant credentials are not billing actors. Discord billing
management and promotion replies are ephemeral. Ordinary members receive no
purchase paywall or public-channel upgrade advertisement.

External HTTP events fail closed while their real provider is unconfigured. A
future adapter must verify the provider's exact signature format on bounded raw
bytes, timestamp/replay policy, account/application ownership and scope mapping
before returning an authoritative normalized event. Never trust a caller-supplied
authoritative flag at an HTTP boundary. HMAC utility tests do not demonstrate live
Stripe verification. Checkout/session IDs are not proof of paid entitlement.

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
