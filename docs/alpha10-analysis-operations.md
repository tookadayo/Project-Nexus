# alpha.10 analysis operations — implementation record

Base: `5638fe34a9169c95b6fb138222bcd4a84d8ee97d` (`origin/master`, fetched 2026-10-08). Original checkout `20b23fe72104a9e7f8d183c21909513c46cbd8ff` has the same tree. Branch: `codex/alpha10-analysis-operations`.

## Pre-implementation map

- Discord gateway/webhook enter `apps/interaction/src/server.ts`; acknowledgement/defer precedes durable `interaction_jobs`, with bounded modal deadlines. PostgreSQL persists signed component intents; `Components` binds tenant and optional actor, not permissions.
- `InteractionWorker` drains durable interaction jobs in `nexus-work`. Domain renderers live in `discord-panels`. `ServerAuthorization` obtains fresh Discord membership; `operationsAccess` applies NEXUS roles/tombstones, Discord fallback and entitlement policy.
- `analytics`, typed PostgreSQL rollups, `message_observations`, collection epochs and `MetricEvidence` calculate aggregate observations; `operations` owns Attention, auditing, revision and delivery fences.
- `scripts/dev.ts` owns BullMQ/Redis runtime and recovery. PostgreSQL is authoritative; Redis wakes work.
- `BillingOperations`, trusted immutable `billing_offerings`, the official Stripe SDK and signed provider signals implement commerce. Subscription projection and success redirects do not directly grant paid access.

Reuse: transports, durable interactions, signed components, authorization, plan registry, typed observations, evidence semantics, Attention and telemetry. Extend: panel/modal primitives, plan usage limits, database migration registry, worker runtime and privacy cleanup. Create: a small analysis orchestration package, aggregate calculator and dedicated `nexus-analysis` dispatcher/worker. No analytics rewrite or second payment architecture.

The Home integration depends on trusted analysis usage/history. The domain is therefore connected before the final Home rendering change; this is the only milestone ordering adjustment.

## Baseline (before implementation)

Node 24.19.0 / pnpm 11.19.0, macOS arm64. `corepack pnpm install --frozen-lockfile`: exit 0.

- `corepack pnpm check:secrets`: exit 0.
- `corepack pnpm lint`: exit 0.
- `corepack pnpm typecheck`: exit 0.
- `corepack pnpm test`: exit 0.
- `corepack pnpm build`: exit 0.
- `corepack pnpm test:integration`: exit 1.
- `corepack pnpm test:performance`: exit 0.
- `corepack pnpm test:e2e`: exit 0.
- `corepack pnpm exec playwright test --config playwright.verification.config.ts`: exit 0.
- `corepack pnpm exec playwright test --config playwright.checkout.config.ts`: exit 0.
- `corepack pnpm test:runtime`: exit 1.

Unit: 431 passed. Integration: 293 passed, 2 failed. Performance: 4 passed. General E2E: 28 passed. Verification E2E: 11 passed. Checkout E2E: 1 passed. Build: 19 workspaces. Windows runtime cannot execute locally (`powershell.exe` absent); the Windows CI job remains required.

Baseline integration failures: `alpha3-polish.test.ts` strong reply/voice tests place a supposed "today" join one hour before wall time. During the first UTC hour the join is yesterday. The fixture is corrected to keep its declared today premise; assertions and production timezone semantics remain intact.

## alpha.9 billing correctness review

A: confirmed in code: `BillingAuthorization.authorize` always calls the member-bound `ServerAuthorization.snapshot`; a departed Primary Principal cannot reach Portal/cancellation. OAuth-only financial recovery is not implemented. This remains a blocker for additional purchasable commerce; no pack Checkout is enabled in alpha.10.

B: resolved for current Stripe invocation classification: read-only/preflight errors are definitive, and `BillingOperations.fail` clears `external_started_at`. Errors after a potentially accepted write retain reconciliation fences. Existing provider and owner-checkout regressions cover this boundary; no historical patch is reapplied.

