# alpha.10 billing stabilization design

Design recorded before implementation on 2026-10-08 (Asia/Tokyo).

- Reuse: organization/scope advisory locks, durable `billing_operations`, UUID request identity, encrypted provider references, immutable commercial Offerings, Stripe adapter preflight, OAuth identity validation, same-origin protection, webhook signature verification and reconciliation.
- Change: claim records a lease only; each provider mutation commits its own lease-fenced phase marker. An active pending claim blocks competing request keys before any marker. Customer persistence and result persistence use the same lease token. A completed external stage cannot be erased by a later definitive preflight failure.
- Add: migration 048, phase evidence, account-bound financial authority lifecycle, archived customer bindings, personal payment listing and PORTAL/CANCEL route reachable through `/billing/payments`, process-termination regression fixtures and confirmed provisional release.
- Conflict: the current authorization always fetches Discord membership, preventing departed payers from managing their own bills. The financial route validates OAuth identity and persisted authority/account/revocation; guild operations retain their separate existing membership boundary. Current abandonment only expires a session and leaves provisional authority indefinitely.
- Migration: append 048; do not edit applied 046. Historical external starts remain conservatively unknown. Existing authority is retained and account-bound where a known account exists; uncertain historical rows cannot gain new portal authority through a guessed binding. Released customer bindings remain encrypted historical records and are never reassigned or deleted from Stripe.
- Unchanged: first checkout is Owner-only; billing manager does not become a server administrator; new Owner cannot inherit old customer access; pack sales and Stripe Live remain disabled; plan quotas, prices, UTC month accounting, Stripe SDK/API version and reconciliation policy remain unchanged.

## Primary specifications and tools

Read Stripe official documentation with installed `stripe docs` CLI v1.53.0 and queried the installed Stripe MCP documentation tool (some searches returned irrelevant results; those results are not specification evidence). Read on 2026-10-08:

- <https://docs.stripe.com/api/idempotent_requests>: identical POST keys require identical parameters; keys may be removed after 24 hours. Preserve existing scoped keys and 23-hour retry cutoff; durable unknown stages require reconciliation instead of a fresh UUID.
- <https://docs.stripe.com/webhooks>: verify raw body/signature, handle duplicate events and retrieve authoritative state. Existing signed inbox and authoritative reconciliation are retained.
- <https://docs.stripe.com/customer-management> and <https://docs.stripe.com/customer-management/integrate-customer-portal>: create a portal only after authenticating the customer in the application; portal sessions are temporary. The saved financial principal and account match select the encrypted customer, never a request-supplied customer identifier.

The existing instance-based Stripe Node SDK remains 23.0.0, with its bundled API version `2026-09-30.endive`, pinned by the lockfile. Adapter mutation hooks are application code and require no SDK upgrade. Read the local Next.js `page.md` and `route.md` guides required by `apps/web/AGENTS.md` before editing Web routes.

## Security boundary investigation

The attacker-controlled request key previously reached `BillingOperationService.session` while only `external_started_at` fenced competing Checkout keys. Moving this timestamp without fencing valid claims would permit two purchases. The narrow boundary is the scope-locked claim plus token-checked durable provider marker. All Checkout, Portal, Change and Cancel adapter callers must carry these hooks.

Financial access is restricted to OAuth identity and an active persisted principal tied to the selected account. This capability grants no analysis token, guild snapshot, channel information or configuration access. Independent read-only investigation was performed as a separate source pass because the available agent slots were occupied; the candidate will receive a separate bypass/regression review.

## Provisional release and recovery

Automatic release also requires that NEXUS has never issued, attempted, or retained an in-flight Portal for this billing account. An issued Portal can attach a payment method after a point-in-time census; those accounts require operator review and retain their principal. Portal claim and mutation boundaries are serialized by the same scope lock and reject abandonment in progress. Only authoritative provider evidence can release a provisional checkout: the exact session is expired and unpaid, its customer matches the bound customer, subscription census is complete and empty, and customer invoice/payment-method census is complete and empty. Provider failures, pagination, any subscription, any invoice, saved payment method, payment intent or default payment source retain the fence. Confirmed release revokes the provisional authorization and archives the customer binding. Subsequent Owner checkout creates a new Customer. Unknown Customer/Checkout writes retain durable phase evidence for internal reconciliation; do not issue new keys or delete Stripe Customers.

## Verification

Environment: local macOS, Node 24.19.0, genuine Corepack 0.36.0 and pnpm 11.19.0, embedded PostgreSQL 18.4 and Redis from `/opt/homebrew/bin/redis-server`. No real payment-provider credentials were used.

