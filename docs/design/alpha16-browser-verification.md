# alpha16 offline component-browser verification

Executed 2026-10-16 with the existing cached Chromium/headless-shell 1243, one worker, no retries, stable Windows Local Temp. Final result: **85 passed, 0 failed, 0 skipped, 0 flaky** in **30.7 seconds**. Machine-readable result: `.local/alpha16-browser-report.json`.

`playwright.alpha16.config.ts` explicitly selects the eight self-contained specs below. Every beforeAll bundles local React/UI code into HTML with esbuild `write:false`. There is no webServer, Next process, DB, real Discord/API/OAuth/Tunnel, package install or browser download. `alpha16-browser-fixture.ts` fulfills every otherwise-unmocked request with a synthetic 503 response; declared page-level fixture routes take precedence. Service workers are blocked. The base origin is loopback only. Generated browser artifacts use `.local/alpha16-browser-results`, separate from real Next verification output.

|Spec|Passed|Covered checks|
|---|---:|---|
|alpha16-health-ui|6|Japanese/English, unknown versus healthy/empty, expiry, plan difference, permission/network failure, cancellation and repeated refresh|
|alpha16-lifecycle-web|13|Japanese/English empty state at 320px, pure result reads, preview/back/cancel, one POST on double-click, irreversible stopped state, nested draft editor, plan limit, 403/503, CAS and unknown-result status-only lookup|
|alpha16-maintenance|8|Japanese/English narrow empty state, cancellation/focus return, one POST on double-click, forbidden/network/conflict/unknown distinctions|
|alpha16-onboarding-flow|12|Japanese/English narrow empty state, permission and plan limits, 403/503, local simulation/cancel, scoped prepared-key double-click, stale publication/back, explicit publish, conflict and unknown transport|
|alpha16-operational-context|18|Japanese/English narrow empty state, permission/503, finite read-only unavailable fields, cancellation, one prepared mutation, multiple resources, explicit blank numeric settings, CAS/unknown, typed source controls, blank-version rejection, Japanese 320px layout and explicit positive cooldown input in Japanese/English|
|alpha16-personalization|10|Japanese/English template/preference lifetime gates at 320px, scoped own preferences, one prepared request, template cancellation/draft-only application, 403/503, CAS and unknown-result lookup|
|alpha16-rollback-ui|4|Japanese/English restoration difference, cancel, fresh revision, unknown transport, read-only permission and communication distinctions|
|alpha16-rules|14|Japanese/English narrow empty/detail state, cancel/back, one CSRF/scoped mutation on double-click, versioned shared rejection, 403/503, cancelled reads, CAS/stale/disabled-history and direct readable recommendations|
|Total|85|All declared tests in the selected eight specs executed|

The initial run was 82 passed/1 failed. Its single failure was an English test locator: `getByLabel('Revision')` also matched the input named `Earlier saved revision`. Adding `exact:true` selected the intended revision output without changing application behavior or weakening the assertion. The complete eight-spec rerun then passed all 83 tests. After adding the CASE cooldown metadata UI checks, the complete selected suite passed all 85 tests.

Target ESLint passed for the dedicated config, shared synthetic fixture and eight specs. The shared fixture re-exports the Page type for existing typed mocks. No application source change was needed for the initial browser failure. The later CASE cooldown metadata change adds a clear Japanese/English label and minimum 1 without a default value. A synthetic 60-second input is asserted in the prepared profile request; it does not set any operational profile.

These results exercise browser rendering/interactions against mocked DTOs. They do not establish real Next routing, production authorization, actual billing entitlements, DB correctness, live source coverage, Discord delivery, all target/browser combinations or complete visual accessibility. Plan differences are explicitly exercised in health, lifecycle and onboarding specs; other screens exercise their declared permission/retention/readiness restrictions. The parent owns actual Next build/local-route verification and the DB coordinator owns integration execution.

## Controlled Operator static-page smoke

`node --import tsx tests/ui/alpha16-operator-smoke.ts` also passed on 2026-10-16 using the existing browser cache and literal `TEMP`/`TMP` set to `C:\Users\reito\AppData\Local\Temp`. This is one scripted smoke, separate from the 85 Playwright test cases above. It serves only the existing three Operator HTML/JS/CSS files from an ephemeral 127.0.0.1 server, mocks `/operator/session` and all `/operator/v1/**` requests, blocks service workers and fulfills all other requests synthetically. No real session, OAuth, API, DB, Discord, deletion, recovery or restore is used. Cleanup closes browser/server even if launch or assertions fail.

The sandbox initially denied the loopback navigation (`ERR_NETWORK_ACCESS_DENIED`). The root-authorized test-only escalation was approved and the same guarded command passed. Assertions cover six UNKNOWN health components, Japanese/English, empty admissions, permission and network errors, deletion preview/cancellation with zero confirm requests, NOT_READY recovery and 390px layout without horizontal overflow or page errors. Screenshots `.local/alpha16-operator-en-mobile.png` and `.local/alpha16-operator-ja-mobile.png` were also visually inspected: labels/cards remain visible within the narrow page. Full keyboard accessibility, live authorization and destructive actions remain separate verification.