C: confirmed: `abandonCheckout` expires a session and invalidates its cached result, but retains the provisional Principal/customer binding. A safe cleanup needs an authoritative provider census and must not hand a historical Customer to a new Owner. Pack sales remain disabled pending that financial lifecycle repair. Unknown expiry continues to fence new operations.

## Commercial scope

Approved included usage: Free 1, Starter 3, Growth 5, Scale 10 per UTC calendar month. Enterprise requires individually provisioned grants. No public pack prices or Price IDs are created. Live billing remains disabled. Pack domain/catalog support is fail closed; Sandbox pack purchasing is deferred while billing and lifecycle gates remain unresolved.

## Discord experience and copy

Basic analytics, observed counts, the existing charts and plan-appropriate history remain available independently of detailed-analysis usage. The approved 1/3/5/10 allowances apply only to an explicitly confirmed **詳しい分析 / Detailed analysis** run. Opening Home, reading a chart, viewing a preview/result or comparing saved results never reserves a use.

Home has five main actions: Attention, basic analysis, new participants, settings and more. Section accessories keep related text and action together. Settings groups places, notifications, team and goals; connection and privacy remain accessible, while runtime diagnostics are under permission-checked support information. Existing slash-command names remain registered; `/nexus overview` returns the new Home and chart aliases retain existing basic analytics. Results/experimental configuration remains an explicit advanced choice.

The four-step setup draft is actor-bound and expires after 15 minutes. It supports back, optional skip and a final review. No settings write occurs before confirmation. Skipping preserves stored configuration; stale drafts cannot replace newer settings. Current channel/role validity is checked at confirmation, and existing entitlement validation applies.

Notification, promotion, question and intake text inputs use shared Label-based modal primitives. The interaction server remains the acknowledgement/controller boundary; modal builders and page renderers live outside it. The shared components enforce recursive count <=40, custom IDs <=100, bounded mobile labels and at most one Primary button per action row. Thumbnail support exists as an optional primitive; the ordinary workflow has no decorative image requirement.

Japanese labels use concrete terms such as 要確認, 詳しく分析する, 分析する場所 and 接続. `i18n/analysis.ts` and `i18n/components.ts` centralize new copy. Missing observations are words, not measured zeros. English carries the same conditions. Tests check actual payloads and localized strings; support-only technical labels have explicit boundaries. Playwright renders the real payloads at 700px and 375px, including Section accessories and all new setup steps. This is a layout approximation, not live Discord acceptance.

## Analysis lifecycle and authoritative usage

1. A fresh Discord member snapshot and centralized READ policy admit menu/preview. Availability derives from current purpose, channel observability, plan history, collection health and eligible metadata.
2. Preview shows the exact completed UTC-day window, configured places, data quality, expected duration as an estimate, remaining uses and duplicate state. Periods are bounded to 7/30/90 days. Latency percentile calculation occurs in the analysis worker; preview checks its sample and coverage without calculating it.
3. Confirmation requires ANALYZE. In a PostgreSQL transaction, a scoped advisory lock protects request-key reuse, trusted preview revision/fingerprint, run creation and one grant reservation. A changed preview requires review again. Redis is outside this transaction.
4. The independent dispatcher reads committed QUEUED rows. BullMQ carries only `analysisRunId`; it does not own balances or authorization. Enqueue failure preserves the run and reservation for recovery.
5. A worker claims a fenced PostgreSQL lease, rechecks current membership/RBAC and calculates bounded SQL aggregates in a repeatable-read snapshot. It renews the 120-second lease every 30 seconds. No interaction token waits for completion.
6. Publication uses a fresh short transaction, checks current authorization/configuration/recipe and the unexpired lease, then inserts one immutable result, consumes one reservation, records one ledger outcome and completes the run atomically.
7. Transient failures retry at most three claims with a short backoff. A terminal failure releases the reservation. Expired grants keep their original expiry; release does not extend a monthly entitlement. Result-persistence/finalization failure rolls back the entire publication transaction. An expired or replaced worker cannot publish.
8. History, refresh, evidence, compatible comparison and conversion to Attention are separate reads/actions. The existing Attention table, lifecycle and revision fences own operational concerns; no second task system exists.

