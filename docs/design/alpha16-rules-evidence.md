# alpha16 N16-08 / N16-09 implementation evidence

Status: implementation and test code prepared; **tests, typecheck, lint, build and DB execution have not been run in this task**. This is not a G4/G5/G6 completion report. No migration was applied, no deployment/configuration was changed and no Discord request was made.

Latest retention selection: `alpha16-spec-deltas.md` / `retention-contract.ts` now fix new Fact/evaluation/source-health/evidence live snapshots to at most 48h from creation/sealing, minimum Suggestion/history/audit/suppression/receipt to 14d under their own anchors, Run terminal state to 7d and backup to 7d. Original earlier source expiry wins and reads/retries/copies do not extend it. These declarations do not activate an operational policy or delete existing source/long-term aggregate data. Source/threshold/minN/freshness/cooldown/budget candidates remain separately gated.

## Baseline and ownership

- Same existing checkout: `D:\Project Nexus`, branch `codex/alpha15-web-blocks`, entry HEAD `35b0d22398c1463e2c88d7f49d960fa8a065002a`.
- The original 37 files under `alpha16-source/` are unchanged. Contract order used: README, migration plan, contract decisions, decision gate, design index; II0, IIA–IIE, IV0, VA, VB, VI; IC2 and IC4. The latest integrated corrections supersede individual examples, including first accepted enqueue sealing, DATA self-suppression, initial REVIEW_ONLY and partial COMM priority.
- No applicable root/packages AGENTS file was found. `apps/web/AGENTS.md` is outside these owned edits. `.agents/skills` was absent at the current path.
- Owned implementation: `packages/rules/src/{facts,rule-catalog,rule-config,rule-engine,source-adapters,fact-storage}.ts`; fact/health sections of migration 060; the fixture/unit/integration test files listed below. Domain/API/worker/authorization/publication/privacy wiring belongs to the parent task.
- `apps/web/next-env.d.ts` is not modified by this task. Its existing protected change is not part of this implementation.

## Interfaces supplied to integration

`sealRuleInput(RuleInput): SealedRuleInput` is pure and takes no current clock. The server must call it inside the first accepted enqueue transaction, after authorization and deletion checks. It binds guild, six-digit UTC evaluationAsOf, immutable Fact IDs/source revisions, immutable health ID/revisions, period/window, declared target set, requested rules, and engine/config/catalog/schema/branch/action/explanation/rule versions. Retry/resume/reclaim reloads these exact references and verifies the same hash; it does not select newer observations.

`evaluateRules(sealed, config, control?)` returns COMPLETED / DISABLED / INCOMPLETE, publishable, reasonCodes, ordered RuleResults, and bounded steps. Only the fixed registry and handlers execute. The optional clock is for the evaluator deadline, never the business observation/asOf. Cancellation, tombstone, budget/deadline, hash/version/registry or required target failure cannot produce publishable output. FIXTURE output always has publishable=false.

Each RuleResult preserves target/liveVersion, decision, reason codes, priority, issue/domain, evidence/health references, exact evaluation/window, REVIEW_ONLY action and lineage. Only a sufficient NO_FIRE can establish resolution. Missing, stale, suppressed, insufficient N, zero denominator, disabled source and unknown outcomes remain distinct. COMM additionally carries declared/evaluated/eligible slots and typed per-domain issue references; it does not copy Fact values or raw content into explanation/history.

Storage exports:

```text
persistRuleFacts(tx, scope, facts, sourceHealth, capturedAt,
                 {fact: policyExpiry, sourceHealth: policyExpiry}) -> void
expandRuleInputRefs(tx, scope, [{kind,id,revision}])
  -> {facts: FactRef[], sourceHealth: SourceHealthRef[], expiresAt}
loadRuleFacts(tx, scope, {facts: FactRef[], sourceHealth: SourceHealthRef[]})
  -> {facts: FactSnapshot[], sourceHealth: SourceHealthObservation[]}
```

The caller owns the authorized scoped transaction and canonical locks. Persistence refuses autocommit, unknown registered metadata, malformed IDs and expired evidence. UUID identities are distinct from component row UUIDs. It never performs network I/O or starts its own transaction.

## Typed facts and canonical form

