# alpha16 060–078 storage static integration audit

2026-10-16. File inspection and diff whitespace checks only. No SQL, migrations, application, tests, type check, lint, build, backup or restore was executed. Findings are source observations, not DB verification.

The `packages/db/src/index.ts` migration list registers every basename from 060 through 078 in order, including singular `077_alpha16_operational_case_context` and `078_alpha16_rule_operating_profiles`. The referenced files exist in the current checkout. `applyDeletionTombstones` requires versions 053 through 078 inclusive (26 versions), matching the current additive dependencies. None have been applied by this task.

| Source | Canonical deletion / expiry / restore connection inspected |
| --- | --- |
| 060 Rule data | Actor deletion invalidates derived guild evidence conservatively, removes actor state and request keys; guild deletion follows evidence/refs/job/Fact/health/config order. Scoped expiry detaches actionable suggestion evidence before deleting its referenced snapshots/jobs/Case records. Config expiry does not renew through reads or live references. |
| 061 Operator | Preview → challenge/step-up/command cascade; independent shorter factor expiry is also purged directly. Receipt expiry does not release unfinished canonical deletion. Guild erasure deletes new jobs before the restrictive canonical tombstone FK. Operator audit/control expiry is purpose-specific; missing control state stays closed. |
| 062 Rule runtime | Existing Run composite FK/cascading attempts/leases/keys/outbox/reservations; root UNKNOWN is fenced before lifecycle erasure. Missing/expired roots are not created OPEN. The native Run BEFORE DELETE guard requires canonical Rule cleanup first; final audit found the legacy sweep needed an explicit same-transaction bridge. The runtime owner has connected `purgeRuleRuntimeRuns`; static inspection confirms the fixed target-root → complete Run-set → intent/children order before native deletion. |
| 063 / 074 publication | Global bounded manifest and finite safety-root expiry; current STATIC delivery configuration survives root erasure to prevent legacy fallback. No guild-person deletion reclassifies official publication purposes. Fresh independent generation/withdrawal/hash evidence is required for static public readers and effects; restore fences restored heads. |
| 064 Case snapshots | Job-context refs and suggestion evidence are detached before Case child rows, then parent contexts. 48-hour snapshot bounds and original deadlines remain unchanged. |
| 065 personalization | Actor preferences/requests removed; explicit deleted-member references in copied template definitions are scanned and affected templates/prepared references removed. Guild/expiry deletion reaches template children through scoped cascade. |
| 066 completion | Manual report children precede native template erasure. New operation audit uses its 14-day class rather than changing older audit purposes. Team reference FKs are deferred NO ACTION so independent deletion cannot silently null an approval/destination; full scoped erasure clears children in the same transaction. |
| 067 rollback | Guild deletion and scoped due expiry remove minimal rollback rows. Definition provenance has no Run/request/evidence FK and does not retain execution payload/history. |
| 068 integration | Whole-guild deletion follows deliveries → secrets → endpoints after dependent native domains. Individual event-source erasure uses the redaction hook, preserving UNKNOWN/admission safety instead of cascading away uncertain delivery guards. No automatic resend or original-time renewal. |
| 069 / 072 lifecycle authoring | Actor/guild/expiry request cleanup is connected; scoped onboarding workspace/draft/publication children are removed before native flow deletion. New flow copies are checked for explicit erased member references. |
| 070 organization detach | Native DETACHED preserves denial-bearing role/member/team bindings; policy and credential paths deny fallback. Explicit reauthorization/CAS is required to relink. This is existing native state configuration, with no new personal collection or permission. |
| 071 Report definition copies | Audit found new revision/draft author hashes missing from individual deletion. Fixed by nullable author fields and `purgeReportDefinitionActor` in the canonical personal transaction. A dedicated immutable trigger permits only author non-NULL → NULL, with all other revision columns unchanged. Native template/configuration is preserved. Template, draft, self-source revision, binding and scheduled Run FKs remain scoped/deferred/cascading; manual children are erased first. New generation evidence is physically cleared at its own ≤48-hour source expiry without reclassifying native history. |
| 073 cohort definitions | Guild erasure deletes heads before revisions; revision due deletion cascades heads. This retains explicit CONFIG purpose and does not impose a new blanket 48-hour lifetime on definitions. |
| 075 execution / permission observations | Execution observation is Run-owned FK CASCADE and never contains actor/body/result/safety history. Audit found its initial deadline-based expiry can precede the later terminal Run cascade; source owner is adding own-expiry deletion and preventing recreation with renewed expiry. Permission epoch is current non-personal configuration; it does not authorize an old permission snapshot. |
| 076 issue registry | Scoped guild/expiry purge is connected; original declaration deadline is ≤48 hours, no read renewal or copied evaluation history. |
| 077 operational contexts | Guild removes contexts/profiles/requests, actor removes only their minimal request identity, due expiry clears contexts/profiles/requests. Typed field children cascade with their parent, with no member/body collection added. |
| 078 operating profiles | Nullable immutable CONFIG metadata has no source-version FK; ordinary config expiry/guild removal erases it with the containing row. ACTIVE successor expiry is min(original DRAFT, measured profile, CONFIG), and RETIRED successor cannot extend its source. Current profile expiry gates new evaluation rather than existing proposal reads. |