Input identity includes tenant, guild, type, period, configured places/model, recipe, settings revision, projection revision and quality attribution. Completed or active matching runs are reused before reserving another use. An explicit rerun is a new confirmation and use. Each changed projection statement bumps the affected tenant revision once, including bulk rebuilds; statement transition tables avoid quadratic updates to a single revision row.

Included grants are created lazily for the current UTC calendar month and expire at the next UTC month. Mid-month upgrades increase that month's existing grant to the new allowance, rather than adding an entire second allowance. A downgrade preserves already granted quantities and stored configuration; the next month follows the effective plan. Enterprise has no invented recurring amount and uses an internal, audited, idempotent contract grant. Manual grants require the existing internal billing actor, never a Discord button or Administrator bit. All grant counters have database bounds and cannot go negative.

## Calculation, data quality and privacy

The initial choices are server overview, new participants, configured support, events and voice. Support needs administrator-confirmed SUPPORT_QA and mapped places; voice/events need the corresponding purpose. Aggregate metadata measures eligible observed joins, posts, posts with an observed direct reply, median first-reply time, mature posts without an observed reply, qualified voice co-presence, event signup and observable attendance. It does not infer what a message means, whether a question was answered, whether people conversed or whether a signup attended. Guild-wide event signups have no invented channel attribution.

Message and participant queries exclude known configured staff, pending screening, guests and unproved eligibility. Voice/event aggregates apply the same eligibility and staff conditions. Public thread/forum metadata follows the known parent mapping; private threads are excluded. Missing role classification, old reply semantics, changed recipes, late collection, permission gaps and safety context remain incomplete or unavailable. Unknown data is never fabricated from historical default fields. The latency median needs five observed replies.

Each metric stores a MetricEvidence definition, collection window, sample, sources, coverage, reasons and comparison blockers. Results distinguish COMPLETE, PARTIAL, NO_DATA, NOT_APPLICABLE and INSUFFICIENT_SAMPLE. NO_DATA cannot consume usage as a successful result. The UI translates these states and evidence reasons, without internal hashes/SQL/provider references. Comparison requires the same type, recipe, configured places and period length, non-overlapping windows and compatible complete metric evidence. A change is descriptive, never causal.

No AI provider, content/poll labels/DM/presence/voice audio, individual score, least-engaged leaderboard, staff ranking or cross-server member profile is added. Results contain aggregates only. Requester routing uses the existing tenant-sealed identity; member deletion scrubs requester/grant provenance and deletes that member's setup drafts. Guild deletion removes analysis runs/results/grants/reservations/ledger/revisions/drafts under the existing privacy fence.

Result retention at acceptance is bounded by configured anonymous aggregate retention and the accepting plan's history. Current plan history controls visibility, so downgrade can hide older results without immediately deleting them. The existing purge scanner deletes expired result payloads and setup drafts; usage ledger/run provenance remains until guild deletion. This is an operational accounting record, not an unlimited result archive or legal financial-retention promise. Purchased-result retention remains a product decision before pack sales are enabled.

## Queue fairness, recovery and observation

`nexus-analysis` is a dedicated BullMQ OSS queue with four worker slots. Its explicit priorities are Scale/Enterprise 100, Growth 300, Starter 500, pack-only Free 600 and Free 900. Every minute of waiting improves priority by 100, bounded at 100. Aged work ties with Scale and retains FIFO order; unchanged priority is not rewritten, preventing continuous dispatcher ticks from moving it behind newer jobs.

