# alpha16 Operator / Privacy implementation ledger

2026-10-16. Implementation and static source review only. **The unit, DB,
browser, type, lint and build checks listed below have not been executed.**
No credentials were generated, settings changed, migration applied, data erased,
backup restored, external request sent or service deployed during this work.

Latest policy update: `alpha16-spec-deltas.md` and
`packages/rules/src/retention-contract.ts` now select new minimal operation audit
and deletion receipt from their operation/acceptance anchor for up to 14 days,
and new snapshots/evidence for up to 48 hours. These are source contracts, not
runtime activation or deletion of existing purpose-specific data. Target safety,
restore tombstone lifetime and publication withdrawal lifetime remain unresolved.

The formal source is the unchanged `alpha16-source` package. Canonical README,
migration plan, contract decisions, decision gate and index were read before
III-A/B, I-C3/4 and V-A/B/VI. The later user's implementation approval satisfies
G1; the source documents' earlier request for approval does not revoke it.

## Current code / schema mapping (G2 CODE_SCHEMA)

| Contract | Existing canonical implementation | alpha16 change |
|---|---|---|
| Independent local listener | `apps/operator/src/server.ts`, `scripts/operator.ts` | Keeps loopback socket, exact Host/Origin, no forwarded headers/proxy, same-origin assets. New `/operator/alpha16` UI and `/operator/v1/...` routes. |
| Local authentication | `operator_sessions`, `operator_login_budget`, `OperatorAuth` | Reuses configured password factor, existing throttle and credential epoch; reauthentication creates no login/session. Server challenge and one-use step-up bind session, preview hash, policy and expiry. |
| Dedicated permissions | Previously no separate privacy/global grants | Injected `OperatorGrant`; empty default. Guild grants do not confer global erasure. No environment grant, credential or permission was created. |
| Member tombstone | `deletion_requests.lookup_hash` already blocks identity resolution | Existing canonical row reused; new nullable `alpha16_expires_at` affects only new approved purpose-specific rows. Legacy retention stays distinct. |
| Member erasure | `PrivacyService.delete`, `scrubQueue`, existing billing/automation purges | Canonical scope locks before legacy privacy locks; `purgeRuleActor` within the same domain transaction. Existing tombstone completed instead of copying a new indefinite member marker. |
| Guild erasure | `beta_deletion_jobs`, `PrivacyService.eraseGuild/deleteBetaGuild` | `purgeRuleGuild`, alpha16 member-job/receipt cleanup and canonical locks. Settings mutation acquires scope set before its legacy privacy/Beta/settings locks. |
| Accepted deletion | Existing member tombstone plus new additive job/receipt | Migration 061 adds job/receipt and local preview/challenge/step-up/command tables. Tombstone, public OAuth session revocation, job and hash-only receipt commit atomically. Physical purge and queue scrub are a separate worker phase. |
| Admission / Beta lifecycle | `BetaOperator`, `beta_guild_invitations`, existing entitlement and quota domain | Read-only Bot probe outside DB transaction; `changeInTransaction` connects original transition/CAS/capacity/entitlement checks with reviewed Operator step-up. Separate `BETA_LIFECYCLE` handles revoke/unlink/delete/retry, typed whole-guild erasure and separate ungranted permissions. No Stripe operation or external invite is issued. |
| Announcement | `OfficialPublications`, `official_publication_*` | Strict native draft input/revision bound into common review. Save/discard reuse the native transaction. Publish/withdraw stay disabled without verified static publisher capability. |
| New dispatch control | New `alpha16_operator_controls` | GLOBAL/GUILD/FLOW/RULE CAS controls. New runtime rejects missing, expired or stopped required scope. Expiry removal cannot implicitly resume. Existing Run revisions and UNKNOWN effects are not rewritten. |
| Health | Injected read-only observations | Exactly PC process / DB / queue / worker / Discord outbound / Tunnel. Absent/future/expired observations become UNKNOWN; no candidate 60-second TTL installed. |
| Audit | Existing `operator_audit` | New alpha16 commands add only operation kind, minimal scope, stable reason code and approved expiry. Existing purposes are not changed to seven days. Reader projects no secret/body/profile. |
| Restore utility | `capture/applyDeletionTombstones`, `scripts/tombstones.ts` | V2 encrypted snapshot includes active pending member tombstones and original finite expiry, V1 remains readable. Reapplication fences automations, stops restored new controls and revokes sessions. Applying tombstones returns `runtimeReady=false`; it is not restore/startup authorization. |

