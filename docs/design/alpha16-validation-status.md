# alpha16 validation status

Recorded 2026-10-16 in the existing Windows checkout `D:\Project Nexus`,
branch `codex/alpha16-rule-platform`, baseline commit
`35b0d22398c1463e2c88d7f49d960fa8a065002a`. This ledger is included in the
user-authorized local alpha16 checkpoint commit; its SHA is reported separately
so that the commit does not need to contain its own identifier.
Selected model: GPT-6.1 Sol / Ultra.

This is the current consolidated execution ledger. Earlier implementation
evidence describes its own source-only stage; its NOT_RUN wording does not
supersede results here. Historical alpha15 counts are not alpha16 test passes.

## Input and checkout protection

- Formal ZIP SHA256:
  `47cd62d4ba7cddac2477bde8c3df18e1f4a1d3d0b27484fb88b9ead13dbde66e`.
- All 37 original files in `alpha16-source` match the materialization receipt
  `.local/alpha16-input-receipt.json`. Documents are source material; the user's
  direct scope and later decisions control authorization.
- The pre-existing user change in `apps/web/next-env.d.ts` has SHA256
  `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000`.
  Each Next build restores these exact protected bytes. Exclude this file from
  any implementation commit. The latest post-build hash matched.
- The user authorized saving the approved implementation and verification
  records in one local commit on this branch. The pre-existing user file,
  ignored `.local` logs/reports/test data, generated builds and secrets are
  excluded. No separate checkout, release-version bump, push, merge, purchase,
  production activation or deployment is included.
- Pre-commit review found 487 approved regular source/specification files.
  The repository secret scanner passed 1,528 source files; additional read-only
  review found no real secret or generated artifact in the commit candidates.
  All 37 staged specification blobs matched their received hashes. Original
  specification whitespace is preserved byte-for-byte; maintained sources use
  a separate staged whitespace check. One new-code EOF blank line was removed
  during that check without changing behavior or rerunning full test suites.

## Execution results

Consolidated verification is complete within the authorized synthetic scope,
with the one environment-blocked unit failure below. This is not G4 completion
or production acceptance; real activation prerequisites and source gaps remain.

| Check | Current result | Evidence / limits |
|---|---|---|
| Whole-workspace TypeScript | PASS, exit 0 | `.local/alpha16-typecheck.log`; installed CLI |
| Whole-workspace ESLint | PASS, exit 0 | `.local/alpha16-lint.log` |
| Whole unit suite | 163 files: 2,753 passed / 1 failed of 2,754 | `.local/alpha16-unit-final.log`; the remaining failure is the PowerShell prerequisite below |
| Operational CASE cooldown tests | 3 files / 267 tests PASS | `.local/alpha16-case-cooldown-unit.log`; synthetic profiles only |
| All disposable PostgreSQL integration | 108 files / 1,058 tests PASS | `.local/alpha16-db-latest-results.json`; latest completed result per file, no failed/blocked/not-run/skipped cases or unhandled errors |
| alpha16 disposable PostgreSQL integration | 33 files / 173 tests PASS | `.local/alpha16-db-alpha16-final.log` and `.vitest.json`; fresh migrations 060 through 082, privacy/restore/immutable/cooldown/parent UNKNOWN included |
| Webhook/API/metadata integration | 5 files / 22 tests PASS | `.local/alpha16-db-webhook-source.log`; mock transports only |
| Existing alpha15 regression | 33 files / 389 tests PASS | `.local/alpha16-db-alpha15-fixes.log` plus `.local/alpha16-db-temporal-fixtures.log`; latest per-file results replace earlier fixture failures |
| Other integration regression | 42 files / 496 tests PASS | `.local/alpha16-db-remaining.log`, `.local/alpha16-db-legacy-fixes.log` and the existing API/webhook file in `.local/alpha16-db-webhook-source.log` |
| Japanese/English component browser | 8 files / 85 tests PASS | `.local/alpha16-browser-report.json`; cached Chromium, one worker, no real Next/API/DB; unmocked network returns 503 |
| Loopback Operator browser smoke | PASS | Mock APIs; JA/EN, six health states, empty/permission/network, preview/cancel, recovery NOT_READY, mobile |
| Official static generator | PASS | `.local/alpha16-static-generation.log`: 19 local files, 18 manifest payload hashes verified, published:false |
| Next production build | PASS, exit 0 | `.local/alpha16-web-build-final.log`; module compile, Next TypeScript and route generation completed |
| Actual Discord/OAuth/domain/Tunnel/hosting | NOT_RUN | No real sends, deployment or settings changes authorized |
| Production migration/deletion/restore/backup enforcement | NOT_RUN | Only disposable synthetic data used |

