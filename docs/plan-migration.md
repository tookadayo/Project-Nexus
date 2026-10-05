# Plan registry v1 → v2 migration

Base alpha.5: `8ba55f83c91253eeeb218ee97340e2e821cda042`. Master is the source
of truth. Current release is 0.6.0-alpha.7. Migration 039 follows shipped
001–038 unchanged; changes are additive and transactionally applied.

1. Back up PostgreSQL and identity/lookup keys using the existing operations process.
2. Apply `corepack pnpm migrate` through 039 before starting the updated apps.
3. Inspect immutable `billing_plan_versions` revision 2 and seeded LEGACY grants.
4. Leave payment/native configuration disabled until the hosted blockers are met.
5. Check Free core observation, current authorization, helper/digest preservation
   and privacy deletion. Do not rewrite usage counters or pretend to import payment.

Public names FREE/STARTER/GROWTH/SCALE/ENTERPRISE and internal provisional prices
are preserved. Existing `guild_subscriptions`, `usage_counters`, `usage_events` and
their historical interpretation remain intact. The immutable catalog snapshot is
checked against the application registry by migration regression tests.

| Legacy feature                                                           | Canonical feature    | Compatibility                                                        |
| ------------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------- |
| advanced_cohorts                                                         | surface_breakdowns   | Explicit alias                                                       |
| diagnosis                                                                | comparable_periods   | Explicit alias                                                       |
| automation_auto                                                          | attention_automation | Explicit alias                                                       |
| experiments                                                              | improvement_tracking | Explicit alias                                                       |
| connection_metrics                                                       | connection_metrics   | Now included in Free                                                 |
| fallback_onboarding, hybrid_onboarding, custom_activation, interventions | Same key             | Preserved; automatic side effects still require attention_automation |

Deprecated price/included/guilds read aliases remain for alpha.5 callers. History
duration is a numeric limit, not a family of duration feature flags. Ordinary UI
uses human JA/EN copy, never the internal names in this table.

Existing non-Free legacy subscriptions receive explicit LEGACY plan overlays with
their existing validity. Configured legacy helper/weekly digest capabilities get
LEGACY feature overlays so deployment does not silently pause previously working
settings. They are visible/auditable, not fabricated provider subscriptions.
Once real verified billing has been imported, an internal operator reviews and
explicitly revokes the transitional grants. Do not silently revoke on first
provider contact. Future renewals require the real provider path.

New normalized allocations take precedence over the legacy subscription fallback;
explicit migration grants preserve the previous entitlement independently. Legacy
Free guilds need no paid migration and gain basic surface observation/connection
metrics. Development-only overrides remain development-only. Privacy tombstones
take precedence over both old and new billing state.

Integration coverage boots a database through migration 034, seeds an existing
Starter guild with helper/digest settings, applies 035–039 and verifies preserved
access, immutable catalog rows and untouched accounting. Downgrade recovery, worker
pauses, grants and deletion are also covered. Billing rollback requires a reviewed
application/database compatibility deployment, not dropping new tables blindly.

Alpha.7 also tests 037 → latest, 038 → 039 and fresh → latest. Migration 039 locks
all pre-existing Offerings because prior ever-enabled history is unavailable;
new never-enabled drafts remain editable. It adds durable unknown-operation state and trusted
customer guild ownership, and enforces one assignment per subscription. Invalid
enabled Stripe mapping or an existing multi-guild assignment aborts the transaction
for operator review; it never silently deletes or remaps financial records.
Historical reference digests, ciphertext, input digests and audits are unchanged.
An already leased pre-alpha.7 PENDING operation becomes RECONCILE_REQUIRED because
the external outcome may be unknown. Existing FAILED operations also fail closed
on a retry under the new digest contract, without rewriting the old payload.


Current alpha.7 contracts and commerce: [contracts](billing/contract-hardening-alpha7.md)
and [Stripe integration](billing/stripe-integration.md). Real Sandbox is tested;
Stripe Live remains DISABLED.
