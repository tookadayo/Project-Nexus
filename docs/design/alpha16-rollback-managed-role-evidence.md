# N16-07 ADD05 / ADD10 integration evidence

Prepared implementation and test code only. **No test/type/lint/build/DB execution, migration application, configuration activation or Discord request was performed.** G4/G5/G6 remain unverified. Existing Windows checkout and `next-env.d.ts` are preserved.

## Contract and existing paths

Read IA supplement ADD05 / ADD10 and its fixed rollback contract. `apps/web/AGENTS.md` requires local Next documentation before UI edits; the installed Next Form and Route Handler references were read. The existing API proof's `body:req.body` projection is retained. New paths stay within the existing five-segment automation BFF/public boundary; the auth-boundary owner confirmed no new exposure rule is required.

- Flow definitions/revisions/Run bindings: `packages/automation/src/service.ts`, `store.ts`, `migrations/054_alpha15_automation.sql`.
- Existing validation / simulation / impact / capability / measured host / plan/Beta checks: `AutomationService.check/enable/start`.
- Native role safety: `packages/discord/src/automation-role-policy.ts`; `apps/worker/src/alpha15-discord.ts` rebuilds permission/role/channel impact during review and final dispatch, requires immutable role allowlist and approval policy fingerprint, applies a burst cap and does not retry unknown effects.
- Existing Run-bound role history remains the original `automation_operations` / `automation_runs` records; no second history payload is stored.

## FlowRollback

`prepareRollback` reads the selected scoped historical revision, verifies its exact definition and collects its existing fixed temporal values. It uses the existing save validation/storage limits to create a **new immutable draft revision** and a minimal prepared journal entry. Past definitions/results are untouched. The draft/active pointer/generation must equal the displayed base; concurrent draft or live changes fail closed.

The new revision has no copied checks. Users must perform the existing VALIDATE / TEST / IMPACT steps on that new revision. `commitRollback` then reuses `enable`'s transaction and checks, including current CONFIGURE authority, semantic hash, current schedule meaning, measured host capacity, adopted capabilities, active-flow limit, identity and Beta/plan access. Its rollback hook additionally verifies current draft/active/generation, prepared origin, bounded audit readiness and authoritative target safety. Target UNKNOWN/missing/expired/unverified state is never opened merely by a new revision.

Future scheduler starts use the new active revision/generation. Existing Run rows, frozen occurrence snapshots, prior results and confirmed random/clock values are not updated. The existing scheduler's CAS/generation/dedupe logic remains the start authority. No immediate Discord effect occurs during rollback.

New revisions carry only the immutable `restoration_requires_commit` definition behavior flag. The flag cannot be flipped by UPDATE, and the normal enable endpoint refuses such revisions. Source→new revision provenance is held only in the separate 14-day minimal `automation_rollbacks` journal, without actor/Run/input/output/content/evidence copies or request FK. Journal expiry blocks a stale prepared commit; it does not release target UNKNOWN or convert unknown external outcomes to success. Existing seven-day request/Run cleanup is not extended.

New persistence and rollback activation are unavailable by default. `AutomationServiceOptions.rollbackAudit` must affirm bounded audit storage and cleanup readiness; `rollbackSafety` must implement the current authoritative target-safety check. The existing alpha15 ordinary save/enable paths are not globally switched to an unapproved new safety policy. Defaults do not synthesize OPEN safety or operational authorization.

API additions under existing scoped/authenticated automation:

```text
GET  /flows/:flowId/rollback-history
POST /flows/:flowId/rollback-draft
POST /flows/:flowId/rollback
```

The request strictly binds source/new draft revision, expected active pointer, expected generation and request ID. Response-loss uses the existing read-only request lookup; the UI lifts uncertainty into the workspace's mutation fence and never automatically resends.

The Japanese/English panel provides source selection, current→restored diff, cancel, prepare, fresh-review guidance, final enable confirmation, history, empty/permission/network/unavailable states and request reconciliation. Read-only/dirty/busy/unknown states disable mutation. A refreshed conflict requires reviewing the latest state.

## Managed Role Grants boundary

GET `/managed-roles` projects the existing scoped FlowDefinition.targets.roleIds and revision/state. The allowlist is **configured scope**, not a claim that current native Discord permission is already satisfied. Editing/removing policy uses the existing automation editor and a new reviewed revision; removing policy does not claim that an external Discord role was revoked.

GET `/managed-roles/history` returns only existing flow/Run/revision, grant/remove operation kind, known/unknown state and timestamps. It does not return operation input values, member IDs, role IDs from operation payloads or connector responses, and retains the existing Run-bound lifetime. The UI links to the original flow/Run and explains unknown/no-resend and existing approval requirements.

Dedicated immediate grant/revoke mutation is **disabled / not added**. Existing explicit `discord.addRole` / `discord.removeRole` blocks are the supported operation path, with current native/NEXUS permissions, protected/privileged-role exclusions, allowlist, identity, approval, burst/host/plan admission and external UNKNOWN guard. A raw direct role/member API here would bypass that trusted path. No new role-grant source, privileged action, personal collection or duplicate policy store was introduced.

ADD05 therefore has a connected existing-policy/history/editor surface; it is not represented as an independently complete ManagedRole Grant CRUD/dispatch subsystem. Environment/native Discord acceptance remains unverified.

## Prepared checks, not executed

- `tests/unit/alpha16-rollback.test.ts`: three-part CAS, 14d metadata bound, same-origin wire contract, uncertain result/no automatic retry.
- `tests/integration/alpha16-rollback.test.ts`: private PostgreSQL fixture only; past/new revision immutability, fresh checks, current authority, live generation race, parallel draft conflict, existing Run revision preservation, default unavailable gates, managed policy and UNKNOWN history without payloads.
- `tests/fixtures/alpha16-rollback-ui.tsx`, `tests/e2e/alpha16-rollback-ui.spec.ts`: synthetic browser harness, Japanese/English diff/cancel/prepare/reviewed enable, unknown mutation fence, permission/read-only/network-vs-empty states. These files have not been built or run.
- Migration `067_alpha16_rollback.sql` is expand-only source. Parent registers it and owns actual migration/G5 execution. Privacy owner was notified to erase scoped rollback metadata; due purge/cleanup readiness must be wired before enabling new persistence.

The alpha15 partial/unrun ledger and incomplete historical timezone-rule pinning remain outstanding as recorded in `alpha16-rules-evidence.md` and the parent entry ledger.