- Registered metric/source/unit/kind/definition version, bounded structured dimensions, half-open UTC windows and period roles are validated before hashing. Unknown fields/metrics/dimensions, duplicate identities, ambiguous health revisions and unresolved health references are rejected.
- UTC RFC3339 timestamps have exactly six canonical fractional digits. More than six digits, offsets, invalid dates and rounding are rejected. Existing alpha15 Instant parsing is unchanged.
- Decimal strings are exponent-free, normalize leading/trailing zeros and negative zero, and respect numeric(38,18). Comparisons use BigInt rational cross-products before display rounding. Counts also respect PostgreSQL BIGINT. Coverage and threshold boundaries use exact string/rational validation, not Number rounding.
- Object keys follow Unicode code point order. Declared sets, dimensions, observations, Facts and refs have canonical ordering. Changing asOf, source revision, health version, period, window, target or config changes input hash. Supplied arrays are copied and the sealed result is deeply frozen.
- Composite ratios/outcomes/anomalies/permission counts/period states are **pure engine types only**. DB values are INTEGER / DECIMAL / BOOLEAN / ENUM / TIMESTAMP scalar rows, with registered component paths. `rule_fact_groups` holds typed metadata and a content hash; `rule_fact_health_refs` holds the exact health references. There is no free JSON value/payload copy. Dimension JSON is a validated bounded metadata map.
- Original source expiry is retained as typed metadata for exact reconstruction. Effective DB expiry is the minimum of source expiry, policy ceiling, the 48h snapshot ceiling and `observedAt + min(policyExpiry - capturedAt,48h)`. This last bound is deliberately conservative when a source observation predates sealing. Recapturing/reinserting an old observation cannot restart its retention duration. The snapshot uses the earliest group expiry. The publication layer must also use the effective DB expiry returned by expansion.
- Run-derived adapters must provide an original source expiry bounded by the parent Run/source policy. This implementation does not authorize a longer aggregate purpose or retain Run IDs in business Facts.

## Thirteen registered rules

| Rule | Bounded predicate / distinct handling |
|---|---|
| ONB-001 | Mature onboarding AND first-action completion ratio, strict low boundary |
| HELP-001 | SLA-elapsed eligible intakes; unanswered OR structured stalled, inclusive high boundary |
| RET-001 | Previous active cohort continued in current window; strict low boundary |
| ENG-001 | Absolute channel participation low OR relative decline, percentage-point and relative changes kept distinct |
| EVENT-001 | Matched confirmed RSVP cohort attendance, event minimum and percentage-point decline |
| REPORT-001 | Strict overdue generation OR confirmed delivery failure/decline; unknown delivery is not failure; unrelated missing delivery cannot hide known generation overdue |
| AUTO-001 | One terminal Run outcome per Run, confirmed FAILED / (FAILED + SUCCEEDED); unknown share gate; cancelled/unfinished/expired excluded |
| AUTO-002 | Confirmed anomaly union, future waits excluded, strict grace/lease/heartbeat edges; source projection asOf and grace values must equal the sealed evaluation/config |
| PERM-001 | Confirmed DENY / applicable requirement count; unknown is not DENY; missing requirement registry disables |
| EXP-001 | Three completed structured base-issue periods, consecutive recurrence and known absence of active experiment |
| PLAY-001 | Same recurrence plus known absent/disabled explicit playbook mapping |
| DATA-001 | Fresh confirmed health envelope independently warns about never-succeeded, stale business ingest, partial business coverage and missing/stale business Fact; missing health remains unknown |
| COMM-001 | Only nine base rule slots / eight registered domains; deduplicated evidence, partial coverage gate and P1-to-P2 cap without raising P3 |

The fixed DAG is source → nine base rules → EXP/PLAY/COMM. DATA is independent health/business diagnostics. EXP/PLAY/DATA/COMM do not recursively become COMM/base-issue sources. The runtime and Rule evaluator budgets remain separate.

Cooldown configuration preserves source units: ONB/HELP/RET use seven calendar days with explicit IANA zone; ENG/EVENT/REPORT use fourteen days, AUTO-001/PERM/DATA/COMM twenty-four hours, AUTO-002 six hours, EXP/PLAY seven days. The typed unit is carried in each RuleResult; root publication fixes cooldownUntil once from first creation, without extending on reobserve/version/copy. All numeric Rule profiles remain fixture candidates until the separate operational activation gate.

COMM defaults to same-window compatibility and canonical GUILD target. Cross-window fixture examples explicitly use `DECLARED_RULE_WINDOWS_FIXTURE`, which is rejected for OPERATIONAL configurations. No unapproved production cross-window compatibility policy was created. Slots are determined from the sealed requested rules × declared matching target set; missing slots never shrink the denominator. Per-domain display ordering is issue count descending, then the fixed domain order; issue details preserve their own window/target/evidence.

## Existing-source compatibility (G2)

