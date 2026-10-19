# alpha17 integration validation plan

2026-10-18. Target: the existing C:/Users/pc-ad/NEXUS-SERVICE checkout at alpha16 base 8d23caeacecd6b09672f5f8a5ef6901ad1e9271c plus the approved local alpha17 changes. Preserve earlier validation evidence. No new features or large design changes.

## Scope and acceptance

| Stage | Acceptance and evidence | Boundary |
|---|---|---|
| Foundation | Installed Docker client and a responding Linux/amd64 Engine; fixed-digest official PostgreSQL 18.6; authenticated readiness and owned-resource cleanup receipts | First Desktop/WSL initialization and disposable synthetic DB were explicitly approved. No production compose, data, secrets or migration. |
| Cold and warm connection behavior | Separate fresh pools; max10 / 500ms per acquisition; cold idle1 to eight concurrent requests must all succeed; warm prepares eight distinct ready connections; retain timings and failures independently | Keep the existing Windows native PG18.4 beta cold FAIL. Linux results do not overwrite it or prove production acceptance. |
| OAuth2 and authorized server display | Official-site app link, login start, synthetic Discord authorize/callback, manageable guild list, authorized dashboard; cancel, expired/invalid state, logout and unauthorized guild rejection | Use existing test injection/FakeDiscord only. Distinguish component mocks, real local Next/API fixtures, and untested live Discord OAuth. Never add an application auth bypass. |
| Integration behavior | Server information isolation, settings saved and reflected after reload, analytics/proposals, automation authorization/deduplication, private Operator permissions/expiry | Reuse the smallest relevant existing tests and fixture constructors. No real external dispatch or deletion. Production fail-closed guards remain enabled. |
| Small existing UX/behavior bugs | Reproduce before a scoped fix, add meaningful regression coverage, then validate changed source | Initial candidates: READ-only server card destination, OAuth cancellation message, article language switch destination. Do not implement new capabilities. |
| Security | One ordinary offline source review: guild separation/IDOR, auth/state/session/cookie/CSRF, Operator loopback, secret leakage, XSS/input, automation reauthorization/deduplication/SSRF, private-file exclusion from static output | security-scan SKILL was consulted, but its required MCP is unavailable. Do not claim a completed Standard scan or fabricate canonical artifacts. Record source evidence, impact, conditions, coverage and unverified paths. |

## Execution and reporting

Complete foundation checks first. Prepare and independently review the disposable Linux DB runner before execution. Use isolated Docker CLI config and whitelist child environments; generate synthetic-only authentication without printing or sending it externally. Bind only 127.0.0.1. Settle all requests and close pools before deleting only UUID/label/ID-owned container/data resources; uncertain outcomes must remain uncertain until checked. Do not prune unrelated resources.

Map existing tests before starting integration work. Run each relevant unchanged group once; repeat only for changed code, observed failures or unresolved concerns. Record whether browser tests mock network or exercise the real local Next/API. Use appropriate final type/lint/build verification after source fixes. Preserve failed assertions, not just successful warm runs.

Live Discord login needs approved application/client configuration, grant and callback origin. Actual public site/Tunnel/DNS, runtime credentials, ACL/service permissions and production startup remain separate approval/acceptance work. Do not retry the denied real-credential strict preflight. Do not disable safety, retention, restore, publication or unknown-information gates to obtain a pass.

Evidence is retained in C:/Users/pc-ad/Documents/Codex/2026-10-18/task. Report passed, failed, blocked and untested items separately. Real authorization, external delivery and long-running/reboot production operation cannot be inferred from synthetic tests.

## Selected first integration run

Use playwright.verification.config.ts through a task-only sanitized runner/config: the existing ja/en selections for verification pages show four real states, unverified/arbitrary URLs, permission loss, operations tiers/exports/editable forms, and explicit Viewer (seven cases), plus one small core setup save-to-reload/dashboard seam. CI=true, no existing server reuse, loopback listeners, explicit owned fixture/process cleanup. Source fixes finish before the build. One required Next production build is owned by this run; do not repeat it merely for a second report.

These fixtures use real local Next/API/temporary DB and FakeDiscord, with a seeded authenticated fixture session. They do not cover the real Discord login/callback grant. Separate synthetic OAuth units cover success, matching-state cancellation, invalid/missing state and no new session on rejection. The official static artifact login link is checked independently.

The core settings seam and Worker/proposal/analysis/automation gaps must be reported honestly. Existing Web RulePlatform has no operational policy and is intentionally closed; do not wire or enable it in production as a test fix. The additional business-path test selection will reuse the smallest existing synthetic group after dependency/cleanup review.
