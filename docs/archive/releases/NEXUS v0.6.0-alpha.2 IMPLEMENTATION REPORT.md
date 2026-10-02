> Historical release evidence. Preserved from its original release; current contracts are indexed in [Documentation](../../README.md) and [Stripe readiness](../../billing/stripe-readiness.md).

# NEXUS v0.6.0-alpha.2 implementation report

## Implemented and fixed

- Attention now shows OPEN and ACKNOWLEDGED items, hides SNOOZED items until their deadline, and permanently hides RESOLVED items. A missing snooze deadline remains hidden. Helper notifications remain suppressed for every acknowledged, snoozed, or resolved item, including after a snooze expires.
- The four setup steps distinguish approval from Skip. Skip applies explicit safe defaults; saved choices advance to the next step. Completion updates setup progress, preserves revision checks, and upgrades reviewed v1 guilds only at the final step. Keep Existing Settings preserves choices as an explicit approval.
- Attention actions retain the displayed message identity across pagination. A resolved item or an item still snoozed cannot be reopened by an old action.
- Discord REST keeps route and major-resource bucket isolation and a process-wide cooldown only for global 429s. Transient network and 5xx retries are bounded to idempotent methods and nonce-protected panel sends; 403/404 are not retried.
- Panel moves keep `settings_panels` as the active source of truth. Old-message deletion is a separate outbox action, and expired panel action leases can be retried using the same Discord nonce. An orphan message cannot pass the active-panel component check. Outbox failures emit redacted NXS diagnostics.
- `/nexus panel` failures include the stage and safe Discord REST metadata under an NXS reference. The diagnostic path was exercised with `/nexus status` succeeding and `/nexus panel` failing.
- Doctor displays ghost listeners as GHOST / UNKNOWN, keeps ownership checks before repair, and can requeue command registration when a verified managed runtime reports it missing. CLI STATUS shows process uptime and clearer health. START, STOP, and RESTART show stage states and health feedback.
- Discord panel Web links use a guild-specific dashboard URL, reject credential-bearing URLs, and hide localhost in production. The Web route uses existing Discord OAuth/session authorization and returns to the intended guild. The current Web authorization policy remains owner, Manage Guild, or Administrator; configured Discord manager roles do not grant Web access. Public route slots are present for pricing, support, privacy, and terms.
- Workspace packages and release display report `0.6.0-alpha.2`. Global command scope continues to fail fast when unsupported. Discord and Web panel-open telemetry remain distinct.

## Verification

- Targeted tests cover Attention snooze durations and expiry, ACK/Resolve, setup approval and Skip, REST retry boundaries, panel move recovery, redacted NXS panel diagnostics, Web-link validation, and Windows runtime lifecycle.
- Final CI-equivalent validation: lint, typecheck, 143 unit tests, all 18 workspace builds, 63 integration tests, two performance tests, and Windows runtime manager tests passed.
- Browser E2E: eight tests passed on an alternate port. The default port 3100 was occupied by an existing NEXUS Web process, which was left running. The initial alternate-port run exposed an asynchronous page-reload race in one test; waiting for the activation publish navigation made the complete suite pass.
- A subsequent targeted OAuth route test passed, covering the intended guild redirect and rejection of an external return URL. Read-only STATUS and Doctor checks also passed against the existing managed runtime.

## Known limitations and beta blockers

- **Real Discord acceptance is not verified.** Repeated `/nexus panel`, the four-step wizard, Attention actions, permissions, OAuth return, and panel moves still need a live guild check. Tests use fixtures and local infrastructure.
- The existing local managed runtime was left running. STATUS shows its API is still `0.6.0-alpha.1` while the checkout is `0.6.0-alpha.2` and reports DEGRADED until a controlled restart. No live Discord behavior is claimed for the new release.
- Windows runtime tests use isolated fake service processes. A clean deployment with real PostgreSQL, Redis, Discord Gateway, command registration, and Web OAuth remains a manual beta gate.
- The public landing page and full pricing/dashboard redesign remain in the next Web Experience patch. Global slash-command registration remains unsupported and fails fast.
