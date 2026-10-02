# Hosted beta blockers after alpha.5 commercial hardening

This update ships a provider-neutral entitlement/promotion foundation. It does
not establish live payment success, Premium Apps approval or production checkout.

| Area                | Required before hosted commercial rollout                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe billing      | Implement/configure the Stripe adapter; exact signed webhook parser, authoritative scope/customer mapping, real checkout/cancellation/plan-change adapters, refunds/disputes and end-to-end sandbox/live acceptance                            |
| Discord             | Eligible developer/team and actual approval; real guild subscription SKUs and Portal/API validation; approved prices/parity; immediate authoritative event ingestion and Subscription renewal/cancel metadata; live-client purchase acceptance |
| Pricing/promotions  | Public currency/price approval; comparable final prices/currency and discount policy review; real provider discount application, duration/stacking and reversal; no coupon API assumptions                                                     |
| Financial privacy   | Invoice/legal retention, provider deletion coordination, support/refund/cancellation processes and controlled key rotation                                                                                                                     |
| Scale               | Organization onboarding, five-slot assignment, billing-manager provisioning UX, multi-guild overview, complete RBAC, commercial API authorization/quota and audit-export workflows                                                             |
| Planned functions   | Custom scheduled reports, Webhooks, AI explanations; report/webhook limits are catalog reservations, not shipped capabilities                                                                                                                  |
| Operations          | Production secrets/OAuth lifecycle, privileged intent review, backups/PITR and restore drills, database/worker/provider outage drills, alerting for aged inbox/leases/conflicts and hosted capacity/cost evidence                              |
| Discord observation | Current live permission/intents and channel obfuscation readiness; real Discord acceptance beyond mocked tests; experimental LFG remains administrator-mapped until a stable official API exists                                               |

Available operational workflows reuse the existing guild queues, helper reminders,
weekly digest, Attention/intervention revisions and experiments. Larger catalog
limits do not claim a new multi-queue/report/team-seat provisioning UI. Enterprise
custom contracts do not imply SSO/SAML or dedicated infrastructure exists.

The alpha.5 quality audit remains historical evidence. This file records current
commercial blockers; see [architecture](billing-architecture.md),
[native policy review](discord-premium-apps.md) and [security](billing-security.md).

## Web Experience v2 handoff

The server billing view, feature decisions and plan-change preview are ready for
a future Web presentation redesign. The visual redesign is outside this change.
Real external payment and live Discord SKU purchases have **not** been tested.
Native capability still follows actual configuration (default DISABLED; incomplete
configuration NOT_CONFIGURED; unsupported developer location remains unsupported).
The 3,650-day query safety bound does not deliver longer physical retention;
contract retention provisioning must be reviewed before promising it to customers.
Scheduled reports, Webhooks, multi-guild allocation, RBAC, API, audit export and
AI explanation remain PLANNED and denied centrally. Existing hosted commercial
blockers above remain release gates for live payment operations.
