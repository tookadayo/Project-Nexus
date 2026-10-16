# Typed disabled rule configuration drafts

The existing `/rules/config` workspace can start an empty definition or copy a
saved definition into a typed form. It covers all 13 rules, their native common
and optional fields, calendar/elapsed cooldown, exact count/decimal inputs,
finite evaluation budgets and registered source-type selection. New input values
remain empty until entered; no placeholder, measured operating value, approved
retention or current source authority is supplied by this page. Existing saved
values are copied visibly. Fixture-only comparison policy cannot be silently
converted to an operational comparison; the operator must choose explicitly.

Client modules import only server type definitions. GET catalog adds the existing
registered source-type string metadata; this is not source registration or
operating approval. The form builder bounds and canonicalizes integer/decimal
text without losing signed-64-bit counts or the native 18 fractional digits.
The server remains the authoritative schema/permission/retention validator.

Saving prepares the existing CONFIG_REVISE request identity, then sends the same
payload to POST `/api/rules/config/revisions` with quoted current-head If-Match.
`configVersion` is exactly current head + 1. Every generated definition is
OPERATIONAL / DISABLED / retentionApproved false. Saving creates a DRAFT and does
not retire or replace ACTIVE, approve a source, publish a proposal or enable an
external action. Existing separate Govern activation/retirement controls remain
unchanged; activation still obtains a server-verified measured profile and
creates its approved successor through the native service.

The workspace uses Japanese/English labels, current CONFIGURE permission,
unsaved-change confirmation for cancellation/back/refresh, read cancellation and
a synchronous shared mutation fence. A request with an unknown outcome stops
further mutations and requires read/reconciliation; it is never automatically
resent. Empty history still offers an explicit blank disabled draft. Read-only
users can inspect saved definitions without receiving write controls.

Prepared unit acceptance source is
`tests/unit/alpha16-rule-config-editor.test.ts`. Test, type-check, lint, build,
migration, application and browser execution were not performed.