The legacy Run sweep bridge and independent 075 observation expiry findings were reported to the parent and their current owners before edits, avoiding concurrent modifications. The bridge is now present; the 075 owner must confirm the own-expiry/recreation repair in the parent's final source gate. The parent also changed the privacy root counter increment to saturating UNKNOWN so a valid maximum bigint cannot block individual erasure. This audit did not identify another confirmed blocking column-name/FK-order mismatch in the inspected 060–078 paths. That is not a substitute for the pending isolated migration/integration checks.

Relevant implementation records: `alpha16-operator-evidence.md`, `alpha16-operations-completion-evidence.md`, `alpha16-safety-state-evidence.md`, `alpha16-operating-config-evidence.md`. All new fixtures remain NOT RUN.

## Follow-up coverage through 082

This supplement supersedes the earlier maximum and pending 075 status above.
Parent registration covers 080 through 082; the offline tombstone utility requires
053 through 082 inclusive (30 versions). The 075 owner confirms its independent
original-deadline purge/anti-recreation repair and native expiry DELETE are saved.
Those changes have not run.

| Source | Follow-up deletion/expiry/restore coverage |
| --- | --- |
| 079 role access | Actor/member/Run-free. Scoped own-expiry and context cascade are connected; new CAPTURE also takes the caller's current base/context deadline before a parent row exists. |
| 080 native context | Both finite tables use original first-capture expiry at most 48 hours. Plugin expiry and context/guild cascade connect. Restore additionally checks earlier role and embedded-field expiry and cascades the containing finite copy/EAV fields. |
| 081 metadata contract | No new table/class. Existing native sent_at/collector lifecycle stays authoritative. Restore schema inventory covers reference/mention contracts, actual clocks and erased reply-provenance quality. Source owner confirms actor sanitization/unknown quality/health restart fencing are saved. |
| 082 metric copy | Header/typed EAV cascade with context; original normal header expiry is bounded by the earliest source expiry. Restore independently checks child source_expires_at even with a future header, then cascades its containing context and values. |

Concrete restore coverage checks migration/column facts, purges finite copies,
reads back after cleanup and final waits, and bounds the isolated receipt by the
earliest remaining original deadline. A generic adapter success cannot certify
unknown source storage. Missing schema/deadline coverage stays closed. Native
CONFIG and collection purposes are not changed to 48 hours. Supporting code is
`alpha16-restored-source-retention.ts`, `alpha16-retention.ts` and
`apps/worker/src/alpha16-safety-restore.ts`. New fixtures are source only; no SQL,
tests, type check, lint, build, API or restore ran.
