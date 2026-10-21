# alpha16 N16-07 Reports / Organization completion evidence

Source implementation: 2026-10-16. This file records implementation and remaining gates; it does not amend the immutable formal source package or authorize operating policies. No live data, credentials, settings, delivery, deletion, migration, or deployment was operated.

## Domain coverage

| Existing gap | Implemented domain connection | Constraints |
| --- | --- | --- |
| Manual report generation | `Reports.requestGeneration(scope, actor, {templateId, templateRevision, requestId})`; `ReportWorker.tickManual(scope)` | Same canonical `report_runs`, `run_kind=MANUAL`, no schedule/destination/outbox/backfill. Fixed server `asOf`, template revision, saved-view/segment query definitions and source fence. Explicit policy/lease/storage/pending budgets; default disabled. |
| Stored result detail/removal | `resultDetail(scope, actor, id)`; `deleteResult(scope, actor, {id, revision})` | Current READ/CONFIGURE rights and feature, exact scope and revision, bounded payload, expiry hidden, no sending. Current Discord proof required before releasing stored payload. Source visibility/analysis settings/recipe fingerprint checked again; change hides old payload without recomputing it. |
| Template/schedule removal | `removeTemplate(scope, actor, {id, revision})`; `removeSchedule(...)` | Current CONFIGURE, CAS. Referenced schedule/template or existing run history returns 409. No implicit history deletion or UNKNOWN delivery resend. |
| Team update/removal | `OperationsOrganization.updateTeam(scope, actor, {id, revision, name, memberIds})`; `deleteTeam(scope, actor, {id, revision})` | Current GOVERN and team feature. Active members only. Referenced teams cannot change membership or be removed. Name-only edits remain possible. Deferred NO ACTION FKs preserve approval/destination references and permit separately authorized whole-guild cleanup order. |
| Organization name | `renameOrganization(scope, actor, {revision, name})` | Current GOVERN, existing OWNER/ADMIN membership and multi-guild entitlement, canonical scopes and organization/row locks, revision CAS. |
| Organization close | `closeOrganization(scope, actor, {revision})` | Explicit scope coverage gate defaults disabled. Home scope and current OWNER only. The sole active owner must be the caller; any other member, revoked membership, linked guild, team or saved/active/UNKNOWN domain state returns 409. No other guild data is erased. |
| Guild unlink | `unlinkGuild(scope, actor, trustedUserId, {guildId, revision})` | Explicit scope coverage gate defaults disabled. Fresh target Discord snapshot outside DB transaction, current source and target authorization after waiting, both canonical scopes, revision CAS. Home unlink prohibited. Saved/active/UNKNOWN state returns 409. An eligible link changes to `DETACHED` and retains all member/role/team denial roots; no row/data removal or permission fallback. |
| Explicit reattachment | `relinkGuild(scope, actor, trustedUserId, {guildId, revision})` | Same existing scope gate. Current source OWNER/ADMIN plus current target Discord administration; the detached binding cannot itself authorize consent. Active members are checked through Discord outside DB transaction and their exact IDs/revisions rechecked under the organization lock. Current plan, privacy, settings revision, native saved/UNKNOWN state, observation expiry and CAS all gate `DETACHED → ACTIVE`. Revoked bindings stay intact. |

## Authorization and races

New methods receive server-created `MaintenanceAuthorizationProof` through constructor options. The proof is scoped to the exact actor and guild and expires at the server observation deadline. New mutations recheck the proof and current native operation permissions after canonical/legacy/domain/row lock waits. A client-provided actor, expiry or permission claim is never sufficient.

Manual workers decrypt the existing scoped actor reference, verify its hash, and obtain current Discord membership outside the DB transaction. Claim and completion use separate fresh observations/proofs. The worker cannot complete an expired lease, removed result, expired artifact, mismatched snapshot or changed source fence. Manual generation is separate from existing scheduled dispatch selection; scheduled processing never claims manual rows. No renderer or Discord/Webhook delivery is called for manual artifacts.

Participant erasure conservatively invalidates all manual aggregates in that guild because exclusion of an erased participant cannot be proven from a chart. `purgeManualReportsActor`, `purgeManualReportsGuild` and `purgeExpiredManualReports` are exported and connected by the parent to privacy/retention cleanup. Scheduled report/outbox retention is unchanged.

New operation metadata uses `minimalOperationAudit` and expires from the operation time within 14 days. It contains operation code, scoped actor hash, target identifier and revision, never chart payload/query values/body or a copied Run record. Artifact identifiers are not retained in new minimal history after result deletion. Legacy audit purposes are unchanged.

