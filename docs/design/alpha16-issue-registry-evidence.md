# alpha16 explicit issue registry and native evaluation capture

Source changes on `codex/alpha16-rule-platform`, 2026-10-16. Nothing in this document is an execution result or an operating approval.

## Explicit mapping, not inferred absence

Migration 076 adds `rule_issue_registry`: a versioned, finite declaration connecting one retained base Rule target to existing experiment and Playbook identifiers. `RuleIssueRegistry` checks current READ/CONFIGURE, the selected guild, current maintenance proof, deletion requests, CAS, native inventory hashes and existing feature permissions. The Web entry is `/rules/issues`, through the narrow `/api/rule-issues` BFF.

A missing mapping, an unassessed empty list, a changed native inventory or an expired declaration remains UNKNOWN. ABSENT requires the authorized operator to declare the relevant census complete. A current running experiment or ACTIVE Playbook can establish presence without claiming that its outcome caused an improvement. Missing experiment controls follow the existing native running-state contract; they do not establish relevance to an issue.

The declaration lasts at most 48 hours from the explicit write. Reading it does not renew it. It contains resource identifiers and bounded configuration, with no message bodies, subject identifiers, Run payloads or copied evaluation history. The normal minimal operation audit is separate and lasts at most 14 days.

## Three exact retained periods

`STRUCTURED_ISSUE_PERIODS` requires three explicitly supplied, consecutive half-open windows and the exact registered base Rule, target and live version. The reader uses only retained SUCCEEDED evaluation results with sufficient FIRE/NO_FIRE observations for those exact windows. Missing, expired, ineligible or ambiguous results remain unavailable. It does not count Suggestions as observations or introduce a long-lived recurrence-history table.

The derived Fact deadline is the earliest registry, source result and parent job deadline. Original observation times are retained. Generated source-health identifiers bind the scope, source revision, original observation and target; rereading the same observation cannot create a fresh identity or extend its expiry.

## Initial evaluation transaction

The closed `nativeInputs` descriptor contract permits resource and window selection, never browser-supplied Facts, SQL, source observations or approval flags. A first accepted enqueue captures native sources at that transaction's evaluation time before sealing the input. A duplicate request resolves its original job before any recapture. A prepared request key validates its descriptors and expires within 30 seconds; it does not create an earlier evaluation snapshot or reset a pending run's observation clock.

An UNKNOWN or DISABLED requested native source blocks that requested Fact batch. The separate read-only source-health observation endpoint can still explain partial or missing observations without persisting a fabricated healthy source or creating an evaluation.

## Prepared verification

`tests/integration/alpha16-issue-registry.test.ts` and `tests/unit/alpha16-native-enqueue-contract.test.ts` contain synthetic coverage for incomplete versus complete empty declarations, changed inventory, exact periods, expiry and strict descriptor boundaries. They have not been executed. Database migrations, tests, type checking, lint, build, browser checks and real operational settings are all NOT_RUN under the user's implementation-first order.