A guild admits one active heavy run. Organization allowance is 1/1/2/4/4 for Free/Starter/Growth/Scale/Enterprise and is resolved from the current explicit organization link/root plan. PostgreSQL advisory locks and counts enforce the allowance independently of Redis duplicates or worker count. The recovery batch interleaves organizations/guilds before limiting to 100, and busy claims are rescheduled. Other organizations can progress.

The one-second maintenance loop is independent of interaction polling. It reclaims expired leases, releases expired abandoned requests, recreates missing Redis jobs, removes terminal transport jobs and adjusts aging priority. Failure to write PostgreSQL leaves the lease/reservation recoverable; reconnect does not grant a new reservation. Publication never spans the heartbeat's repeatable-read snapshot.

OpenTelemetry records all eleven requested lifecycle events, queue waiting/active/prioritized counts, oldest waiting age, run duration, queue delay and one-day failure rate. Committed reservation/consume/release events are recorded after commit, so rollback does not falsely report consumed usage. Metrics contain bounded categories, with no tenant/member IDs or raw payloads. Existing redacted diagnostics handle operational failure logs.

## Migration and deployment

`046_analysis_operations.sql` is the next migration after inspected master migration 045. It creates analysis runs, results, grants, reservations, usage ledger, input revisions and setup drafts. Composite tenant foreign keys, unique run/request/reservation/ledger identities, immutable results/ledger, source identity, nonnegative grant counters, state/period bounds, <=64KiB result JSON and recovery/history/fingerprint indexes enforce correctness. Pack purchase source identities are globally unique. The existing Offering catalog gains a product discriminator and 1/3/5 quantity constraint; a pack row cannot be enabled. Subscription Offering lookup explicitly excludes packs.

Capability catalog revision 4 adds usage/concurrency limits by copying immutable revision 3 benefits and merging the new limits. Purchased commercial Offering revisions stay unchanged. No historical migration is edited, and historical data does not receive invented analysis results.

Apply the additive migration before starting the alpha.10 worker. Stop/drain new analysis workers before reverting application code; old code can ignore the added tables and catalog columns. Do not drop new durable rows as a rollback shortcut. Restore PostgreSQL with its run/reservation/ledger records together; a restarted dispatcher rebuilds Redis. PostgreSQL remains the authoritative backup. Live provider configuration and launch gates are unchanged.

## Architectural decisions

| Decision | Chosen approach and reason | Rejected alternative |
| --- | --- | --- |
| Basic versus detailed | Existing basic metrics stay usable; only confirmed detailed runs reserve usage | Charging every chart/page read |
| Durable state | PostgreSQL run/reservation/result/ledger in scoped transactions | Redis/job state owning usage |
| Worker snapshot | Repeatable-read calculation, short fenced publication, independent heartbeat | Holding one mutable run row in a long snapshot and losing renewed leases |
| Queue | Existing BullMQ OSS with a separate queue and shared priority policy | A second broker or priority-zero default |
| Fairness | Bounded aging, unchanged FIFO, root-org and guild DB admission | Paid priority with unbounded starvation |
| Calculation | Existing typed projections/evidence and bounded aggregate SQL | Content/AI interpretation or loading all raw history into memory |
| Permission | One operations policy for NEXUS roles, revocation tombstones and existing Discord fallback | Local panel-specific RBAC helpers |
| Commerce | Existing Offering discriminator, disabled packs, internal contract grants | Another Stripe integration or invented prices |
| Setup | Actor-bound draft plus final optimistic revision check | Saving each wizard step or clearing skipped configuration |
| Retention | Existing history visibility and configured aggregate bounds | Unlimited result retention or destructive downgrade |

## Remaining release limitations

