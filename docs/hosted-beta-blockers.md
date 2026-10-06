# Hosted beta blockers after 0.6.0-alpha.8

Stripe Commerce Launch Foundation implements the official SDK, hosted Checkout,
Customer/Offering mapping, signed Webhooks, authoritative reconciliation, Portal,
changes, cancellations and financial promotion evidence. Real Sandbox Web purchase
and lifecycle tests pass. Live Stripe remains DISABLED; no real-money payment,
production Webhook or Premium Apps approval is established.

| Area                | Required before hosted commercial rollout                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe billing      | Production secret rotation and signed Webhook configuration; unknown Checkout/mutation operator recovery; refunds/disputes, production alerts and approved Live acceptance                                                                     |
| Discord             | Eligible developer/team and actual approval; real guild subscription SKUs and Portal/API validation; approved prices/parity; immediate authoritative event ingestion and Subscription renewal/cancel metadata; live-client purchase acceptance |
| Pricing/promotions  | Public USD $15/$49/$149 approval; current equivalent Discord base and discounted final-price review, localized currency treatment, production discount/reversal policy; Sandbox parity fixtures do not approve production                      |
| Financial privacy   | Invoice/legal retention, provider deletion coordination, support/refund/cancellation processes and controlled key rotation                                                                                                                     |
| Tax/legal           | Approved seller/tax jurisdiction and legal review; Tax collection decision (pending), tax behavior and customer disclosure; no automatic Tax enablement                                                                                        |
| Scale               | Live Discord acceptance and operational trials of the implemented five-slot organization, RBAC, service accounts, API quotas, independent approval and redacted audit workflows                                                                |
| Planned functions   | AI explanations, Google OAuth, Slack/email/Jira/CRM destinations, SSO/SCIM, residency and DPA commitments                                                                                                                                      |
| Operations          | Production secrets/OAuth lifecycle, privileged intent review, backups/PITR and restore drills, database/worker/provider outage drills, alerting for aged inbox/leases/conflicts and hosted capacity/cost evidence                              |
| Discord observation | Current live permission/intents and channel obfuscation readiness; real Discord acceptance beyond mocked tests; experimental LFG remains administrator-mapped until a stable official API exists                                               |

alpha.8 adds real versioned Playbooks, branded chart reports, signed webhooks, scoped
API, organization teams and independent approval. Their automated fixtures do not
replace live Discord acceptance or hosted capacity tests. Enterprise contracts do
not imply SSO/SAML or dedicated infrastructure exists.

The alpha.5 quality audit remains historical evidence. This file records current
commercial blockers; see [architecture](billing-architecture.md),
[native policy review](discord-premium-apps.md) and [security](billing-security.md).

## Implemented Web commerce and remaining gates

Pricing has real Sandbox purchase CTAs and authenticated provider-neutral billing
settings with current state, scheduled changes, Portal and cancellation. Checkout
success only confirms through NEXUS state; it cannot grant access. Real Stripe
Sandbox purchase has been tested. Real-money and live Discord SKU purchases have
**not** been tested.
Native capability still follows actual configuration (default DISABLED; incomplete
configuration NOT_CONFIGURED; unsupported developer location remains unsupported).
The 3,650-day query safety bound does not deliver longer physical retention;
contract retention provisioning must be reviewed before promising it to customers.
Scheduled reports, Webhooks, multi-guild organization licensing, RBAC, scoped API
and audit export are implemented in alpha.8. AI explanation remains PLANNED and
denied centrally. Existing hosted commercial blockers remain Live release gates.

Live checkout requires public price approval, production key and Webhook,
Discord monetization compatibility, current parity approval, paid feature
readiness, tax/legal review, refund and support policies, monitoring, incident
handling and backup/restore readiness. Every gate defaults false. Implemented
multi-community/team/API features still require production paid-feature approval.
Hosted Beta remains NO-GO until the relevant hosted/Discord/privacy/operations
gates above are evidenced. See [Stripe integration](billing/stripe-integration.md)
and [alpha.8 validation](alpha8-community-operations.md).
