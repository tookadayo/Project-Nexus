# Known historical unit failures

The earlier alpha14 verification recorded **19 existing failures: 18 stale
presentation/version assertions and one unresolved Windows operator
credential-file ACL acceptance failure**. A comparison against the preceding
baseline reproduced the same failing names. This is historical evidence, not a
fresh test run of the current checkout and not a claim that the suite passes.

| Test file | Recorded failures | Classification |
| --- | ---: | --- |
| `tests/unit/alpha10-ui.test.ts` | 2 | Old Home button inventories |
| `tests/unit/alpha12-configuration.test.ts` | 1 | Windows credential-file ACL acceptance |
| `tests/unit/alpha3-polish.test.ts` | 3 | Earlier wording/action-count expectations |
| `tests/unit/alpha3-product.test.ts` | 1 | Earlier zero-state wording |
| `tests/unit/alpha5-payloads.test.ts` | 9 | Earlier Discord presentation snapshots |
| `tests/unit/stabilization-ui.test.ts` | 2 | Earlier Home intent inventories |
| `tests/unit/v060.test.ts` | 1 | Fixed older prerelease-version expectation |

Do not update snapshots or weaken security assertions merely to obtain a green
result. Reconcile presentation expectations against the intended behavior and
review the change. Compare current failing test names with this baseline;
unrelated assertion failures must not automatically be classified as historical.

## Public-branch verification

The public-branch preparation reproduced the 19 failures, then reconciled the
18 presentation/version assertions against the implemented Home actions,
conditional status wording, Discord presentation and alpha14 version. Component
limits, action authorization and unknown-versus-zero assertions remain in place.
The six affected test files passed 59/59 after those corrections.

A subsequent full Windows unit run with the cache disabled completed with
**792 tests: 791 passed and one failed**, the credential-file test below. This
is not a green full-suite result. The remaining failure occurs while the test
prepares its disposable Windows ACL fixture, before credential verification.
A disposable-fixture diagnostic identified PowerShell execution-policy rejection
(`SecurityError` / `UnauthorizedAccess`) before the ACL script body starts.
This does not demonstrate an ACL bypass, but real file-based operator acceptance
on this Windows environment remains unverified. No real credentials, ACLs or
execution-policy settings were changed, and the security check was not skipped
or weakened.

The Windows failure remains an operational acceptance gap for the real
file-based operator credential path. Synthetic in-memory authentication tests
do not close it, and this diagnostic does not establish successful Windows operator operation.
Do not relax ACLs or execution security settings as a test workaround.

## Initial hosted CI and browser-test corrections

The initial public commit's push and pull-request CI runs passed the secret scan,
lint, TypeScript checks, all **792 Linux unit tests**, production builds and the
Windows runtime job. Both runs then failed the main browser suite with
**19 failed and 21 passed**; later verification, checkout, integration and
performance steps did not run. These browser failures are separate from the
historical unit failures above.

The browser fixtures now bundle imported production CSS, including its token
imports, instead of asking Node to import CSS directly. Navigation and pricing
assertions follow the implemented menus, mobile dialog, five plans and comparison
tables. The Attention UI scenario uses stateful synthetic data while separately
checking that Basic development authentication is rejected by the real operations
route. It does not establish successful OAuth authorization or database writes.
No production authentication checks or test assertions were skipped to obtain a
passing result. Record the follow-up CI result against its actual commit.

A local Windows browser run after these corrections passed all **40 tests**, with
no failures, skips or retries. It used isolated synthetic services and a separate
same-drive checkout for the Web server to avoid the cross-drive dependency path
limitation. This run does not replace the later hosted OAuth, Checkout, database
integration or performance checks.

Record the current command, platform, selected tests and PASS/FAIL/NOT RUN
separately. Focused checks and historical comparisons cannot substitute for a
current full-suite result or deployment acceptance. Publication conditions are
tracked in [publication gates](alpha14-publication-gates.md).