The standard `corepack pnpm` command cannot fetch its uncached pnpm version
because registry DNS is unavailable. Verification uses installed CLIs directly;
no install/download was used. Vitest requires process-local literal TEMP/TMP
because the sandbox's default cache path is virtualized and inaccessible.
Sandbox TCP and Next junction restrictions were handled by approved exact
test/build commands using synthetic data only.
Targeted batch counts overlap the full-suite results and must not be added.
The 2,753 unit passes exclude the one failed test; the 267 cooldown checks are
already inside that unit suite. Integration groups are disjoint by file:
173 + 389 + 496 = 1,058; targeted 22-test and repair batches are subsets, not
additional passes. The 85 browser cases are the final eight-spec run only;
earlier 83-case and focused reruns are not added. Operator smoke is one separate
script, and static file/hash counts are not test-case counts. There is no
cross-category grand total.
The latest complete per-file result replaces earlier attempts in
`.local/alpha16-db-latest-results.json`.
The ledger reconciles verbose case counts and available native JSON reports
against every completed batch summary. Its regeneration helper is
`.local/alpha16-db-ledger.mjs`. Initial failed attempts remain in their logs and
are not counted as current passes. All final fixture stop hooks completed;
`.local/alpha16-db-process-check.json` records zero PostgreSQL/Redis processes.
See the durable [database verification evidence](alpha16-db-validation-evidence.md)
for execution boundaries, batch reconciliation and resolved findings.

## Blocked environment prerequisite

**FAILED (environment):**
`tests/unit/alpha12-configuration.test.ts` >
`stores a salted operator hash and accepts only an owner-private regular credential file`.
It invokes `scripts/operator-acl.ps1 -File` on its synthetic temporary credentials.
Sandboxed and approved execution both fail. A separate empty synthetic JSON
reproduction reports PowerShell `UnauthorizedAccess`: this PC disables script
execution. A read-only child-process check confirmed effective policy
`Restricted` (`.local/alpha16-powershell-effective-policy.txt`). No policy change
or execution-policy bypass was applied under the
user's prohibition on security-setting changes. The owner-private credential
file path and real Operator authentication on this PC remain unverified; the
source ACL requirement is unchanged. See `.local/alpha16-unit-acl.log`.

## Defects corrected during execution

- Fixed two JSX syntax errors, strict DTO/SQL row types and lint diagnostics;
  adjusted legacy tests to the current async proxy and CSRF contracts.
- EXP/PLAY now validate the configured outer window and its three equal,
  contiguous, half-open comparison periods.
- The common immutable trigger treats zero-argument TG_ARGV as an empty
  allowlist; NULL no longer bypasses sealed Fact/context/source-health changes.
- Observation SQL explicitly types timestamps; post observations are no longer
  swallowed by the channel-structure-only projector.
- Webhook plan changes preserve admitted uncertainty as UNKNOWN and block the
  endpoint. Ineligible candidates no longer starve later endpoints. Parent Run
  uncertainty propagation and canonical lock boundaries have regression tests.
