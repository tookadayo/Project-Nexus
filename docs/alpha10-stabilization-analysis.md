# alpha.10 analysis stabilization design

Design recorded before implementation, 2026-10-08 (Asia/Tokyo).

- Start/local/PR #4 HEAD: `71a27f937e8dd534c40c767033d91a492cdce44c`.
- Fetched master/base: `5638fe34a9169c95b6fb138222bcd4a84d8ee97d`.
- PR #4 is open, draft, unmerged; continue `codex/alpha10-analysis-operations`.
- Reuse PostgreSQL grants, reservations, immutable results/ledger, BullMQ `nexus-analysis`, authorization, privacy locks, and the existing analysis kinds.
- Fix confirmation identity, fixed preview windows, result reuse, history pagination, comparison lookup, queued cancellation, bounded intake/wait, and calculation metadata. The shared channel resolver is owned by the scope change, not duplicated here.
- Confirmation describes tenant, kind, fixed period, selected places/purposes, definition, meaningful settings, and one reserved use. Data state has a separate scoped checksum; unrelated activity and language changes do not require confirmation or invalidate saved results.
- Saved results keep definition, configured scope, actual target IDs, data identity, and aggregation timestamp. Replies are measured as observed at the period end; later replies must not rewrite that historical state.
- History uses a server-managed opaque cursor bound to tenant, actor and filters, ordered by requested time and ID. Comparisons filter compatible completed candidates in SQL, without a latest-25 cap.
- Migration 049 adds confirmation/data metadata and cursor storage, leaving published migration 046 and all balances/ledger entries intact. Old results remain immutable and their earlier definition prevents comparison with corrected definitions.
- Migration 050 records location collector introduction and legacy population provenance separately from reply-definition versions. Historical totals are observed lower bounds and unsupported zeros are unknown, including periods with no rows. Recipe v3 prevents earlier v2 completeness claims from serving as comparison baselines. The marker participates in scoped data identity.
- Conflicts: old tests requiring language-only revision to invalidate confirmation must be updated to check meaningful changes instead. Legacy direct service calls without preview remain compatible, but Discord/Web confirmation must send the frozen window.
- Unchanged: UTC monthly guild allowances (1/3/5/10/custom), Scale organization licenses/concurrency, disabled packs, Stripe live disabled, and no automatic publication or PR merge.

Official specifications reviewed 2026-10-08: [BullMQ priorities](https://docs.bullmq.io/guide/jobs/prioritized) (explicit nonzero priorities; lower numbers first; FIFO ties) and [rate limits](https://docs.bullmq.io/guide/rate-limiting) (worker limits are queue-wide, not tenant fairness). Installed manifest uses BullMQ 6.3.8. Retain database admission/concurrency and oldest-first aging rather than treating queue priority as a capacity guarantee.

Verification will distinguish injection ACK latency, real HTTP ACK latency, asynchronous screen-update completion, actual concurrent aggregate SQL, queue delay, pool acquisition, CPU/RSS and PostgreSQL statistics. Local evidence cannot establish a Hosted capacity guarantee. Live Discord acceptance and live payments are not run unless an authorized test environment is available.
