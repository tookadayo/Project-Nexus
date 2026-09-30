# NEXUS v0.6.0-alpha.3 — Quality, language and authentication audit

Date: 2026-09-30. Base: `e80a983d599ae5d7af4c6bd642757ca4729061ad`, fetched from origin/master before work. Work is on master, with no branch or PR. Version remains alpha.3.

## Inspected scope

The initial inspection covered the repository inventory, shared dictionaries, hardcoded JA/EN, displayed backend conditions, and the following surfaces. The same surface inventory was searched again after implementation, including files that were not changed.

| Area | Surfaces and implementation inspected |
|---|---|
| Discord | Home, New Members, Attention, Analysis including channel/behavior tabs, Results, Settings and its sections, Setup, Diagnostics, Status, Privacy, Billing, Lifecycle, Improvements, Interventions, Experiments, Cohorts, Onboarding, readiness/activation, error panels, context commands, `/nexus link` and `/nexus unlink`; all `discord-panels/src/views` and worker dispatch |
| Web public/auth | Landing, Product, Pricing, Support, Privacy, Terms, public navigation/footer, Login, OAuth callback/select/logout, expired/problem states, Servers, Link and server connection |
| Web management | Overview, New Members, Attention, Insights, Improvements, Results, Goals & Rules, Settings; charts, loading/empty/error states, dashboard data fetches and all control/data/link routes |
| Runtime | START, STATUS, DOCTOR, STOP, RESTART, runtime manager/common/child output and Windows lifecycle tests. Existing service-specific technical CLI wording is retained |
| Definitions/security | Canonical analytics, CommunityService classifications and measurements, presentation adapters, settings/entitlement registry, Discord REST behavior, shared permission policy, snapshots, challenge/link storage and audits, privacy deletion, session cookies, Origin and redirect validation |
| Documentation | README, server verification and configuration/setup documents, release/audit reports and historical docs. Historical reports remain historical; current behavior is documented here and in the updated README |

## Findings and changes

- Abstract headings and literal substitutions had obscured what users were seeing. Current headings describe server overview, new members, replies, observed activity and results. Setup/event text says signup rather than attendance. JA/EN dictionaries are checked for prohibited phrases and internal implementation terms; sentences were also reread after replacement.
- The old Analysis KPIs described current member classifications as though they were newcomer results. The main summary now shows joins and exits in the requested period, plus the completed newcomer activity measurement. Staff exclusion and recent activity thresholds are in measurement rules. The old “inactive” class means activity days below a configured threshold, including people who were active once; it does not mean zero activity.
- Home and Web now consume the same measurement state, comparison windows and reply denominator. Reply average includes responders only, and displays responded / completed eligible members. This remains an average; the detailed canonical reply metric is a median with its own denominator.
- Configured later activity is `[retainedFromDay, retainedThroughDay)`, normally `[7,14)`. Its labels come from settings. The older detailed canonical D7 metric is `[7,8)` and needs eight completed days; D1 needs two and D30 needs 31. These definitions remain distinct. Home comparisons use moving seven-day join periods, not calendar weeks. Analysis uses the selected 7/30/90-day join period and the preceding equal-length period after accounting for the observation delay.
- ZERO, no eligible members, incomplete observations, too few observations and unavailable coverage have separate display paths. Failed API reads are carried as failures rather than silently becoming zero. Legacy Overview no longer claims a connected, empty server when its observation data is unavailable.
- Error handling has 14 shared categories. Known DomainErrors keep their meaning; PostgreSQL SQLSTATE failures, Discord timeout/rate/transport failures, Web connection failures and unclassified failures receive opaque NXS references with redacted server logs. Generic errors no longer list possible causes. Uncertain writes say the result cannot be confirmed. Read retries and current-state checks return to the original screen; stale controls open the latest panel. Channel permission errors offer notification settings and plan errors offer the plan page.
- Public copy describes replies, interactions and activity. Pricing describes the intended server/team, with availability and planned features still sourced from Plan Registry. Paid checkout remains unconfigured. Existing illustrative previews stay explicitly labeled as examples; production data was not fabricated.
- Shared dictionaries, `i18n/terminology.ts` and `i18n/errors.ts` supply common measurement, connection and error language. Production link/unlink panel factories are also used for screenshot approximations. No wholesale i18n or backend redesign was performed.
- Production OAuth E2E exposed exception identity differences across generated bundles. Shared Symbol brands now identify DomainError and DiscordFailure consistently, keeping unknown-guild denial and all invalid-code outcomes generic. Web view state is a validated numeric URL parameter, so current-state checks reload the originating page without repeating a write.
- The final screenshot review caught a malformed Japanese observation-window sentence and an isolated character wrapping in the Landing headline. The sentence and event-registration verbs were corrected, Setup was shortened, and the Japanese headline sizing was adjusted. The affected copy and screenshot checks were rerun.

## Authentication and Discord REST

Production rejects explicit development auth through one configuration validator used by the launcher, general startup configuration, Next instrumentation and access checks. Explicit Basic development auth requires a nonproduction environment and a password of at least 16 characters. Missing configuration never enables it. E2E Basic auth runs Next dev with an isolated output directory; verification E2E uses the production OAuth build.

Dashboard/control access checks OAuth identity and only the selected guild's live member, roles, ownership, settings and permanent link. Guild lists are fetched for `/servers`; individual installed-guild checks use bounded concurrency and produce unavailable cards independently. The Bot installation-list cache is still 60 seconds and is not a permission cache. Selected authorization failures remain closed.