Migration 061 is source only and expand-only. Root owns registration and the
related 060/062/063 migrations. Existing `apps/web/next-env.d.ts` was not edited.

## Implemented boundaries

- Preview accepts exact opaque Discord IDs, never display names or fuzzy search.
  Confirmation binds identity, scope, plan, hash, policy revision and expiry,
  then rechecks current permission/state. New arriving data alone does not change
  the preview plan. Tombstone protects subsequent writes/retrievals.
- Idempotency is request identity, step-up is preview authorization and deletion
  receipt is status only. They cannot be substituted. Same-intent replay returns
  current limited status without replaying the first receipt secret or identity.
- Receipt secret is 256-bit CSPRNG, prefixed for its purpose, stored only as a
  purpose-separated SHA-256 digest. Secret and scope proof go in headers, never
  URL/query. Rate policy is required and has no operating default.
- Global deletion remains explicitly unavailable because coverage of future
  guilds and every writer is not established. A dedicated global permission
  alone cannot enable it or silently broaden a guild command.
- Live purge, partial failure and backup expiry are separate. Queue failure stays
  PARTIAL_FAILURE; lease/CAS loss cannot be displayed as completed. No clock-only
  observation pretends that a stopped PC or backup system performed physical
  deletion. Backup state starts UNKNOWN.
- Run retention helper uses `terminalAt + <=7d`; backup maximum is seven days.
  New audit/receipt source maxima are 14 days; snapshot/evidence maxima are 48
  hours, per the later user-delegated selection. Other safety classes need their
  own finite, approved, enforcement-verified policy.
  The new member marker must cover the deletion job lifetime plus the maximum
  backup lifetime. No runtime policy or old 30d/24-month candidate was installed.
- Receipt lifetime is independent of its job: job expiry detaches the FK without
  clearing the tombstone or inventing purge completion. A still-valid limited
  receipt can report UNKNOWN/status-record-expired without revealing identity.
- Expiry cleanup removes ephemeral previews/challenges/step-ups/command refs,
  receipts, new audit, controls and expired job payload. An incomplete deletion
  raises a lifecycle blocker and keeps its existing tombstone blocking; this is
  an incident/retention violation requiring recovery, not a successful expiry.
- `Alpha16OperatorMaintenance` has bounded batches and a startup-first purge
  contract. No timer, boot integration or activation is silently installed.
  Unconfigured policy/writer coverage/batch config returns disabled before DB use.
- Restore readiness requires a valid unexpired backup <=7d, isolation,
  independently current tombstones before/after restore, independently current
  target safety, completed purge, revoked sessions, rebuilt cache/queue and
  separate live/backup expiry enforcement. Backup OPEN never becomes current
  authority. The old utility only applies deletion information while offline.

## UI and compatibility

The Japanese/English local UI covers the six health sources, admissions and
native state changes, scope controls, exact-ID deletion preview/reverification,
limited receipt status after ordinary session loss, announcement drafts,
read-only recovery readiness, audit and config health. Loading, empty,
permission failure, unavailable, stale/unknown observations and conflicts have
separate paths. Back/cancel before commit performs no deletion. Busy confirmation
prevents duplicate submit; requests do not automatically retry an unknown result.
Tokens/receipts remain in memory and are never put into browser persistence.

