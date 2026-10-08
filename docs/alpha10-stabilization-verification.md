# alpha.10 stabilization implementation and verification

Work date: 2026-10-08, Asia/Tokyo. Repository: `tookadayo/Project-Nexus`. Work began on [PR #4](https://github.com/tookadayo/Project-Nexus/pull/4), branch `codex/alpha10-analysis-operations`. Final prepublication inspection found that PR had been merged externally while implementation was in progress. Publication therefore uses the alpha.10 follow-up branch `codex/alpha10-stabilization` from refreshed master, without overwriting the merged branch or bumping the product version.

## Repository evidence

The working tree was clean before implementation. `git fetch origin` and GitHub PR inspection confirmed start/local/PR HEAD `71a27f937e8dd534c40c767033d91a492cdce44c`, master/PR base `5638fe34a9169c95b6fb138222bcd4a84d8ee97d`, and an open, draft, unmerged PR. Final inspection/fetch found master `fa27c654072154b9b23749ba1fc071fe18b81b15`, the merge of PR #4. Its tree is byte-identical to the starting alpha.10 HEAD (`git diff` is empty and the start HEAD is its ancestor), so all tested source changes carry over without replaying or discarding work. The containing commit and final follow-up PR body identify the final candidate SHA; a tracked document cannot embed its own commit hash. Final branch, published HEAD, push-workflow SHA and PR merge-workflow SHA are recorded separately in the final handoff. No version bump, force update, branch overwrite or merge is performed by this agent.

## Implementation

The shared typed resolver keeps a normal channel's activity on its own ID beneath a category. Only public/announcement threads inherit a parent channel's purpose. Categories group reviewed selections; private threads, unknown types, missing thread parents, prohibited/deleted places and missing collection permissions fail closed. Explicit exclusions take precedence. New category setup expands the reviewed children into a fixed ID selection, with pagination and batch purpose editing. Legacy `all`, `include` and `exclude` settings retain their meanings. Renames and category moves do not erase explicit ID mappings.

Location post occurrences are projected independently of newcomer eligibility. Staff announcements and Bot/Webhook occurrences remain visible as posts; Bots do not become human participants. First observed human Forum responses need no Reply reference. Ordinary direct replies remain a distinct definition. Response obligations require confirmed SUPPORT/BUG_REPORT/LFG purposes as appropriate; casual, guide, announcement, showcase and unmapped places do not acquire obligations. Stable tag IDs determine administrator-defined resolution; archive, lock and tag names do not. Conflicting state tags require review. Poll participants are distinct observed subjects, separate from multi-answer totals; signup and observed event attendance remain separate.

Historical participant-only ingestion cannot prove complete staff/Bot-inclusive post totals. The final coverage correction records per-Guild collector introduction and separate row provenance, including imported `observation-v3` rows. Historical and crossing windows retain observed positive counts as lower bounds, block comparison and return unknown for unsupported zero. Row-free windows receive the same limitation. The analysis recipe advances to v3 so saved v2 results cannot become baselines for the corrected evidence; immutable prior results and v1 correction eligibility remain intact. Basic, preview and result screens explain the limitation in Japanese and English.

Basic analysis has six free views. Detailed analysis keeps the original five identifiers and adds `ANNOUNCEMENTS` and `SHOWCASE` with separate purpose-filtered calculations. Quotas stay 1/3/5/10/custom per Guild and UTC calendar month; Scale organization licensing and concurrency are separate. Packs remain classified 1/3/5 and disabled.

Preview freezes exact UTC boundaries. Semantic confirmation includes meaningful scope, purposes, recipe and consumption conditions; data identity is a separate checksum of scoped sources. Unrelated activity, language-only changes and activity after the end of the confirmed window do not demand repeated confirmation. Corrections and deletions of relevant data change reuse identity. First-response state is clipped at the period end. Results retain original conditions, actual target IDs, definition, data identity and calculation time. Privacy deletion invalidates affected results and their aggregate Attention items while preserving immutable run/usage history.

The period end is exclusive for replies as well as posts. A response exactly at the end leaves both metrics and scoped reuse identity unchanged; one millisecond before the end changes both. The regression failed first with five replies instead of four and passed after aligning the aggregate with the existing checksum boundary.

History uses opaque database cursors tied to tenant, actor and filters; PostgreSQL timestamp precision and ID ordering are preserved. Previous/next pages and filtering do not consume a use. Comparison candidates are filtered in SQL, including compatible evidence definitions, rather than searching a capped recent list. Queued cancellation and stale delivery are fenced by database state and finalize a reservation once. Intake is bounded to five queued runs per Guild, 25 per organization, 12 previews per actor/Guild/minute across processes, and a 24-hour queue expiry. Existing BullMQ priority, aging, organization/Guild concurrency, requester reauthorization, lease fencing and Redis reconstruction remain in use. Physical computation may repeat after failures; valid result publication and consumption can only finalize once.

Discord has five stable home entries, private navigation, staged setup drafts, review before saving and review before adding result-derived Attention. Summaries show at most three leading metrics, two compatible changes, correct units and optional details. Unknown data and observed zero differ. Recursive Components V2 limits, complete custom IDs, safe user strings and suppressed mentions are validated. Shared installed panels remain entry points and are not rewritten by another user's private navigation. Actual payloads, immutable before/after renders and manual Live Discord acceptance steps are in [UI evidence](alpha10-stabilization-ui.md).

Billing claims a lease without marking an external write. Every provider mutation commits a token-fenced phase marker immediately before sending. Valid pending claims block competing keys. Customer, coupon, Checkout, Portal and subscription phases retain durable evidence after process death; later failure cannot erase earlier provider changes. Saved financial authority plus fresh OAuth identity permits departed payers to reach `/billing/payments`, open their own Portal and cancel, without granting Guild analysis/settings access. `/billing/manage` retains current-Guild plan changes. Both routes revalidate at delayed external boundaries and result return. New Owners cannot acquire old Customers.

Provisional release requires exact expired/unpaid Checkout identity and complete authoritative empty financial censuses. Provider errors and incomplete pages preserve the fence. Any issued, pending or unknown Portal prevents automatic release; Portal creation is fenced while the abandonment decision runs. Release archives encrypted bindings and authority history; subsequent purchase uses a fresh Customer. Customers are never deleted or reassigned. Detailed security investigation, process-death tests and internal unknown-stage repair are in [billing evidence](alpha10-stabilization-billing.md).

## Migration and upgrade

Apply the existing migration runner sequentially. Published migrations through 046 are unchanged. New migrations are:

| Migration | Purpose |
|---|---|
| 047 | Typed deletion/permission state and separate minimal location-post observations |
| 048 | Durable billing mutation phases, financial authority lifecycle and archived bindings |
| 049 | Analysis metadata, cursor/admission state, compatible new kinds and earmarked bug correction |
| 050 | Historical population provenance, durable collector introduction and prior collection-epoch closure |

For this collector upgrade, stop the old Gateway and Worker processes, apply migrations, then start the new runtime. Mixed old/new collector processes are outside this upgrade procedure. Migration 050 closes existing Gateway epochs; collection resumes in a new epoch so the migration-to-login interval is not reported as fully collected. Pre-upgrade replay retains metadata without restoring an epoch before collector introduction. Member deletion preserves the introduction marker; server deletion clears it under the privacy fence.

Existing balances, reservations, ledgers and immutable results are not reset. Old definitions cannot compare with the corrected definition. Migration 049 conservatively flags v1 results whose Guild has categorized activity channels as `POSSIBLE_CATEGORY_PARENT`; this identifies possible impact, not a proven wrong value. History can preview a correction of the same kind and exact original period. A `BUG_CORRECTION` grant is tied to the original run, is excluded from monthly availability and cannot fund ordinary analysis. Completion can consume that grant once; cancellation/failure releases it for retry. The corrected result records the original run and `CATEGORY_PARENT_RESOLUTION` reason. Old results remain intact. Data discarded by old Bot/newcomer ingestion cannot be reconstructed.

For saved settings, open the paged setup review to inspect current explicit IDs and missing places before saving. Old actor-bound custom IDs remain readable until expiry; expired/changed previews offer the latest private screen. Refresh existing installed panel messages through their saved message/location and Outbox record as needed. Do not bulk-create panels or rewrite all saved scopes to a new meaning.

No source files are deleted or moved. Personal payment management receives a separate route while current-Guild management remains available. Generated Next.js declaration path changes are excluded from the patch.

## Reproduction and final gates

Local runtime is genuine Node 24.19.0, Corepack 0.36.0, pinned pnpm 11.19.0, embedded PostgreSQL 18.4 and isolated local Redis. Commands use the workspace runtime PATH and `REDIS_BINARY=/opt/homebrew/bin/redis-server` for local integration/performance. CI uses PostgreSQL 18/Redis 8 Docker containers and Node 24; Windows runtime runs on `windows-latest`.

The first published candidate `97a9264f6aa0a92527bc334c8c12d2609b338d6e` passed the following local gates and both Linux/Windows workflows. These are checkpoint results. The subsequent historical-coverage correction receives focused local verification and a new complete final-SHA CI run; only that later run determines the final decision recorded in the PR and handoff.

| Command | Outcome |
|---|---|
| `corepack pnpm install --frozen-lockfile` | PASS, pnpm 11.19.0 |
| `corepack pnpm check:secrets` | PASS |
| `corepack pnpm lint` | PASS |
| `corepack pnpm typecheck` | PASS |
| `corepack pnpm test` | PASS, 44 files / 476 tests |
| `corepack pnpm build` | PASS, 20 / 20 tasks |
| `corepack pnpm test:integration` | PASS, 30 files / 388 tests |
| `corepack pnpm exec playwright test` after build | PASS, 28 tests |
| Playwright `playwright.verification.config.ts` | PASS, 11 tests |
| Playwright `playwright.checkout.config.ts` | PASS, 2 tests |
| Playwright `playwright.discord.config.ts` | PASS, 132 payload cases / 264 desktop-mobile render checks in one browser test |
| `corepack pnpm test:performance` | PASS, 5 files / 6 tests |
| `git diff --check` | PASS |
| Windows `corepack pnpm test:runtime` | PASS in both checkpoint CI runs; unavailable on the macOS host. Exact final-SHA outcome is in the PR/final handoff. |

These counts come from the recorded checkpoint runs, not the previous alpha.10 total. The final GitHub push and pull-request workflows run the required Linux and Windows gates, including the actual Discord payload rendering test; final success requires identifying their actual tested candidate SHA. CLI Git lacked authentication, so publication uses the existing authenticated GitHub connection to create identical blob/tree objects and purpose-specific commits, then a new follow-up branch at the resulting descendant of refreshed master. The fetched final commit tree is verified against the staged local tree before advancing the local branch; no force update is used.

After the final historical-coverage and exclusive-reply-end fixes, local unit verification passes 44 files / 478 tests and full integration passes 31 files / 400 tests. The new population suite contains 11 regressions; the complete focused population/stabilization run passes 25 tests. Lint, typecheck and secret scan pass. The final performance rerun passes all five files / six tests; its raw artifact and measurements below are updated from that run. The updated actual-payload browser test passes 138 cases / 276 desktop-mobile checks, and all 40 selected payload/image SHA256 hashes verify. Earlier failed fixed-date fixtures now explicitly declare their synthetic collector activation; all original assertions remain. The independent coverage review passes 38 focused tests and separately reproduces and verifies the one-second startup gap.

Failing-first evidence includes category/parent attribution, stale confirmation caused by unrelated revision updates, free correction missing at zero balance, lease expiry during asynchronous authorization and independent Billing bypass reproductions. Added tests cover exact UTC preview windows, irrelevant versus corrected source reuse, precise history cursors, compatible comparison beyond 25 newer incompatible results, privacy invalidation, multi-instance admission, queued cancellation/expiry, representative servers, recursive payload constraints and process termination at provider boundaries. Existing assertions were retained; legacy synthetic fixtures were enriched with explicit observed structure and confirmed purposes rather than restoring unknown-as-text fallback. No tests are skipped to pass the candidate.

An intermediate combined run exposed macOS orphan PostgreSQL SysV resources and initialization failure. Only unattached resources with verified dead test creator processes were cleaned; the final suites run with isolated fixture lifecycles. An unbounded 50-concurrent-write local contention probe exceeded the existing ten-connection/500 ms pool limit while other suites ran. The repeatable probe measures ten concurrent writes in five batches, retaining 50 total writes and the unchanged pool timeout. This is a measured local limit, not a claim of production capacity.

The next published checkpoint `38130bc9fac42b2ed82502db84f182b2e5b6dc1e` passed all 400 integration cases in PR CI, while push CI failed the existing API quota test with 52 successful authentications instead of 60. Independent reproduction identified pool acquisition rather than quota rejection: 62 simultaneous authentications normally produce 60 successes and two `API_RATE_LIMIT` errors, but adding 12 ms of database work under the shared credential row lock produces 42 successes and 20 connection-acquisition timeouts, with the quota counter still 42. The repaired test keeps every one of the 62 attempts and the exact 60/2 assertions. It fills 58 permits in batches within the unchanged ten-connection pool, then races four requests for the final two permits, verifies both rejection reasons and the minute/month counters of 60. Production limits and the 500 ms pool deadline are unchanged. Final success requires the new commit's complete CI, rather than treating either checkpoint as final.

Checkpoint `3a5e1aa9f2ab23ddd8b09baf5f5d160a904e2526` passed all required gates in PR CI, but push CI exposed a PostgreSQL `40P01` deadlock in the performance probe. Each of ten concurrent probe writers updated the same seven post rows, and the database diagnostic identified a cycle while rechecking an updated tuple in `message_observations`. This is evidence of a limitation for overlapping multirow updates, not a successful measurement of isolated revision-row contention. The revised probe seeds ten separate posts after the main analysis/network measurements, updates one distinct post per writer in five batches of ten, and requires every statement to return its one updated row, every post to increase by five, 50 successful statements and an exact shared revision increase of 50. Production triggers, ten-way concurrency and the 500 ms pool acquisition deadline remain unchanged. The normal direct-reply projection targets one lifecycle fact/post; bulk overlapping updates are not claimed safe by this probe. CI measurement metadata now identifies GitHub Actions and Docker Redis explicitly.

## Performance and acceptance limits

[Active aggregate test](../tests/performance/analysis-active.test.ts) performs four actual production aggregate calculations against 80,000 location posts, three SQL passes per run, while ten signed HTTP interactions traverse real loopback networking and actual interaction/action workers. It records network ACK, injection ping separately, private screen completion through a fake Discord adapter, queue wait, run duration, pool acquisition, Node CPU/RSS, PostgreSQL connections/cache/read statistics and ten Billing reads interleaved with the interactions. Database samples show up to four active aggregate queries; all ten requests were sent while calculations were active. The final performance suite ran after the other test suites finished. [Raw local measurements](alpha10-performance-local.json) preserve all samples and runtime details.

| Measurement | Local result |
|---|---|
| Signed real HTTP initial ACK | maximum 9.78 ms; median 2.59 ms |
| Private screen delivery through Fake Discord | maximum 69.00 ms; median 14.05 ms |
| Injection ping, separately measured | 3.03 ms |
| Queue wait | 181 ms for each run |
| Actual aggregate execution | 200.65–210.51 ms |
| DB pool acquisition | maximum 0.145 ms |
| Billing view | maximum 7.874 ms |
| Node RSS / CPU over the measured interval | 252.1 MiB; 167,080 user + 22,949 system microseconds |
| PostgreSQL workload statistics | 10 connections, 191,975 cache hits, 508 blocks read |
| Existing global revision trigger contention | ten separate post rows, five batches of ten writers; 50 successful statements and revision delta 50; maximum 31.68 ms, median 0.449 ms |

The three aggregate passes amplify real query work for this small synthetic stress test; a production run normally performs one calculation. PostgreSQL read/cache statistics are cumulative counters for the fixture database and include setup and the separate revision probe; they are not aggregate-only deltas or a production utilization percentage. PostgreSQL backend CPU and a long-running Hosted steady state were not measured. The existing synthetic waiting-job ACK test is retained and is separate from this active-query evidence.

The verified development machine is Apple M5, ten CPUs and 32 GB RAM. This is an observed configuration, not a minimum or a guarantee for hundreds of servers. Hosted sizing requires a separately authorized trial with production-like network and provider behavior. ACK meets a different objective from completed screen delivery. A fake Discord delivery timing does not measure the Discord network.

Representative S1–S8 fixtures contain fictitious IDs and metadata only. They check scoped basic counts, independently filtered detailed kinds, exact purpose-qualified Attention sets, S7 permission/private-thread exclusion and S8 stable-ID changes. Additional adaptive regressions cover event/voice/poll/tag semantics. Their contracts and limitations are documented in [scope evidence](alpha10-stabilization-scope.md).

| Decision at local source freeze | Status |
|---|---|
| Code correction | CONDITIONAL GO pending final-SHA Linux/Windows CI; final outcome is recorded in the PR/final handoff |
| Representative server adaptation | PASS within the S1–S8 fixture and regression coverage |
| Native Discord screen acceptance | NOT RUN |
| Existing financial P1s | FIXED in code, backed by process-death tests, provider-fixture races and fresh independent re-review |
| Purchase packs | DISABLED |
| Stripe Live | DISABLED |
| Hosted Beta launch | NO-GO until authorized native Discord and Hosted acceptance are performed |

Live Discord acceptance, Hosted acceptance and a real Stripe Sandbox card payment are **NOT RUN**. Local provider fixtures and rendered payload screenshots cannot substitute for these trials. The fresh billing review closed its Portal/abandonment race, alternate management authorization and lost plan-change UI findings; its independent 18-case suite passed. The fresh analysis review closed its saved-target access, guest-deletion publication, purpose-only configuration and linked-organization admission findings. No concrete P1 remains open in those bounded reviews; this is not an exhaustive repository security audit. Billing work followed the `codex-security:fix-finding` workflow with independent candidate investigation and regression verification, plus the installed Stripe documentation/best-practice skills and actual documented tooling.
