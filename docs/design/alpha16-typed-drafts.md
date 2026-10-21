# N16-11 native typed draft adapters

Source contract only. No operational policy, source confirmation, catalog action
mode, deployment, retention setting, or external action is activated here. Every
initial action remains `REVIEW_ONLY`. An editor registry entry does not authorize
`CREATE_DRAFT` and is independent of proposal visibility under current `READ`.

`packages/rules/src/typed-drafts.ts` is the concrete server-side registry injected
by the rules BFF. Unknown target types receive an explicitly unavailable adapter;
they do not inherit another target's writer compatibility.

| Target | Native contract | Registry result |
| --- | --- | --- |
| EXPERIMENT | `RevisionService.draftInTransaction`, native `experimentSchema` | Structurally connected; initial action admission remains REVIEW_ONLY |
| ONBOARDING | Same native draft helper, `onboardingConfigSchema` | Structurally connected; initial action admission remains REVIEW_ONLY |
| AUTOMATION / AUTOMATION_FLOW | `AutomationService.saveInTransaction`, native definition validation and immutable revision | Structurally connected; initial action admission remains REVIEW_ONLY |
| PLAYBOOK | `Playbooks.draftInTransaction` adds an unheaded immutable revision using the native allocator | Structurally connected; initial action admission remains REVIEW_ONLY |
| REPORT / REPORT_DEFINITION | `Reports.draftInTransaction`, native immutable Report configuration revisions (071) | Structurally connected; initial action admission remains REVIEW_ONLY |
| ONBOARDING_FLOW | `createOnboardingFlowDraftAdapter`, native immutable flow workspaces/revisions (072) | Structurally connected; initial action admission remains REVIEW_ONLY |
| HELP_INTAKE_POLICY / COMMUNITY_ENGAGEMENT_POLICY / EVENT_PROGRAM | `draftNativeCohortConfig`, typed unheaded source-definition revisions (073) | Structurally connected; CONFIG policy and initial REVIEW_ONLY admission remain closed |
| Other targets | No registered native immutable draft contract | `TYPED_EDITOR_NOT_REGISTERED` |

For EXPERIMENT, the target ID is the current published `guild_config_heads`
revision UUID, and live version is its native integer revision rendered as a
string. The source must use that exact mapping; a historical revision cannot
stand in for a newer head. Existing intervention references must still belong to
this guild, be published interventions, and satisfy their native schema.

For ONBOARDING, the target ID is the current published onboarding revision UUID.
Live version is `<native domain version>:<guild_settings revision>`. Its current
content hash binds the published head hash, settings revision, and effective
`onboardingMode`/`hybrid` fields. This includes direct native settings edits in
the CAS rather than assuming an old published definition is still effective.

The two configuration paths add `{definition: <native typed definition>}` as an
immutable `guild_config_revisions` draft. They do not publish, move the head,
change current settings, start an experiment, or enqueue Discord work. The native
draft helper retains native administrator authorization, schema validation,
domain advisory serialization, audit, and optional asynchronous before-write
checks. Native `draft` and `publish` acquire canonical scope locks consistently;
SettingsService and guild erasure already use those scope locks.

The Automation path accepts `{definition: <native FlowDefinition>}` through
`flowDefinitionSchema`; full native numeric/temporal/graph validation still runs
inside `AutomationService.saveInTransaction`. Its target is an existing flow ID.
Live version is `<draft revision>:<active revision or none>:<generation>:<state>`
as exported by `automationDraftTargetVersion`. The adapter locks the native
host/guild Automation fence and target row before the Suggestion row. The helper
reuses that fence and performs the existing native request receipt, authoring
revision CAS, flow/revision and byte admission, immutable revision insert, and
exact-revision return on the same `Tx`. Legacy SAVE hashes are unchanged when
the optional request binding is absent; rule-created drafts use the existing
SAVE receipt class with a bound target/version and a server-issued UUID.

Automation save does update its native draft pointer and authoring name. It does
not change the active revision, generation/state, schedules, or Runs, and it
does not copy VALIDATE/TEST/IMPACT check receipts. The new revision still needs
the existing separate native review/activation workflow. `draftId` is the flow
ID and `immutableRevisionId` is `<flow ID>:<saved revision>`; content hash is the
native immutable revision's semantic hash.

All ordinary/rollback save, enable, and disable/delete entry points now acquire
canonical scopes before the existing Automation lock. The remaining direct
flow writers are existing erasure and restore paths: guild/member erasure
already enters under canonical privacy scopes, while
`applyDeletionTombstones` acquires GLOBAL exclusive before
`fenceRestoredAutomations`. This static writer protocol, rather than the presence
of an editor or a draft schema alone, is the basis for Automation's
`writerCompatible: true`. Runtime start/check/approval/cancellation semantics
and their Run kinds are unchanged. No new table, purpose, permission, or Run
type is introduced.

The Playbook path accepts `{definition: <native PlaybookDefinition>}`. Its target
is the existing playbook UUID, and live version is
`<edit version>:<head UUID>:<current state>:<approval or direct>` as exported by
`playbookDraftTargetVersion`. Including state captures native plan pauses that
do not increment the historical edit version. The native operations fence and
parent playbook row are locked before the Suggestion row.

