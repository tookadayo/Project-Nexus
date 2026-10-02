# Stripe readiness repository audit

Base: `437d822ceda9e1e069ec71edbe7b498cce1ec649`. Release remains
`0.6.0-alpha.5`; work is directly on master with no branch/PR.

Inspected root, apps, packages, docs, migrations, scripts, tests, .github,
package/workspace/ignore configuration, settings source, billing routes,
Discord views, interaction handlers and workers before editing. References were
reviewed using git grep, imports, exports, package/CI scripts, documentation,
Next.js route roles and supported Windows entrypoints.

## DELETE

- `apps/web/app/billing/webhooks/external/route.ts` — unused unconfigured generic
  route; no runtime caller, package/test import, script/CI path or documentation
  link depends on the URL. Replaced with the explicit fail-closed Stripe route;
  no configured provider functionality removed. Route semantics were reviewed.
- No historical reports, migrations, source functionality, fixtures or tracked
  development artifacts were deleted. Git-tracked `.local`, coverage, test output,
  dist/build/.next, logs/tmp/bak/orig/tsbuildinfo were checked; none needed removal.
  Local ignored outputs remain available; ignore rules cover future artifacts.

## MOVE

All paths below are relative to the repository root. Billing moves establish
ownership and one public barrel, preserving algorithms except the documented
readiness changes. Callers now import the public billing entrypoint.

| Old                                           | New                                                                 | Reason                                                    |
| --------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| packages/settings/src/billing.ts              | packages/settings/src/billing/service.ts                            | Billing persistence/projector ownership                   |
| packages/settings/src/billing-domain.ts       | packages/settings/src/billing/domain.ts                             | Normalized subscription and entitlement rules             |
| packages/settings/src/entitlements.ts         | packages/settings/src/billing/entitlements.ts                       | Entitlement queries, limits and usage                     |
| packages/settings/src/billing-policy.ts       | packages/settings/src/billing/policy.ts                             | Commercial discount/parity policy                         |
| packages/settings/src/promotions.ts           | packages/settings/src/billing/promotions.ts                         | Campaign, redemption and grant ownership                  |
| packages/settings/src/billing-view.ts         | packages/settings/src/billing/view.ts                               | Canonical server presentation                             |
| packages/settings/src/billing-provider.ts     | packages/settings/src/billing/providers/types.ts + discord.ts       | Contracts separated from supported Discord implementation |
| NEXUS v0.5.1 IMPLEMENTATION REPORT.md         | docs/archive/releases/NEXUS v0.5.1 IMPLEMENTATION REPORT.md         | Historical release evidence                               |
| NEXUS v0.5.2 IMPLEMENTATION REPORT.md         | docs/archive/releases/NEXUS v0.5.2 IMPLEMENTATION REPORT.md         | Historical release evidence                               |
| NEXUS v0.5.3 IMPLEMENTATION REPORT.md         | docs/archive/releases/NEXUS v0.5.3 IMPLEMENTATION REPORT.md         | Historical release evidence                               |
| NEXUS v0.6.0-alpha.1 IMPLEMENTATION REPORT.md | docs/archive/releases/NEXUS v0.6.0-alpha.1 IMPLEMENTATION REPORT.md | Historical release evidence                               |
| NEXUS v0.6.0-alpha.2 IMPLEMENTATION REPORT.md | docs/archive/releases/NEXUS v0.6.0-alpha.2 IMPLEMENTATION REPORT.md | Historical release evidence                               |
| NEXUS v0.6.0-alpha.3 IMPLEMENTATION REPORT.md | docs/archive/releases/NEXUS v0.6.0-alpha.3 IMPLEMENTATION REPORT.md | Historical release evidence                               |
| NEXUS v0.6.0-alpha.3 QUALITY AUDIT.md         | docs/archive/releases/NEXUS v0.6.0-alpha.3 QUALITY AUDIT.md         | Historical audit evidence                                 |
| NEXUS v0.6.0-alpha.4 IMPLEMENTATION REPORT.md | docs/archive/releases/NEXUS v0.6.0-alpha.4 IMPLEMENTATION REPORT.md | Historical release evidence                               |
| NEXUS v0.6.0-alpha.5 QUALITY AUDIT.md         | docs/archive/releases/NEXUS v0.6.0-alpha.5 QUALITY AUDIT.md         | Previous alpha.5 audit evidence                           |

## KEEP / MERGE

Kept intentionally: migrations 001–037, all existing focused tests, snapshot
fixtures, supported NEXUS SETUP/STATUS/DOCTOR/START/STOP/RESTART Windows launchers
and PowerShell runtime files, security tooling, `scripts/scaffold.mjs` (historical
scaffolding utility), current release/architecture/security/operations documents,
and docs/v02 history. No speculative source deletion or fixture pruning.

Current billing documents keep established paths and are indexed from docs/README
rather than mechanically renamed. No duplicate production implementation is
retained; compatibility names on the unconfigured adapter remain fail closed.
The generic provider remains quarantined only for existing persistent history.
There were no exact duplicate reports requiring MERGE or destructive deletion.

Reference checks cover Markdown links, all TypeScript imports via typecheck/build,
CI/package paths, runtime launchers and actual billing route E2E. Moved historical
documents are explicitly marked and relative links adjusted. Existing historical
source paths are evidence, not live imports.
