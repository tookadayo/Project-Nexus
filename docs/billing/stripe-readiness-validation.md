# Stripe readiness validation record

Date: 2026-10-03 (Asia/Tokyo). Version stays **0.6.0-alpha.5**.
Base SHA: `437d822ceda9e1e069ec71edbe7b498cce1ec649`.
Final SHA is the delivered master commit (`git rev-parse HEAD`); the delivery
includes exact-SHA remote verification, avoiding a self-referential report hash.

## Local validation

| Check                                                                             | Result                    |
| --------------------------------------------------------------------------------- | ------------------------- |
| ESLint                                                                            | PASS                      |
| TypeScript                                                                        | PASS                      |
| Prettier for new/moved domain, action routes, new tests and changed documentation | PASS                      |
| Unit suite                                                                        | 33 files / 363 tests PASS |
| Full PostgreSQL/Redis integration suite                                           | 15 files / 185 tests PASS |
| Commercial focused integration                                                    | 38 tests PASS             |
| General browser E2E                                                               | 22 tests PASS             |
| Verification/billing E2E, English and Japanese                                    | 8 tests PASS              |
| Performance                                                                       | 3 files / 4 tests PASS    |
| Windows runtime manager                                                           | PASS                      |
| Workspace build                                                                   | 19 packages PASS          |
| Markdown links and migration/runtime preservation                                 | PASS                      |
| Git whitespace check                                                              | PASS                      |

Baseline import-only files retain their existing formatting. Next.js had cached
the old generic webhook route in ignored `.next-e2e` types; that cache was moved
to ignored `.local/next-e2e-before-stripe` and regenerated. No user source or
tracked history was discarded. Next's generated next-env changes were restored
to the tracked baseline after validation. Expected failure-injection tests log
synthetic Discord/provider errors; they pass and perform no live purchases.

Coverage includes alpha.5 commercial schema upgrade, legacy identity/digest
preservation, first-class Stripe, state mapping and trial policy, suspension and
expiration without indefinite grace, authoritative paid-through cancellation,
out-of-order/duplicate signals, retrieval lease fencing and bounded dead letters,
monthly/annual/multi-currency Offerings, Price-independent features, disabled
Checkout/Portal/webhook, unchanged entitlement after unverified requests,
durable failed request retries and payload conflicts, reserve/finalize/expire/
cancel, cross-instance campaign/guild/code limits, abandoned quota release,
finalization idempotence/revocation/payment evidence and scoped privacy deletion.
Existing Partner/Debug, downgrade/conflict, analytics/evidence and Free observation
regressions remain covered by the full existing suites.

## Provider and release gates

- Stripe: **NOT CONFIGURED / NOT LIVE**; even enabled flags/placeholder
  credentials cannot activate an unimplemented adapter.
- Discord: capability still depends on actual developer locale, approval and
  SKU configuration; local defaults are DISABLED. No live purchase was performed.
- Manual: existing scoped grants/legacy subscriptions continue; no external
  payment adapter or fabricated checkout was enabled.
- Real Stripe payment: **NOT RUN**.
- Stripe webhook validation with a real secret: **NOT RUN**.
- Live Discord purchase: **NOT RUN**.

Hosted payment gates remain the real Stripe adapter and acceptance, trusted
customer/scope mapping, production offerings/parity, signed webhooks, provider
payment/refund/dispute handling, Discord eligibility/approval/SKUs/live purchase,
and hosted security/operations/retention acceptance. See
[Hosted Beta blockers](../hosted-beta-blockers.md).

Web Experience v2 consumes the stable additive revision-1 presentation and
keyed Offering/session action contracts. Visual redesign was not performed.
Readiness is declared only after **verify** and **windows-runtime** succeed for
the exact final pushed SHA. That remote result is reported with the delivery.

For the complete auditable DELETE/MOVE/KEEP classification and exact old/new
paths, see [Repository cleanup](repository-cleanup.md).