| Source family | Mapping status / boundary |
|---|---|
| ONB | BLOCKED_UNVERIFIED: existing activation/completion alone does not prove mature onboarding plus first-action intersection |
| HELP | BLOCKED_UNVERIFIED: Attention/intake state alone does not prove the exact SLA-elapsed/stalled cohort |
| RET | BLOCKED_UNVERIFIED: D7 joined-cohort retention is not the previous-active-cohort overlap |
| ENG | BLOCKED_UNVERIFIED: newcomer/location counts do not prove the same eligible guild participant denominator |
| EVENT | BLOCKED_UNVERIFIED: separate signup/attendance totals do not prove matched confirmed RSVP conversion |
| REPORT | EXPLICIT_PROJECTION_REQUIRED: generation due and confirmed delivery branches remain separate, UNKNOWN retained |
| AUTO-001 | EXPLICIT_PROJECTION_REQUIRED: explicit COMPLETED→SUCCEEDED mapping, one Run rather than one attempt; no retention extension |
| AUTO-002 | BLOCKED_UNVERIFIED: authoritative due/deadline/lease/heartbeat projection has not been mapped; must be computed for first accepted enqueue asOf and matching grace config |
| PERM | BLOCKED_UNVERIFIED: applicable permission requirement registry and exact observation set required |
| EXP / PLAY | EXPLICIT_PROJECTION_REQUIRED: nine registered base issues and explicit experiment/playbook registry states; old generic diagnosis labels/trigger mappings are not substituted |
| DATA | EXPLICIT_PROJECTION_REQUIRED: source observation freshness is independent of last successful business ingest; no row is not healthy |
| COMM | Internal registered base results only; same guild and sealed evaluation set; no arbitrary previous summary/diagnosis input |

`source-adapters.ts` consumes authorized typed projections only. It does not query source tables, collect personal IDs/body/DM text, guess missing populations, rescan history or add external services. The catalog's mapping labels do not grant availability. Server registration/authorization, retention and immutable version checks remain mandatory. Existing analysis/diagnosis modules are not rewritten by this task.

## Prepared validation (not executed)

- `tests/fixtures/alpha16-rules.ts`: 98 source fixture IDs across 13 rules; each carries baseline, versioned FIXTURE config, asOf, windows, quality and expected decision/reason/action. Counts: ONB7 HELP7 RET7 ENG8 EVENT8 REPORT10 AUTO-0017 AUTO-0028 PERM8 EXP7 PLAY7 DATA8 COMM6.
- `tests/unit/alpha16-rules.test.ts`: all fixture replays; canonical decimal/UTC/hash; unknown field/type/metric/dimension rejection; exact large-count thresholds; comparison cohorts; source gates; interruption; independent REPORT branches; runtime UNKNOWN, strict boundaries and dedupe; COMM version dedupe/partial priority; typed scalar projection round trips.
- `tests/integration/alpha16-rules-facts.test.ts`: prepared isolated PostgreSQL schema/round-trip/microsecond/hash/expiry/recapture/immutability/cross-guild/revision/invalidated/missing component/bounds tests. The test code uses the private existing `isolatedPostgres()` harness and does not use DATABASE_URL.
- DATA F05–F07 intentionally follow IV0/VA rather than superseded self-suppressing IID expectations. ENG F04's 7.5/100 shorthand is represented as exact integer 75/1000. COMM-F01 declares eight rule families and a second RET target, yielding exactly nine slots/four issues/three domains; COMM-F04's repeated upstream HELP observation is also exercised by the dedicated version/duplicate helper test, since canonical Fact sealing itself rejects duplicate identities. COMM initial CREATE_DRAFT examples are superseded by REVIEW_ONLY; partial P3 stays P3. Source fixture IDs retain their original prefixes (ONB/HELP/RET/ENG/EVENT/REPORT/COMM-Fxx and II-C/II-D prefixes), alongside local IDs.

Pending root integration checks before G4/G5: exact target set must be sealed and reused by the worker, effective DB/source expiry must cap evidence publication, declared partial COMM completion must not be treated as aborted required input, and the new group/ref tables must participate in privacy purge. Failure of a required global gate still prevents publication. No production feature is represented as available solely because code exists.

## Preserved alpha15 carry-forward

This work does not close or relabel previous partial/unrun items: S031 Choice ordinal/date-part history, T040R02 ordinary CT01 empty/unknown join, T116 unverified alias/foreach combinations and T114 missing formal input-source/live coverage remain in the parent alpha15 ledger. The historical `192 / 188 complete / 3 partial / 1 unrun` is not a current completion count.

Confirmed alpha15 Instants/variables/start/Wait/schedule occurrence snapshots remain fixed. Uncomputed DateRange conversion, display-zone changes, calendar addition and local-window checks still use current Intl rules; full historical timezone-rule-version pinning is not implemented. Live Discord/OAuth/ACL/relink/publication, retention enforcement during PC outage, backup/restore and actual Windows/Tunnel deployment remain alpha17/environment acceptance work.
