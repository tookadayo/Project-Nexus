# Native Report definition drafts (N16-11)

This is compiled source only. Initial Rule/CASE actions remain REVIEW_ONLY;
no operational source is confirmed, no retention setting is activated, and no
deployment or database migration was executed during implementation.

`071_alpha16_report_definition_drafts.sql` completes the existing native Report
configuration purpose with immutable `report_definition_revisions` and mutable
`report_definition_drafts` headers. A header stores the current immutable head,
edit version, base active-template version/content/reference hashes and, after
an explicit commit, its minimal commit identity. It introduces no new personal
collection, permission, external contract, generated Report content, or Run kind.
Configuration definitions are validated with the same native title/footer/PNG/
chart/saved-view/summary fields as ordinary Report templates.

Native tables remain scoped by organization/guild/template. Immutable revisions
use the existing reject-update trigger and a shared max-ordinal allocator under
canonical scopes followed by the native operations lock. Ordinary `template`
saves also append an immutable active snapshot and update
`report_templates.definition_revision_id`. A legacy template has a null head
until an explicit native save; reads never invent a head or backfill data.
`report_template_definition_bindings` immutably maps each actual native template
edit version to its configuration revision/content/reference hashes. Immutable
draft ordinals are a separate sequence. This configuration-only mapping copies
no Run, actor, result or execution timestamp and cascades with its parent.

Creating a draft requires an existing Report template, exact sealed live version
and current CONFIGURE/scheduled_reports access. Editing creates another immutable
revision, with exact header version and source-head CAS. A draft creation/edit
uses stable client UUIDs and rejects a UUID reused with a different author,
base/source version or definition. A replay reports its current saved head
rather than writing again. Suggestion adapters use server-issued UUIDs and keep
the native draft and Suggestion link/history in one transaction.

The current live version is `<template revision>:<digest>`; the digest includes
the native definition content hash and the current reference hash. References
are bounded typed metadata `{id,revision,segmentId,segmentRevision}` for each
saved view. Definitions contain configuration only, not metric result values.
Current Report and Explore configuration writers acquire the same canonical
guild scope before native locks, so validating a newly selected saved view
does not acquire a lower-ranked target lock after a Suggestion lock.

Preview compares the base active version/content/reference hashes and every
selected draft reference. It returns changed field names, both typed definitions,
explicit conflict codes and a hash binding the exact preview. Commit requires
that hash, draft head/version and current live version again. It uses the same
native template save helper and writes a minimal committed header receipt.
It does not create a Run, reschedule an existing schedule, or queue delivery.
Existing future reports use the explicitly committed template in their normal
native workflow. A committed draft cannot be edited/discarded; a new draft can
be made from the current template. Discarding an uncommitted draft physically
deletes its header and all its immutable draft revisions.

Every new public method checks current authorization proof, READ or CONFIGURE,
tenant binding, deletion state, current plan where writing, and proof expiry
again after waits and before transaction completion. Read access does not
require proposal approval. Native configuration hashes/identities do not grant
Rule action admission or target Safety. RulePlatform keeps those independent
side-effect gates and all initial actions remain REVIEW_ONLY.

The page is `/reports/definitions` with Japanese/English fields and previews,
permission/plan/empty/error states, unsaved-change/back/discard confirmation,
an explicit commit confirmation and synchronous duplicate-submit guard. A lost
mutation response blocks further mutation and offers a read of the saved state;
the client never automatically resends it. The BFF is
`/api/report-definitions/[...path]` with no-store, current guild binding,
same-origin/CSRF protections and exact If-Match binding:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | templates | Existing templates, native draft headers, permitted saved-view labels and capabilities |
| GET | templates/:UUID | Current typed native definition/binding |
| GET | drafts/:UUID | Current immutable draft head |
| GET | drafts/:UUID/preview | Exact comparison/confirmation hash |
| POST | drafts | Create immutable draft; If-Match is the sealed live version |
| POST | drafts/:UUID/revisions | Append immutable edit; numeric If-Match |
| POST | drafts/:UUID/commit | Explicit native definition commit; numeric If-Match |
| POST | drafts/:UUID/cancel | Discard uncommitted draft; numeric If-Match |

Native configuration lifecycle applies: parent-template deletion cascades the
drafts/revisions, and cancellation deletes only uncommitted draft data. The
mutually referencing native head/revision FKs are deferred for one atomic
transaction. Whole-guild erasure removes Report Runs/reference holders before
parent templates and their cascaded configuration snapshots. The existing
operations audit purpose stores IDs/revisions/action only, not definition bodies.

Report generation evidence is separate from configuration lifetime. Added Run
columns `generated_at`, `generated_source_expires_at`, `definition_revision_id`,
`definition_content_hash`, and `definition_reference_hash` are supplied together
only for an actual successful generation with an exact native definition and
reference binding. A scheduled due/next time is never a past success timestamp.
Manual generation freezes the binding at request acceptance and compares it
again on completion; legacy/unsealed/mismatched bindings remain unconfirmed.
Its source expiry is min(actual success + 48 hours, original native result
expiry). It is never renewed by reads/retries. Scheduled generation follows the
same capture/recheck contract in its native worker. The nullable legacy path
preserves existing generation while withholding unverified evaluation evidence.
`purgeExpiredReportGenerationEvidence` clears the five added evaluation-binding
columns at their original expiry inside the existing scoped retention job;
it does not delete or extend the native execution history. Fact/source-health
copies still require their separate approved policy and earlier source expiry.
Confirmed delivery outcomes can use the original native Report Run/outbox
records within their own retention and the exact template-version binding;
they do not require or extend the separate 48-hour generation observation.
Legacy Runs without an exact configuration binding remain unknown.

Prepared integration cases cover immutable/native-pointer separation, allocator
compatibility, explicit commit/replay, stale CAS, current-proof/tenant rejection,
discard cascade and outer-transaction rollback. All tests, type checks, lint,
build, DB and UI execution remain unperformed pending the parent verification
gate. No results are asserted as passing.