`Playbooks.draftInTransaction` inserts only a `playbook_revisions` row with no
head change. This is a contextual draft; it adds no DB state or enum. The table's
existing immutable trigger and parent FK apply unchanged. A shared private
append helper allocates `max(revision)+1` and inserts the row for both ordinary
save and rule drafts while holding the existing operations fence. A later
ordinary save therefore includes unheaded revisions in its allocator instead
of colliding with them. No head, playbook name/state/edit version, approval,
creator, evaluation timestamp, execution, action run, or delivery is rewritten
by the rule draft. `draftId` and `immutableRevisionId` are both the new native
revision UUID; content hash uses the native typed definition's canonical hash.

Native CONFIGURE/playbooks plan access, current-head CAS, existing approval
workflow entitlement when required by the current playbook, and enabled-route
validation run before and after the native write. The caller's current proof
and deletion checks are retained before write/audit completion. Ordinary
save/transition now acquire canonical scopes before the operations fence. The
existing plan-state writer also acquires canonical scopes before privacy and
operations locks; its other behavior is unchanged. The worker's existing
`last_evaluated_at` write is runtime timing metadata and is deliberately outside
the definition/head/approval target version. The new unheaded revision has the
same native revision storage/deletion lifecycle as other playbook revisions;
no new retention class or audit purpose is introduced. Activation or copying a
draft to the current head remains a separate native workflow and is not invoked
by this adapter.

RulePlatform retains current authorization, scope/deletion checks, prepared
request identity, target safety admission, target-before-Suggestion locks, exact
Suggestion/native version CAS, expiry, and approved typed-payload equality. The
native draft, its Suggestion link, and minimal history all use the same `Tx`.
Current permissions, proof expiry, actionable expiry, link expiry, and locked
parent safety are rechecked before returning from that transaction. A failed
check rolls back the native draft too. Native drafts retain their existing
configuration purposes; additive Report/Onboarding tables complete the native
draft contracts described below. Their rule
links/history remain under their existing approved policy classes.

REPORT/REPORT_DEFINITION now have a complete native draft/read/edit/preview/
commit/discard contract, rather than substituting a different domain's draft.
See [Report definition contracts](alpha16-report-definition-drafts.md). The
registry maps both names to the actual Report template UUID. Its sealed live
version binds the template edit revision, native typed definition hash, and
saved-view/segment revision hash. Creating/editing a draft changes only the
new native draft/revision tables. An explicit confirmed commit is the only new
path that updates the current native template; it does not create a Report Run,
change schedule times, enqueue a delivery, or invoke an external action.

ONBOARDING_FLOW delegates to `packages/onboarding/src/flow-drafts.ts`, which owns
the exact MAIN/HYBRID native source and version contract. Its compact live
version binds flow/settings versions and a digest of both current flow heads
and definition hash. The adapter adds an immutable workspace revision without
publishing the flow or changing settings/session state. The native module owns
its separate explicit preview/publish/delete operations. Registry integration
does not elevate any initial action mode.

The three source-policy targets use their own exact native cohort kinds:
HELP_BACKLOG_COHORT, ENGAGEMENT_CONTINUATION_COHORT and
EVENT_RSVP_ATTENDANCE_COHORT, respectively. Target ID is the existing source UUID;
live version is the actual headed native integer revision rendered as a string.
The adapter accepts only `{definition: <matching closed native definition>}` and
cannot change source kind, enablement, active head, collection, or delivery.
CHANNEL and other unrelated targets do not inherit this policy editor.

The 073 native append helper serves ordinary headed saves and unheaded drafts.
Both take canonical scope locks; the current head is locked before a Suggestion.
It allocates `max(version)+1` across every immutable revision. `base_version`
records the request's actual headed CAS independently from the newly allocated
ordinal, so an ordinary save after several drafts still replays correctly.
Nullable `draft_parent_revision_id` records the draft's exact same-source native
parent. It is immutable provenance, not a new lifecycle state. Ordinary save
replay rejects draft rows; readers/projectors continue to select only heads.
The exact historical reader is for request replay and does not declare an old
revision current. Source kind cannot change through a normal revision either.

Current CONFIGURE permission, live authorization proof, deletion state, current
native settings/panel/channel binding and the existing CONFIG retention policy
are checked before and after writing. Draft expiry is at most the current
parent's original expiry and the current CONFIG policy ceiling. Read/retry does
not refresh it. Parent expiry/deletion cascades to its unheaded child revisions;
no additional table, retention purpose, personal collection or permission is
introduced. The registry takes an optional third `PlatformPolicy` argument;
the current BFF passes no operational policy, so this path remains disabled.
The native draft and Suggestion link/history still commit or roll back together.
Prepared acceptance source in `alpha16-native-cohort-drafts.test.ts` covers shared
allocation/replay, immutability, rollback, expiry, source kind, tenant and CAS.

Source references: `packages/settings/src/revisions.ts`,
`packages/settings/src/domain-config.ts`, `packages/settings/src/index.ts`,
`packages/operations/src/playbooks.ts`, `packages/operations/src/reports.ts`,
`packages/operations/src/plan-policy.ts`,
`packages/automation/src/service.ts`, `packages/onboarding/src/index.ts`,
`packages/lifecycle/src/web-workspace.ts`, and
`packages/security/src/privacy.ts`.

Implementation was inspected statically only. Test, type-check, lint, build,
migration execution, and runtime activation were deliberately not performed.