Issue/redeem/disconnect wait for Discord before opening the mutation transaction. A request-local snapshot expires ten seconds after the member lookup finishes. Transactions recheck scope/user binding, snapshot age, settings revision under its normal lock, permission policy and challenge/link state. Slow Discord does not hold database locks; a concurrent settings change invalidates the snapshot. Discord revocation and database commits cannot be fully atomic, and the ten-second bound is explicit.

The existing Discord REST implementation retains route/bucket serialization, global cooldown, bounded timeouts and safe retry behavior. One request reuses its authorization result for verification, avoiding repeated member/role/guild fetches. Installation and current authority are still independently verified.

Code security is retained: random entropy, purpose-separated HMAC storage, ten-minute expiry, one use, issuer binding, reissue revocation, committed per-user attempt budgets, challenge failure limits, one winner under concurrent redemption, random link revisions and actor-bound disconnect confirmations. Unknown/expired/used/revoked/wrong-issuer responses remain generic. Unexpected storage/transport failures are classified without returning the supplied code. Codes are excluded from URL, reply outbox, audit, logs and screenshots. Privacy deletion and disconnect data preservation remain tested.

## OAuth lifecycle and remaining technical debt

Session lifetime is bounded by token expiry and seven days. Encrypted authenticated cookies, HttpOnly, HTTPS Secure, SameSite=Lax, short-lived state, state comparison, supported local redirect paths and return-to-dashboard behavior were reviewed. Logout clears all local authorization cookies before returning, even when best-effort token revocation fails. Live OAuth identity checks reject revoked grants.

Link redemption and disconnect also validate the OAuth grant before mutation. An expired/revoked session receives the session category rather than an invalid-code explanation; the Link page offers sign-in and a safe return path.

OAuth refresh is **not implemented** and remains a **Beta blocker**. Refresh rotation, encrypted server-side storage, concurrent refresh control and durable session revocation require a separate design. Refresh tokens are not retained. A copied encrypted cookie may remain valid until expiry if provider revocation fails; local logout alone cannot revoke that copy. Users must sign in again after expiry. There is no silent refresh loop.

Other practical limits: unavailable/retained data may prevent long observation windows; read-only metrics with partial coverage need the displayed coverage explanation; some advanced developer-oriented controls still have longer explanations. A reference generated after a browser-only network failure cannot be correlated with a server log automatically. A total database outage may prevent the worker from persisting an interaction reply; API/Web failures can still display a reference. These are operational limits, not claims that every outage is recoverable in the UI.

## Visual and manual acceptance

JA/EN desktop/mobile Playwright checks cover public pages, Servers, Link, all management pages and uncertain-write errors. Discord Components V2 approximations cover Home, no-data, New Members, Attention, Analysis, Results, Settings, notifications, Setup, Error, Link and Unlink, including mobile width, component limits and overflow. Approximation screenshots use fixtures and hidden placeholder codes; they are not evidence of a live Discord client render.

Real Discord desktop/mobile rendering, actual account OAuth consent, hosted HTTPS cookie/redirect behavior, live command delivery, permission removal on real roles/channels, provider revocation and deployment migration/command synchronization still require manual acceptance. These checks cannot be certified from fixtures. Billing/provider checkout, global commands and additional login methods remain outside this patch.

## Validation

Targeted checks preceded the final full validation: auth/snapshot/verification regressions, measurement states and denominator, language regressions, origin/issuer/stale confirmation checks, PostgreSQL verification transactions, UI operations and screenshot layout.

The delivery report includes the final pushed head's GitHub Actions result. This table records local execution, not an earlier Actions run.

| Check | Result |
|---|---|
| lint / typecheck | Passed |
| Unit | 187 passed in 21 files |
| PostgreSQL Integration | 90 passed in 5 files, including authorization outside locks, concurrent redemption, stale snapshots/confirmations, privacy and diagnostic REST metadata |
| Build | 18 workspace builds successful, including optimized production Next build |
| Web E2E | 19 passed; final view-context and Discord screenshot checks also passed after production-bundle fixes |
| OAuth verification E2E | 6 passed against the production build; issuer denial, generic invalid codes, arbitrary/unverified guilds, disconnect/relink/data preservation and permission loss |
| Performance | 2 passed; fixture reads for 10,000 members: 581 ms; 50,000 members: 8,868 ms. This is local read-path timing, not a hosted-service SLA |
| Windows runtime | Manager tests passed |
| Visual artifacts | `test-results/quality-*.png`, `polish-*.png`, `verification-*.png`; fixture/approximation limitations described above |

The initial full run exposed a lost command field in diagnostic logs and production bundle exception identity issues. Those were fixed and their affected suites rerun successfully; tests were not weakened to accept the incorrect behavior. Existing copy expectations were updated to match the new definitions and labels. The final view-context check verifies that checking an uncertain save returns to Settings and does not repeat the write.

## Product decisions and Beta blockers

- OAuth refresh/rotation and durable revocation remain the main authentication Beta blocker. Reauthentication at expiry is intentional for this alpha.
- Hosted HTTPS deployment, operational recovery and live Discord acceptance remain required before Beta certification.
- Billing checkout remains unconfigured; no subscription, Stripe, public API key, SSO, passkey, 2FA or new login feature was added. Paid-price publication follows Plan Registry approval state.
- Global commands are intentionally unsupported and fail at configuration validation. Guild command synchronization remains the supported alpha path.
- Collection remains metadata only within existing settings. Disconnect keeps analytics/settings/history. Activity not visible to Discord cannot be inferred.
