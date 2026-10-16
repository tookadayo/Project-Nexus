# alpha16 → alpha17 handoff

This is a source and acceptance handoff, not a deployment authorization. See the immutable [formal input](alpha16-source/NEXUS_alpha16_migration_plan.md), [later user decisions](alpha16-spec-deltas.md), [baseline ledger](alpha16-entry-ledger.md), and [feature mapping](alpha16-feature-mapping.md).

Consolidated verification is now authorized and has run in the existing Windows
checkout. The current [validation ledger](alpha16-validation-status.md) supersedes
earlier source-only NOT_RUN notes: Next production build, whole-workspace
TypeScript/ESLint, offline component browsers and the synthetic Operator smoke
passed. Disposable-database integration passed all 108 files / 1,058 tests. One unit
test remains blocked by this PC's PowerShell script-execution policy; no policy
change or bypass was applied. None of these results activates a real service,
publisher, deletion job, restore or Discord operation.

## Checkout and evidence

- Use the existing Windows checkout `D:\Project Nexus`, branch `codex/alpha16-rule-platform`, starting commit `35b0d22398c1463e2c88d7f49d960fa8a065002a`.
- The 37 original files are preserved under `docs/design/alpha16-source`. The ZIP SHA256 is `47cd62d4ba7cddac2477bde8c3df18e1f4a1d3d0b27484fb88b9ead13dbde66e`.
- `apps/web/next-env.d.ts` contains a pre-existing user change. Preserve SHA256 `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000`; exclude it from any implementation commit.
- New migrations 060–082 are expand-first source files. No production database has been migrated. New dispatch, retention enforcement and publishing profiles remain unset.
- The alpha15 regression ledger has 192 historical rows, including three partial rows and one not-run row. Historical results do not establish alpha16 results. Unevaluated calendar expressions still depend on the current host time-zone rules; the old tzdb is not bundled or pinned.

## Required placement

お名前.com receives only generated, public HTML/CSS/JS/JSON. The Windows server PC runs all Next/BFF/API/database/Rules/Worker/Scheduler components. Server-side Next database access remains on that PC. Browser requests use the app's same origin through its authorized Tunnel ingress. Operator has its own authenticated loopback listener and is excluded from public proxy routes. Discord outbound traffic leaves the PC directly; a Tunnel failure does not by itself establish a Discord operation's outcome.

## Contracts to settle before activation

| Boundary | Required evidence / remaining decision |
|---|---|
| Authorized source projections | Native source readers and typed cohort/issue mappings are assembled. Verify actual metric semantics, provenance, coverage, maturity, windows and aggregate visibility. HELP has no existing first-response/structured-stalled outcome; decide the permitted acquisition source and purpose before implementing that missing numerator. An acknowledgment is not a response. Other unavailable source observations remain UNKNOWN; fixtures cannot replace them. |
| Operational Rule/CASE profile | Approve individual minN, freshness, thresholds, calendar/elapsed cooldowns and finite runtime/storage budgets. Fixture profiles are separate. Use a short PC measurement, without long stress runs. |
| Typed target writers | Native Experiment, onboarding settings/flow, Automation, Playbook, Report and three cohort-policy drafts use immutable revisions on the Suggestion transaction. Other unsupported types have explicit unavailable reasons and the formal REVIEW_ONLY fallback. Register only editors whose scope, live version, current authorization, rollback and deletion behavior have been verified. Initial recommendations remain REVIEW_ONLY. |
| Independent safety state | Choose separate lifetimes/enforcement for TARGET_LIVE_SAFETY, restore tombstones and publication withdrawal generations. Missing/expired state never means OPEN, successful reconciliation or permission to resend. No 90-day default was adopted. |
| Other new persistence purposes | Decide TEMPLATE_DEFINITION, PERSONAL_PREFERENCE, PERSONALIZATION_REQUEST, LIFECYCLE_WEB_REQUEST, REPORT_ARTIFACT, and purpose-specific configuration/runtime/publication/operator retention. The 48-hour Fact and 14-day minimal-history contracts do not silently approve these classes. |
| Organization unlink | The existing guild link has a DETACHED stop state. Permission records remain in place and current Operations/API access stays blocked, including after a participant deletion. Explicit reattachment requires fresh ownership/administrator/member/plan checks and CAS; its maintenance scope profile remains unset. |
| Lifecycle individual cancellation | The native pre-admission cancellation path stops a selected pending run and its unsent queue row. A started, attempted or uncertain delivery cannot be recalled or labelled cancelled. Its request policy and current authorization remain required. |
| Publication | Verify a concrete adapter's staging, admission, manifest hashes, generation CAS, cache withdrawal, expiry and read-only reconciliation. An uncertain result is not retried as a new publication. Legal/contact content needs its own approved public text and receiving operation. |
| Runtime/legacy compatibility | Verify every writer against current proof, scope lock order, target safety and parent Run purge. The database rejects parent Run deletion while new runtime children have not passed the canonical purge. New dispatch remains disabled until that compatibility is established. |
| Existing webhook worker adoption | The webhook worker now requires an explicit finite runtime/safety/authorization adoption profile. Existing construction without that profile returns disabled and leaves pending work unsent. Before any deployment, account for this change to existing webhook delivery, including uncertain sends, endpoint safety, startup reconciliation and independent retention enforcement. |