- P1 financial: departed billing Principal recovery (A) and authoritative cleanup of abandoned provisional ownership/customer (C) remain unresolved in alpha.9 billing. They block additional purchasable commerce and Hosted Beta. No analysis pack purchase route, payment webhook grant or public price is enabled.
- P2 operational: live Discord client acceptance, hosted capacity/outage drills, alert deployment and real privileged-intent permissions remain external acceptance work. Automated Components V2 layout screenshots do not replace these checks.
- Future: detailed Web analysis charts/history, richer deterministic recipes, approved pack pricing/refunds/disputes and purchased-result retention policy. Existing Web basic exploration remains available. No AI readiness is claimed.
- Stripe Live and Hosted Beta remain NO-GO. Sandbox pack sales remain NO-GO. Alpha.10 development requires local checks plus both jobs of NEXUS CI at the exact resulting SHA; the task report records that immutable SHA and run URL.

## Final critical review

The new Home reduces ordinary choices and keeps basic analysis accessible. Detailed work has an explicit preview/usage boundary. PostgreSQL constraints and transaction/lease fences prove single reservation/result/consumption and safe release. Isolated dispatch/processing preserves Discord acknowledgement. Bounded aging and DB admission prevent a guild/root organization from occupying every slot. Shared authorization denies cross-tenant IDs and revoked-role fallback. Inputs are signed and scope-bound; client counts/IDs/options never grant permission or usage. Aggregates retain data-quality evidence and add no content inference or personal ranking. No live billing flag, credential, Price or public sale is changed; a success redirect grants nothing.

Validation includes negative authorization, tenant/actor-bound components, malformed periods/options, final-use races, duplicate requests/workers, lease recovery/renewal, result/finalization rollback, Redis enqueue failure/loss/reconnect, aging/FIFO, guild/organization allowance, recipe/config changes, privacy/downgrade and signed acknowledgement under analysis load. Exact commands, counts and exact-SHA CI conclusions are recorded in the final task implementation report. Any failed required check keeps the development decision NO-GO until repaired and rerun.

## Local release validation (2026-10-08)

The baseline integration failures were repaired at the fixture boundary. Initial
alpha.10 verification found exact migration-count expectations, old Home/setup
selectors, immutable catalog revision seeding, a bulk revision-trigger slowdown
a renamed Japanese navigation label and ACK-fixture teardown racing deferred persistence. Each failure was inspected and rerun:
no tests were removed/skipped, assertions weakened or timeouts increased. The ACK fixture now waits for all ten post-commit wakes before closing its pool, additionally proving durable acceptance.
Catalog revision 4 avoids changing historical commercial revisions. Statement
transition-table triggers remove the bulk-update performance regression.

| Command | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Exit 0, 21 workspace projects |
| `corepack pnpm check:secrets` | Exit 0 |
| `corepack pnpm lint` | Exit 0 |
| `corepack pnpm typecheck` | Exit 0 |
| `corepack pnpm test` | Exit 0, 440 tests |
| `corepack pnpm build` | Exit 0, 20 build tasks |
| `corepack pnpm test:integration` | Exit 0, 335 tests, including 40 analysis/recovery/security tests |
| `corepack pnpm test:performance` | Exit 0, 5 tests |
| `corepack pnpm test:e2e` | Exit 0, 28 tests |
| `corepack pnpm exec playwright test --config playwright.verification.config.ts` | Exit 0, 11 tests |
| `corepack pnpm exec playwright test --config playwright.checkout.config.ts` | Exit 0, 1 test |
| `corepack pnpm test:runtime` | Exit 1 locally: macOS lacks powershell.exe; Windows CI is required |

The analysis regressions specifically include bulk-correction dedupe invalidation,
recipe changes during calculation, Growth/Scale concurrent organization limits
and a 120-request burst after organization relinking. The ACK fixture starts
four real BullMQ analysis jobs holding calculation connections, sends ten signed
HTTP interactions and enforces the unchanged Discord three-second deadline.
The final task report identifies the resulting exact SHA, NEXUS CI push run,
verify/windows-runtime conclusions and measured performance. This document does
not claim a CI result for a different or uncommitted tree.
