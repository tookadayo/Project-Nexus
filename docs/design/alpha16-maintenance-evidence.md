# Saved operations maintenance implementation

Source additions are `packages/operations/src/{maintenance-authorization,alpha16-audit}.ts`, new guarded methods in events/intake/intervention-review, migration 066, `/api/operations-maintenance/[...path]`, and `/operations/maintenance`.

The PC BFF obtains current Discord membership through `operationsContext`, checks the displayed guild and same origin, and receives CSRF enforcement at the default-deny Web proxy. Mutations require `If-Match` and a strictly parsed domain version. New domain operations recheck the server-issued authorization proof after locks. Input identifiers never select another user's scope. Existing role and plan checks stay inside each domain.

The screen has Japanese/English labels, typed inputs, cancellation/back links, a native modal with focus restoration, and an in-flight guard. It separates saved report generation from Discord delivery. A lost rotation response cannot re-expose a secret or issue an automatic replacement. Webhook URLs require explicit re-entry and only their origin is shown. Report artifacts and before/after observations use the existing chart renderer, with no causal claim.

Request erasure removes encrypted submitted fields and the participant reference. It cancels queued/waiting automation correlations and does not synthesize a ticket outcome. External delivery uncertainty is retained in minimal safety metadata; source deletion does not authorize a resend. Panel removal does not delete already published Discord messages. Referenced teams/templates/destinations and unresolved operations are guarded rather than cascaded away.

The privacy path now includes new Rules/CASE, personalization, manual report and lifecycle request data. Explicit references to an erased member in copied template definitions are removed with their prepared requests. Expiry maintenance is implemented with a disabled-by-default profile and startup reconciliation prerequisite; it is not scheduled or activated by importing the module.

Authored verification includes `alpha16-maintenance-authorization.test.ts`, isolated-Postgres `alpha16-maintenance.test.ts`, and Japanese/English `alpha16-maintenance.spec.ts` (empty state, narrow screen, permission/network error, stale version, cancellation, focus restoration and repeated click). At the time this source record was written, all execution verification remained NOT_RUN under the requested implementation-before-testing order. Actual results belong in the consolidated validation ledger.