The exact unresolved data semantics and coverage conditions are recorded in [source gaps](alpha16-source-gaps.md). Ordinary CASE aggregate readers, typed source forms and multiple-resource selection are implemented. A current policy UUID is never used as if it were a Discord issue/event ID. The isolated restore path checks schema 082 and the finite original-expiry inventory before issuing a stopped recovery receipt. Current isolated verification belongs to the validation ledger; real stopped-PC/backup enforcement remains an alpha17 acceptance boundary.

The user-selected live maxima are 48 hours for new evaluation Fact/evaluation/source-health/evidence, and 14 days for new minimal suggestion history, minimal operation audit, rejection suppression and deletion receipts. Original source expiry wins. Reading, copying, retrying or saving does not extend an anchor. Run details and backups retain their separate seven-day ceilings. Receipt expiry does not release deletion jobs or tombstones. Existing daily aggregates, Detailed Analysis and separate audit purposes are not recategorized by these new classes.

## Alpha17 acceptance work

1. Use the recorded alpha16 validation as the checkpoint baseline. Preserve the named ACL failure, real-operation NOT_RUN results, held-feature list and user-file hash; synthetic successes do not establish G4 or live acceptance.
2. Before a separately authorized target migration, back up the current deployment and record schema/code compatibility. Fresh isolated application through 082 already passed. Roll back code by disabling new entry points; never drop evidence/safety state to make old dispatch resume. A destructive down migration is not supplied.
3. Verify actual Windows 11 service behavior, hidden background processes, startup deletion reconciliation, bounded expiry enforcement, shutdown/restart and PC offline recovery. No worker may report physical deletion while the PC is stopped.
4. Verify domain/TLS/OAuth redirect/host-only cookies/CSRF, same-origin BFF, exact callbacks and public default-deny ingress. Demonstrate that Operator and internal API credentials cannot be reached through the public Tunnel.
5. Verify current real Discord user permissions, Bot installation, missing permissions, stale membership, grant/revoke, plan differences and setup without requiring `/nexus link`. Use an expressly authorized test guild and data.
6. Exercise queue redelivery, concurrent edits, expiry, cancellation, date boundaries/DST, frozen random draws and result-unknown failures. Reconciliation must be read-only unless a separately authorized new operation is issued.
7. Verify backup maximum age and an isolated restore using independently fetched latest tombstones and target safety, before and after restoration. Purge expired data, revoke old sessions, rebuild cache/queues and keep dispatch stopped until every required readiness check passes.
8. Confirm public static snapshots, language routes, stale/absent status UNKNOWN, announcement withdrawal, unapproved Legal/Contact unavailability, and dynamic PC pricing as the canonical purchase decision. Do not fabricate prices or activate payment collection.

No credential generation, purchase, production data mutation, security configuration change, deployment, push or merge is included in this handoff.
