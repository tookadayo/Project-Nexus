# CASE input and current base-result sealing

The accepted evaluation transaction gathers trusted CASE adapter contexts before
persisting them. It derives `ruleTargets` only from the requested immutable native
Facts/source-health targets, and seals `targets` as the union of those native
targets and all selected CASE resources. A CASE resource alias cannot introduce a
new missing slot into the 13-rule evaluation. DATA/COMM and the other cross-domain
rules remain selected by their registered native target type when present; an
explicitly requested native batch with unknown/disabled inputs still fails.

`RuleInput.ruleTargets` is optional for legacy inputs and fixtures. When omitted,
the evaluator uses `targets` exactly as before and its canonical input shape/hash
is unchanged. New enqueues always include the independent, canonical target set.
Normalization verifies every native Fact/health target belongs to that set and
every rule target belongs to the complete envelope. Both sets enter the immutable
hash. Rule iteration, target budgets and COMM's requested base slots all use the
same set. The worker restores it from the accepted descriptor; it does not derive
it from current resources or replace it on retry.

After the final RuleInput is sealed, `evaluateRules` runs on that exact input.
`bindCurrentCaseRoots` matches each BASE_RULE_RESULT selector to one current
registered result with the same native target and exact microsecond window. The
saved CASE root receives this evaluation's actual decision, version and result
hash. Its observation values, source revisions, permissions, target and window are
not recollected or extended. Missing current base results reject admission with
`BASE_RULE_RESULT_NOT_AVAILABLE`; a past FIRE never supplies a current decision.
CASE contexts are persisted only after binding, followed by `platformInputHash`.
Consequently the context's base hash and the worker's current rule output agree.

The pipeline verifies current base identity, actual decision and hash for every
BASE_RULE_RESULT context. A matching NO_FIRE/INELIGIBLE/DISABLED root yields the
completed CASE result `INELIGIBLE / BASE_RULE_NOT_FIRED`; it cannot produce an
action. ACTION always requires current FIRE. Existing native missing/unknown input
and interrupted evaluation checks still stop publication. A sufficient NO_FIRE
retains its existing separate meaning for issue resolution; FIRE does not acquire
that flag by being used as a CASE root.

The existing evaluation-key and enqueue routes accept optional
`requestedCaseIds`, a unique sorted array of CASE01–CASE20 with 1–20 entries.
With no native inputs/refs, an explicit nonempty selector is required. The server
still reads native operational contexts and source/profile state internally;
there is no browser observation, permission, provenance or approval body.
Selector absence preserves the configured adapters' default CASE selection;
presence seals only those cases and rejects a missing selected context with
`CASE_CONTEXT_NOT_AVAILABLE`. Selection is included in prepared request identity
and the accepted job descriptor. Active-job request identity also binds the
existing actor hash; another actor cannot reuse a job before the selected CASE
permission check. No extra actor value or retention purpose is stored. Neither
the selector nor a compiled adapter
activates a profile or an initial REVIEW_ONLY action.

The first accepted enqueue owns native capture and the immutable evaluation clock.
An active duplicate returns the existing job before reading new native/CASE
values. Preparing a key for that existing request likewise clamps to its original
job/config expiry without recollection. New requests preserve current proof,
profile, CONFIG and source expiry gates. CASE persistence additionally clamps to
the adapter's original context/profile deadline, each original observation/source
expiry and the existing 48-hour evidence maximum. Reads, retries and copies do not
extend those clocks.

Source-only acceptance material:
`tests/unit/alpha16-pipeline-roots.test.ts` covers final-root hash binding,
current NO_FIRE, forged decision/hash rejection, independent case-only inputs,
missing current base and the finite selector boundary. No tests, type checks,
lint, builds, migrations, application logic or browser checks were executed while
preparing this change.
