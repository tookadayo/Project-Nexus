# v0.6.0-alpha.9 — Owner-Gated Commerce & Checkout Experience

Investigation base: `36dcdc9d3390282769d113d74fa57e74069237e6`, fetched from
`origin/master` on 2026-10-07 before implementation. This document describes the
implementation in this branch; final commit and CI evidence are recorded in the
release handoff after validation. Historical alpha reports remain historical.

## Purchase and financial authority

Pricing leads to `/checkout`, Discord OAuth (`identify guilds`), owned-server
selection, explicit connection, order review, Payment Element and confirmation.
`/servers` retains its community administration projection. Checkout separately
lists OAuth-owned guilds, with Administrator/Manage Server guilds explained in a
section without purchase buttons. Candidate listing confers no authorization.
Official Discord install links fix `guild_id` and `disable_guild_select=true`;
installation is read afresh after returning. `/nexus link` remains available.

The initial session and each Stripe write require a fresh Bot API member/guild
lookup, current Owner, active OAuth, verified connection, valid scope and privacy
fences. Core rereads entitlement and incompatible operations before writes.
`POST /checkout/connect` requires explicit `confirm:true`, same-origin, current
Owner, transaction revalidation, privacy locking and an audited sealed identity.
GET never connects. Extra amount/Price/owner properties are rejected.

| Action | Authority |
| --- | --- |
| VIEW | Current Owner/Admin/Manage Server, configured community manager, Primary Principal or explicit existing organization Billing Manager |
| CHECKOUT | Current Discord Owner |
| PORTAL | Primary Billing Principal |
| CHANGE / UPGRADE / DOWNGRADE / CANCEL | Primary Principal or explicitly persisted existing organization Billing Manager |
| ASSIGN_GUILD | Existing organization Billing Manager |
| REDEEM | Owner, Primary Principal or organization Billing Manager |

All roles still require current Discord membership and Bot installation. Financial
roles do not grant operations access. After Owner A starts Checkout, Core records
A's organization-keyed digest as Primary Principal. Transfer to B preserves the
contract, denies B access to A's Portal, and surfaces `BILLING_OWNERSHIP_REVIEW`.
Self-service financial ownership transfer and Billing Manager delegation UI are
not implemented. Departed principals need operator-assisted recovery; membership
is not bypassed. Historical customers without reviewed principal records fail
closed rather than granting the current Owner access to past billing details.

## Stripe and activation

The server resolves immutable enabled USD monthly Offerings and validates Stripe
Product, Price, amount, currency, interval, tax behavior and commercial identity.
The official Stripe SDK creates subscription Checkout Sessions with
`ui_mode=elements`. The official React `CheckoutElementsProvider`,
`ContactDetailsElement`, `PaymentElement` and `useCheckoutElements` handle payment.
NEXUS has no card-number, expiry or CVC inputs and no save-card checkbox. Stripe
owns payment fields; post-session subtotal, discount, tax and total use Stripe's
formatted Checkout amounts. `NEXUS_STRIPE_CHECKOUT_UI=HOSTED` retains hosted fallback.

The result union separates hosted URL from Elements client secret. Customer and
subscription references remain in tenant-sealed Core storage, never the browser
DTO. The return receipt is purpose-bound AES-GCM, identity/scope/Offering/operation
bound and expires after 24 hours. OAuth continuation separately expires after ten
minutes and binds Offering to OAuth state; arbitrary URLs are not stored.

Core fingerprints bind immutable Offering, promotions, UI and principal. The v3
namespace preserves historical v2 request digests. Organization/guild locks,
leases, provider idempotency and unknown-operation fences cover concurrent claims.
Customer creation is persisted before later Stripe writes. Payment retries reuse
one request UUID. Cached results are bounded by real Checkout expiry, separately
from Portal's five-minute NEXUS cache. Guild changes expire the previous provider
session first; an unknown expiry remains fenced. Abandonment grants no access.

Payment completion and return display `CONFIRMING`, never activate a plan.
The unchanged Node raw-byte webhook verifies the official Stripe signature, writes
a deduplicated Provider Signal and resolves trusted operation/customer/subscription
bindings. Core retrieves authoritative Stripe state through `RECONCILE_LATEST` and
projects assignments and Effective Entitlement. Confirmation shows ACTIVE only
when this Checkout has a verified completion and the purchased plan is actually
effective without conflict/grace. It also handles ACTION_REQUIRED, FAILED and
EXPIRED; provider failures preserve the prior state. Complete empty census is
absence; timeout/429/5xx/partial results remain incomplete and preserve access.

## Three P1 repairs