## Unresolved operating gates

- A manually saved report artifact is a separate purpose from a 48-hour evaluation snapshot and 14-day minimal history. Its lifetime is not inferred. `manualReportReadiness()` returns explicit retention, worker, privacy, source-visibility and budget blockers until a complete injected policy is approved/verified. No profile is installed by scripts or worker boot.
- Stored chart visibility uses the current settings revision, resolved channel observability/deletion/collection restrictions and recipe identity/head fingerprint. A mismatch hides the whole stored result. Enabling the feature also requires explicit source writer/visibility coverage verification; the flag is not supplied in runtime configuration. This is not a claim that a historical aggregate is a sealed Rule Fact snapshot.
- Migration 070 extends the existing binding lifecycle with `DETACHED` and a state-change revision trigger. Detachment preserves all denial roots and closes Operations/API access in that scope even if a later authorized individual privacy erasure removes a member row. The existing ACTIVE-only organization license and aggregate participation end. Legacy `link(review)` explicitly refuses DETACHED; legacy member edits preserve its bindings, and newly created teams do not acquire a detached-guild delegation. Reattachment is a separate current-authorization/CAS operation. This is an organization stop, not ownership transfer or permanent physical unlink. No new retention purpose, role permission or grant is introduced.
- Organization close/unlink/reattach inventories refuse saved state rather than moving/deleting it, including analytical work/grants, native configuration/flow revisions, automation, target safety, events, requests, destinations and UNKNOWN effects. Coverage remains explicitly disabled pending verified enforcement across all native writers (`ORGANIZATION_DETACH_WRITER_COVERAGE_UNVERIFIED`). The implementation alone does not certify running that inventory, activate it, transfer an independent guild, or enable production maintenance. UI must display the stopped state and these reasons.

## Verification status

| Work | Status |
| --- | --- |
| Source and native domain/migration contract inspection | Complete |
| Unit fixtures: proof expiry/scope, policy defaults, explicit request input, source fence, organization gates | Added, NOT RUN |
| Isolated PostgreSQL fixtures: manual request/worker/result, no-delivery separation, expiry/visibility, current authority, purge, template/schedule CAS/references, team FK/references/roles, organization CAS/default gates | Added, NOT RUN |
| Static `git diff --check` for owned files | Complete, exit 0; line-ending advisory only |
| Unit/integration/UI execution, typecheck, lint, build | NOT RUN; parent requires whole implementation status before starting verification |
| Actual database migration/data deletion/backup/restore/deployment | NOT PERFORMED |

Files: `packages/operations/src/reports.ts`, `organization.ts`, `policy.ts`, `membership-tombstones.ts`, `apps/worker/src/reports.ts`, parent-owned `migrations/066_alpha16_operations_completion.sql`, `migrations/070_alpha16_organization_detach.sql`, `tests/unit/alpha16-operations-completion.test.ts`, `tests/integration/alpha16-reports-organization.test.ts`.

## Native Report definition author redaction follow-up

The final static audit found new 071 revision/draft `actor_hash` linkage missing from the individual erasure hook. The unapplied 071 schema now permits nullable author linkage. Its dedicated revision trigger permits only non-null author to NULL with every other column unchanged; it rejects restoring an erased author or changing the definition/hash/provenance/timestamps. Typed rows are nullable.

`purgeReportDefinitionActor` acquires the canonical scope and erases only these two new author fields. The existing PrivacyService individual transaction invokes it before deleting the member identity. Native report templates, active definitions, references, report schedules, results and guild settings are not deleted, disabled or rewritten by this new hook. Existing native template author metadata retains its pre-existing purpose and is not silently reclassified. Old author-bound request resolution fails its current privacy/hash checks.

The definition schema contains native title/footer/logo, typed chart queries, saved-view IDs and inclusion options; reference metadata contains scoped configuration IDs/revisions. This source change does not add member answers, message bodies, profile measurements or actor identities to that JSON. Guild cleanup first removes manual children, then deletes native templates; their draft/revision/binding and scheduled Run references are scoped/deferred/cascading and complete in the authorized transaction. The self-source revision FK remains deferred, and no reference crosses a template scope.

A source-only integration fixture in `alpha16-report-definitions.test.ts` exercises actual individual deletion, nullable new author fields, immutable payload/native config preservation, no guild settings change, forbidden author restoration and closed stale author requests. It is NOT RUN. Migration range remains 053–078; no extra migration or operating policy is installed.
