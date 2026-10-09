# Public prices and the existing Stripe flow

The pricing page uses the existing server-authorized Checkout flow. It does not
embed Stripe's Pricing Table or introduce a second purchase path. Discord Owner
verification, server selection, duplicate-subscription checks and the bound
billing operation remain in that flow.

## Catalog behavior

- Display a paid amount only for a unique enabled monthly USD subscription
  offering with complete provider mappings and a valid amount/tax classification.
- Keep provider Product/Price identifiers server-side. A public pricing read
  does not contact Stripe or create a Checkout Session.
- Do not fall back to provisional amounts when a mapping is missing or ambiguous.
  Preserve cents, currency, tax treatment and monthly renewal wording.
- Distinguish unavailable catalog reads from unpublished prices. Keep comparison
  information and confirmed recovery/navigation paths available during failure.
- Removing or disabling a mapping removes its public amount and purchase link
  on the next read; purchase authorization is rechecked by the existing flow.

Free and Enterprise remain separate from purchasable paid offerings. Closed
Beta 1 is a free invitation program, not a sixth plan or another name for Free.
Its existing program-wide capacity and invitation duration are not per-plan
entitlements. Price display and payment availability require the existing
server-owned launch conditions; editing this page cannot enable sales.

Test-mode amounts and buttons must identify test use when that mode is
explicitly selected. Test fixtures are neither approved sales prices nor launch
approvals. Never put provider secrets in frontend code or public settings.

## Verification

```sh
corepack pnpm exec vitest run tests/unit/stripe-pricing-page.test.ts
corepack pnpm exec vitest run --config vitest.integration.ts tests/integration/stripe-public-catalog.test.ts
node --import tsx tests/ui/stripe-pricing.ts
```

Use isolated synthetic infrastructure and build the web app before the browser
harness. Check complete/ambiguous/disabled mappings, failure states, amount/tax
labels and the existing account-selection path. This document records no fresh
test result. Actual provider payments, permissions and deployment acceptance
require separate evidence. See [known failures](alpha14-existing-test-failures.md)
and [publication gates](alpha14-publication-gates.md).