- Revoked organization members are tombstones for every linked guild, including
  guilds never joined and inactive links. Revocation/link/reactivation under the
  organization lock creates missing bindings. Request-local keyed digest lookup
  and credential checks also cover historical missing bindings. A later Discord
  Administrator role cannot restore operations, dashboard or credential access.
- Reactivation consumes a seat and reevaluates the current ACTIVE count under
  the organization lock. Two requests for one remaining seat yield one success.
- Invocation-local Stripe write classification treats read-only/preflight failures
  as definitive FAILED, clears the external marker and refreshes Checkout expiry
  on safe retry. Any possibly sent write remains RECONCILE_REQUIRED, including
  later errors after a Customer write. Fresh UUIDs and legacy unknown rows cannot
  bypass the fence. A fresh investigator and independent candidate review were
  completed using the Codex Security fix-finding workflow; two retry edge cases
  identified by that review were fixed and covered by regression tests.

## Migration, existing data and rollback

Apply additive `045_owner_checkout_authority.sql` before the new binaries. It
extends existing `billing_authorizations`, adds a unique current Primary per
organization, origin-operation FK, principal hash/UI fields and abandonment clocks.
Existing rows default to HOSTED; principals are not inferred or backfilled from
Discord ownership. No historical migration or customer commercial identity changes.

Retain migration 045 and financial records on rollback. Disable new purchases and
financial management while running a pre-alpha.9 binary, whose old authorization
policy allowed Discord administrators. Do not downgrade to that policy with live
Portal access. Owner transfers require audited operator review, not automatic
Customer reassignment. Pending/unknown sessions must be expired or reconciled
before migration/recovery changes; never clear unknown state merely to retry.

## Validation and release gates

Automated tests include P1 regressions, seat concurrency, Owner/Admin/Manage Server
negative checks, live transfer races, principal persistence, financial/community
separation, idempotency/concurrent Checkout, abandoned/unknown expiry and privacy.
The dedicated Playwright suite uses real OAuth handlers, isolated Discord and
Stripe HTTP fixtures, the official server/React SDKs, signed SDK-generated test
webhooks, authoritative provider retrieval and PostgreSQL projection. Payment
iframes are explicitly a Stripe.js fixture. It checks 360/390/768/1280 layouts,
identity, trusted total, reachable submit, card-fixture interaction and refresh.
This is not evidence of a real Stripe Sandbox payment.

Commands and results are finalized in the release handoff. CI retains Ubuntu full
verification and the Windows runtime gate, with a separate checkout Playwright
step and redacted secret scan. Real Sandbox alpha.9 payment remains unexecuted
unless separately documented with actual evidence; no Live charge is authorized.

| Release surface | Assessment criteria |
| --- | --- |
| alpha.9 implementation | CONDITIONAL GO pending all final local checks and exact-SHA CI |
| Stripe Sandbox | PARTIAL: fixture validation; real Elements payment not yet evidenced |
| Stripe Live | NOT READY: disabled, approvals and production acceptance outstanding |
| Hosted Beta | NO-GO: live Discord/privacy/operations and deployment acceptance outstanding |

No unresolved P0/P1 is claimed closed without the final tests. P2 limitations are
historical principal recovery, operator-assisted ownership review, and real
Sandbox/Discord/hosted acceptance. Complete transfer/delegation UI, JPY, annual,
email scope, Stripe Tax auto-enablement and Live real-money testing remain outside
scope.

Stripe implementation follows [the official React SDK guidance](https://github.com/stripe/react-stripe-js/blob/master/README.md).
Discord's [current required Premium Apps support and price parity](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps)
was rechecked on 2026-10-07. Applicability, actual native SKUs and final parity
approval remain Live gates; fixture success does not establish policy compliance.

Local validation (2026-10-07, macOS arm64 / Node 24.19.0): frozen install, lint,
typecheck, unit tests (431), full build (19 workspaces), integration (295),
performance (4), general Playwright (28), verification Playwright (11), checkout
Playwright (1 multi-stage flow), and redacted source secret scan passed. The
checkout flow includes an active contract surviving Owner transfer, old Principal
Portal access, new Owner Portal/receipt denial, and ownership-review presentation.
`pnpm test:runtime` was invoked locally and could not execute because
`powershell.exe` is unavailable on macOS; the existing Windows CI gate remains
mandatory. Final exact-SHA remote CI is reported separately in the handoff.

Residual triage at local validation: P0 **0**, P1 **0** identified in the repaired
and tested scope. P2: actual Stripe Sandbox Elements/3DS/payment-method acceptance
and production Discord/hosted acceptance remain pending; principal/ownership
recovery remains an audited operator workflow. This is a release-gated
CONDITIONAL GO, with Sandbox PARTIAL, Live NOT READY and Hosted Beta NO-GO.