- `pnpm exec vitest run tests/unit/billing-stripe-provider.test.ts`: PASS, 41 tests. Includes exact unpaid-expired evidence, complete empty census, pagination and provider-failure denial, invoice/payment/subscription history denial and ordered Customer/Checkout hooks.
- `REDIS_BINARY=/opt/homebrew/bin/redis-server pnpm exec vitest run tests/integration/billing-stabilization.test.ts tests/integration/owner-checkout.test.ts tests/integration/billing-contract.test.ts tests/integration/billing-privacy-contract.test.ts --config vitest.integration.ts`: PASS, 63 tests across four files. New stabilization suite has 18 tests; seven use a real child process, six terminate it with SIGKILL and one resumes it after lease takeover. The provider acceptance ledger lives in a separate committed database table, so the tests distinguish no-send, accepted-with-lost-response and completed-stage-without-result states without running catch during termination.
- Focused ESLint over changed billing/security/web and fixture files: PASS.
- `pnpm --filter @nexus/web build`: PASS (Next.js 16.3.5), includes `/billing/payments` and preserves the existing current-guild `/billing/manage` plan-change/pending-payment interface.
- `pnpm exec playwright test --config playwright.verification.config.ts -g "billing is private"`: PASS, 2 existing English/Japanese billing tests, including current-guild management controls and provider-not-ready copy.
- `pnpm exec playwright test --config playwright.checkout.config.ts`: PASS, 2 browser tests. Existing Owner-only checkout and signed-webhook flow retained; departed payer reaches the visible personal payments screen, obtains a portal and requests cancellation; wrong account and cross-origin requests fail; membership cannot open analysis; confirmed abandonment archives the old Customer and a new Owner purchase binds a fresh Customer.

The browser test uses a local HTTP fixture for the official Stripe SDK and a Stripe.js fixture in Chromium. It is not a live Stripe Sandbox card payment. Live Stripe payment, live Discord and Hosted acceptance: NOT RUN. The full repository final checks and exact-SHA CI are owned by the root verification record.

## Internal recovery procedure for unknown Checkout stages

1. Freeze the relevant scope; do not issue another UUID or change the saved principal. Inspect `billing_operations`, `billing_operation_external_steps`, the encrypted customer binding and existing audit categories with the configured internal operator identity. Never put raw payment identifiers in public logs or Discord payloads.
2. If the claim has no external marker and the lease expired, repeat the original request or submit a new Owner request through the ordinary Checkout boundary. It token-fences the old process and only releases the old provisional authority when no Customer exists. Do not reinterpret a legacy unknown operation as unstarted.
3. If any marker exists, identify the exact Stripe object in request logs and the object metadata `nexus_operation` (and Customer `nexus_scope_digest`). Retrieve it in the original Stripe account and mode. A Customer-only stage remains fenced until an operator confirms what happened; a network failure is never absence. Retain every completed stage and customer binding.
4. For a known completed Checkout, reconcile its exact subscription through the existing signed inbox/authoritative reconciliation. For a known expired unpaid Checkout, use the verified abandonment path only after the exact operation/Customer binding and complete empty financial census are confirmed. Its scope-locked commit checks recorded subscriptions, provider inbox and completed purchase markers again before revoking provisional authority and archiving the customer binding.
5. If the operation lost its result before it was saved, the operator must reconstruct the exact encrypted result and reference binding under an audited maintenance transaction before invoking normal reconciliation/abandonment. This repair requires explicit operator evidence and is intentionally not an automatic retry or an exposed user action. A Customer without a provable Checkout remains in internal review. If any Portal was issued or remains pending/unknown, retain the payer authority and require operator review even when the point-in-time financial census is empty; its independent Stripe capability prevents proving that no future payment method can be attached. Preserve the financial record; never delete Stripe Customers or transfer their identifiers to the new Owner.

The async-authority lease-expiry reproducer first failed because the provider write occurred after the lease expired. Its fix performs the marker UPDATE with `clock_timestamp()` after revalidation; the regression then passed. Result saving rechecks authorization and uses the same live-clock lease fence.

Code-level safeguards for the two P1 findings pass the focused gates. The independent fresh candidate review and final repository/exact-SHA gates must also pass before the final record calls the financial P1s FIXED.

## Independent candidate review corrections

The fresh read-only reviewer identified three concrete issues in the first candidate: a provisional Portal could mutate Customer state after an empty census; older server billing actions did not pass authority revalidation to every provider boundary; and replacing `/billing/manage` removed the current-guild management UI.

The revised candidate blocks automatic release whenever a Portal was issued or remains pending/unknown, fences Portal starts throughout abandonment, carries OAuth + saved account authority + current guild/verification revalidation through PORTAL/CANCEL/CHANGE claim, mutation and result saving, and rechecks sensitive pending-payment results before returning them. `/billing/manage` again renders its existing current-guild management interface; `/billing/payments` is the visible personal financial-only route. New regression tests cover issued/pending Portal retention, a concurrent Portal attempt during census, and revocation during each real Stripe adapter's delayed preflight. Existing English/Japanese management acceptance tests pass again. The final reviewer recheck and root exact-SHA gates remain required for the final financial status.
