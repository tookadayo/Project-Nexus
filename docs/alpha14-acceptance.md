# alpha14 behavior and verification guide

This guide describes the implemented behavior and checks to run. It is not a
current test result or approval to operate a deployed service.

## Scope

- Home separates collection/access state, the current Attention count, permitted
  recent staff records, and daily activity. Unavailable information remains
  distinct from partial data and a confirmed zero.
- Attention supports state/channel filters, oldest-first cursor pages, refresh,
  and records of staff actions. A detected reply or staff record does not prove
  that a community issue was solved.
- Charts preserve missing observations, observed zero, units, period and data
  coverage. Keyboard details and table alternatives remain available.
- The public site distinguishes static product screenshots, the interactive
  synthetic demo, invitation Beta conditions, and the five standard plans.

## Boundaries to preserve

Attention pages bind the current actor, server and filters. Fresh authorization,
channel visibility, retained data and row version checks still apply. Refresh
includes new candidates; expired or revoked paging state requires recovery.
Deleting data or losing access must not leave a readable cached list.

The UI does not grant permissions. Public presentation changes must not alter
collection eligibility, billing, retention, deletion or server admission. See
[publication gates](alpha14-publication-gates.md) and the existing
[Attention operations guide](attention-operations.md).

## Checks

Use the repository's supported Node/pnpm setup and isolated test infrastructure.
Do not point test harnesses at production data or provider accounts.

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec vitest run tests/unit/alpha14-home.test.ts tests/unit/alpha14-charts.test.ts tests/unit/attention-visibility.test.ts
corepack pnpm exec vitest run --config vitest.integration.ts tests/integration/attention-pagination.test.ts
corepack pnpm exec playwright test tests/e2e/alpha14-acceptance.spec.ts tests/e2e/nexus-landing.spec.ts
```

Record the actual result and platform for each selected check. Focused success
does not establish that the full suite, real Discord/OAuth/payment flows,
physical devices, accessibility audit, backup restoration or load tests passed.
The [historical failures and current verification](alpha14-existing-test-failures.md)
separate corrected presentation assertions from the unresolved Windows ACL
fixture failure. The full suite must not be reported as green.