- Explicit positive elapsed-seconds cooldown metadata now connects operational
  CASE profile validation and UI to the existing engine gate. No real duration
  or threshold is automatically adopted.
- Relative .js specifiers resolving to existing TypeScript files were normalized
  across newly reached server dependencies. Real JavaScript/vendor/loader
  references were preserved.
- Stale fixtures, semantic button positions and six individually reviewed
  snapshots were updated. Production authorization, plan, hash, admission and
  retention contracts were not relaxed to obtain a pass.
- Synthetic new until/approval literals were made whole-second ISO values;
  runtime clocks, derived instants, stored Run timestamps and sub-millisecond
  SQL comparisons preserve their original precision.

## Scope and held features

The [feature mapping](alpha16-feature-mapping.md) and
[source gaps](alpha16-source-gaps.md) give the underlying bindings. This is the
exact held scope of the checkpoint. Readiness codes describe missing runtime
configuration/evidence; they do not revoke approved retention maxima or add
pre-display approval to recommendation READ.

| Scope | Kept disabled or unavailable |
|---|---|
| Entire CASE source gate | **CASE03 and CASE04 only**: `CASE_ISSUE_TARGET_SOURCE_UNAVAILABLE` (HELP policy has no authoritative individual-issue relation). Enabled profile save/active evaluation is closed; disabled drafts, catalog/status and other compatible READ remain available. |
| Partial UNKNOWN, not entire CASE disablement | HELP actual first-response/explicit STALLED; CASE02 noContact/historical staff role; CASE05/08 opt-in; CASE07 preferred format; CASE16 current alert class; CASE19 authorized viewing; CASE20 incomplete forum census. Legacy 081 stamps, permissions, original retention and coverage can also make individual observations UNKNOWN. |
| New Rule generation/runtime | Measured provider, active configuration and PC runtime injection are unset: `MEASURED_OPERATING_PROVIDER_UNCONFIGURED`, `OPERATIONAL_CONFIG_NOT_ACTIVATED`, `PC_RULE_RUNTIME_UNCONFIGURED`. No threshold/cooldown/budget auto-adoption. |
| Suggestion external operations/editors | Initial catalog is `REVIEW_ONLY`; external Apply is `APPLY_ACTION_NOT_REGISTERED`. Unsupported editors return `TYPED_EDITOR_NOT_REGISTERED`; the eighteen types are listed below. The eleven connected native draft targets are separate. |
| Webhook / additional Automation operations | Unadopted Webhook dispatch: `WEBHOOK_DISPATCH_POLICY_UNAPPROVED`, zero IO. New Managed Role enable/execute: `MANAGED_ROLE_G3_NOT_READY`. Rollback: `AUTOMATION_ROLLBACK_AUDIT_NOT_READY`, with separate `AUTOMATION_ROLLBACK_SAFETY_NOT_READY`. Existing reads/history/ordinary Flow operations are separate. |
| Additional persistence | Template/own Preference mutations: `PERSONALIZATION_RETENTION_UNCONFIGURED` for `TEMPLATE_DEFINITION`, `PERSONAL_PREFERENCE`, `PERSONALIZATION_REQUEST`. New Experiment/Intervention/Onboarding Web mutations: `LIFECYCLE_REQUEST_RETENTION_UNCONFIGURED` for `LIFECYCLE_WEB_REQUEST`. Reads remain available. |
| Manual Report generation | `MANUAL_REPORT_DISABLED` / `REPORT_ARTIFACT_RETENTION_REQUIRED` and runtime/privacy/source-visibility/budget requirements. Report-definition CRUD and existing Detailed Analysis retention are not globally disabled. |
| Public publication / Legal / Contact | `PUBLIC_PUBLISH_DISABLED`, `PUBLICATION_RETENTION_NOT_APPROVED`, `PUBLICATION_ORIGINS_NOT_VERIFIED`, `PUBLISHER_CAPABILITY_UNVERIFIED`; `PUBLICATION_HISTORY` and `PUBLICATION_WITHDRAWAL` are separate purposes. Legal stays releaseBlocked; Contact stays `CONTACT_OPERATIONS_NOT_APPROVED`. Legacy article reads/offline static generation are separate. |
| Independent safety / restore | Lifetimes/providers for `TARGET_LIVE_SAFETY`, `RESTORE_TOMBSTONE`, `PUBLICATION_WITHDRAWAL` remain unset: `SAFETY_LIFETIME_UNCONFIGURED` / `INDEPENDENT_SAFETY_SOURCE_UNCONFIGURED`, plus target writer requirements. Missing/expired state never becomes OPEN; no unlimited retention was adopted. |
| Operator dangerous mutations | Initial preview/step-up/audit policy remains unconfigured (`OPERATOR_PREVIEW`, `OPERATOR_STEP_UP`, `AUDIT`, `STEP_UP_POLICY_REQUIRED`). Deletion additionally requires `DELETION_RECEIPT`, `DELETION_JOB`, `TOMBSTONE`, `DELETION_POLICY_REQUIRED`, `DELETION_WRITER_COVERAGE_UNVERIFIED`; Beta lifecycle/guild erase also requires verified code scope. Old dangerous routes return 428. Authenticated READ is separate and real authentication is NOT_RUN. |

