# Plan comparison and FAQ maintenance

`packages/settings/src/plan-registry.ts` is the plan definition source. The
comparison presents 44 available feature rows across five plans: 220 inclusion
values. The regression fixture also preserves 60 registry limit values.
Presentation changes must not create another entitlement definition.

## Display rules

- Keep Free, Starter, Growth, Scale and Enterprise in canonical order.
- Cards show selected real features; the full comparison retains every row.
- Group rows by the first included plan while preserving any non-monotonic
  values. Do not invent an Enterprise-only group or feature.
- Blue checks mean included; gray minus signs mean excluded. Accessible text
  conveys both meanings. Unknown and planned are explicit states, not exclusions.
- Keep horizontal scrolling inside the table, a visible feature column and a
  keyboard-reachable scroll region. Do not hide values to fit narrow screens.

The FAQ explains processed distinct members per server and UTC month, including
join/leave records. The monthly member count alone does not trigger automatic
extra charges or collection suspension. Other access restrictions still apply.

Unavailable data is not zero. Voice co-presence does not establish a conversation,
and reactions do not establish sentiment. Downgrade grace for some aggregate
history is distinct from invitation expiry and remains subject to retention and
deletion; it is not a preservation or recovery guarantee.

## Checks

```sh
corepack pnpm exec vitest run tests/unit/pricing-comparison.test.ts tests/unit/stripe-pricing-page.test.ts
node --import tsx tests/ui/pricing-comparison.ts
```

Build the web app before its browser harness. Verify JA/EN, narrow layouts,
keyboard scrolling/disclosure and all comparison values. Record actual results;
this guide does not claim those commands passed in the current checkout.
Payment availability remains governed by the existing
[Stripe pricing flow](alpha14-stripe-pricing.md).