Historical mutation routes `/operator/guilds`, `/operator/publications` and
`/operator/legal` reject with 428 rather than bypassing preview/step-up. Read
compatibility routes remain. `OPERATOR_LEGAL_MANAGE` is a newly registered,
default-ungranted permission for the reviewed native legal-settings draft writer.
No permission was granted and no public legal release was authorized. Old alpha12 browser scripts expecting unreviewed
mutation success must be migrated to the new UI/contract; their historical PASS
is not an alpha16 result. Legal publication remains blocked by existing release gates.

## Acceptance source created, all NOT_RUN

| Source | Intended coverage |
|---|---|
| `tests/unit/alpha16-operator.test.ts` | A16-DEL-01/02/03, exact schema/scope, canonical preview, revision, no candidate TTL, disabled confirm, six independent health sources and stale/unknown. |
| `tests/unit/alpha16-retention.test.ts` | Run terminal limit, class-specific approval, backup expiry/max, latest tombstone and target safety, isolation/purge/session/queue/enforcement requirements. |
| `tests/integration/alpha16-operator-privacy.test.ts` | Atomic acceptance, OAuth revocation, hash-only receipt, preview mismatch rollback, permission loss, GLOBAL disabled, receipt scope, limited replay, partial queue failure. Uses isolated synthetic data and fixture-only policy. |
| `tests/ui/alpha16-operator-smoke.ts` | Controlled browser mock: JA/EN, six UNKNOWN sources, empty, permission/network failure, exact-ID preview/cancel, recovery NOT_READY, mobile overflow/screenshots. Does not claim real auth/erasure/restore. |

All tests, type checks, lint, builds and browser runs remain **NOT_RUN** until root
shares the all-implementation-complete status and starts consolidated acceptance.

## Remaining gates / alpha17 handoff

- G3: remaining safety retention (including tombstone expiry semantics and
  controls), operational enforcement of the selected audit/receipt periods,
  current dedicated grants, step-up TTL/rate/lease/batch
  config, verified source/writer/cache/queue coverage and enforcement remain
  unapproved/unconfigured. New dangerous actions default disabled.
- GLOBAL writer coverage is a distinct disabled capability, not implementation
  completion. General-user self-service deletion was not expanded.
- Native Beta `revoke/unlink/delete/retryDeletion` cannot be smuggled through
  `OPERATOR_ADMISSION_MANAGE`. Separate `BETA_LIFECYCLE` preview/step-up/nativeTx
  uses `OPERATOR_BETA_LIFECYCLE_MANAGE` plus `OPERATOR_PRIVACY_ERASE_GUILD`, both
  default ungranted. Whole-guild `GUILD_SAVED_DATA` is separate from III-A's
  exact-user target. Preview names access revocation, collection stop, analysis
  cancellation, whole-guild erasure or incomplete purge retry. Native retry only
  resets deletion maintenance, never unknown external effects. Verified code
  scope flags default false; that activation row remains BLOCKED.
- Real local factor/Windows ACL, actual listener exposure, live/backup retention
  during PC shutdown, independently latest tombstone and target-safety retrieval,
  backup expiry observations, isolation/restart supervision and actual restore
  remain alpha17 environment acceptance. No such evidence was fabricated.
- Native legal-settings write is gated by the registered, ungranted dedicated
  permission and the same policy/preview/step-up contract. Static publishing needs verified
  atomic/conditional generation/hash/cache/withdraw capability.
- Incomplete deletion keeps its existing canonical tombstone active. Missing
  independent finite safety/restore proofs close new external Apply, publication
  and restore readiness; personal erasure grants no authority to disable an
  entire guild. Changing `terminalAt`, copying Run data or extending a
  lease/history is not a retention workaround.

## Authorized isolated verification on 2026-10-16

After the parent authorized the combined test phase, all nine operator/privacy
integration cases passed in the final alpha16 batch (33 files / 173 tests).
Evidence: `.local/alpha16-db-alpha16-final.log` and its `.vitest.json` report.
This supersedes earlier NOT RUN statements for that integration file. Synthetic
local sessions and proofs exercised preview binding, current permission,
tombstone/job/receipt atomicity, independent factor expiry and incomplete-purge
handling. No real account, grant, setting, deletion or restore was performed.