Unsupported editor types: `GUILD`, `CHANNEL`, `INTAKE`, `EVENT`,
`COMMUNITY_REQUEST`, `ANNOUNCEMENT`, `SOURCE`, `PERMISSION`, `MODERATION_QUEUE`,
`DUTY_BUCKET`, `FILTER`, `ACCESSIBILITY`, `FORUM`, `AUTOMATION_RUNTIME`,
`GUILD_PERMISSION_PROFILE`, `ISSUE_TARGET`, `DATA_SOURCE_METRIC`, `COMMUNITY_POLICY`.

New Fact/evaluation/source-health/evidence keeps the selected 48-hour maximum;
minimal history/audit/suppression/receipts keep fourteen days, with earlier
original expiry winning. Run details/backups keep their separate seven-day
ceilings. Reads/copies/retries/saves do not renew anchors. Other retention
purposes, measured operating profiles, independent target safety and stopped-PC
restore/publication enforcement remain separate activation gates.

Webhook construction without an adopted profile intentionally leaves pending
work unsent. This safety pause is separate from the repaired compatibility
regressions. No gate was weakened to demonstrate a send. See
[Webhook evidence](alpha16-webhook-compatibility-evidence.md),
[browser evidence](alpha16-browser-verification.md) and the
[alpha17 handoff](alpha16-alpha17-handoff.md).

## Alpha17 confirmations still required

- Resolve and reverify the named ACL failure only in an authorized environment;
  no script-policy/ACL change or bypass is part of this checkpoint. Real Operator
  login, permissions and step-up remain NOT_RUN, separate from that failed test.
- Verify actual Windows service startup/shutdown/offline recovery, finite expiry
  enforcement, seven-day backups and restore against independently fetched
  latest tombstones/safety. Synthetic integration passes are not live evidence.
- Check real domain/TLS/OAuth/cookies/CSRF/Tunnel ingress, internal/Operator
  exclusion, expressly authorized Discord installation and live user permissions.
- Establish measured finite profiles, remaining purpose-specific enforcement,
  missing authoritative source semantics and concrete publisher/withdrawal
  capability before enabling the corresponding row above. No new personal-data
  collection or permission expansion is implicitly authorized.
- Preserve the earlier alpha15 acceptance ledger's S031/T040 partial coverage,
  T116 unconfirmed combinations and T114 missing formal fixture; this suite's
  counts do not certify those exact pending acceptance items. Unevaluated zoned
  expressions still use current host Intl rules; old tzdb pinning and numerical
  library relink/real transport checks remain outside the executed scope.
