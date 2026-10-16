# alpha16 PC worker composition

Source only, 2026-10-16. The existing `scripts/dev.ts` maintenance loop now calls the new `Alpha16PcRuntime` global and scope passes. The default construction is unconfigured: it performs no new Rule database work and does not stop the existing alpha15 loop.

An explicitly injected trusted `Alpha16PcRuntimeOptions` supplies a finite, expiring supervisor profile, Operator startup/deletion maintenance, retention enforcement and the existing `RuleWorkerOptions` live authorizer. No browser payload, fixture profile or environment boolean can substitute for those dependencies. The release does not install a concrete operating provider or generate measured values.

The configured scope pass invokes deletion and scope retention under their separate purpose gates, then checks generation readiness before selecting at most the configured 1–100 queued/cancel-requested/expired-lease Rule jobs. Disabling generation does not stop independently approved retention/deletion. A failure in either maintenance hook cannot prevent the other hook from checking its own readiness. Each job still enters the native `RuleEvaluationWorker` claim/current permission/config/input hash/lease/finalization boundaries. The supervisor profile is rechecked for each job and clamps both live authorization proofs to its original deadline. This is pure evaluation; the supervisor has no Discord send or external Apply adapter. It does not manufacture successful job outcomes when a dependency fails.

The global/scope maintenance stage runs on its own ten-second cadence before the legacy consumer/billing/worker try block, outside the old `betaWork` session read fence and Beta admission skip. A legacy failure cannot skip this stage. This avoids attempting exclusive deletion or canonical scope locks while holding a different connection's shared privacy fence. The default unconfigured stage performs no new database work or scope-discovery query.

Scope retention finalizes existing CANCEL_REQUESTED evaluation jobs as CANCELLED under canonical locks, without changing input or expiry. This does not require an ACTIVE generation configuration or current generation profile, so retiring/replacing a configuration cannot strand its cancellation requests. An in-flight pure evaluator loses its lease/state authority and cannot publish afterward.

A second isolated integration fixture prepares a cancellation on a RETIRED
configuration, then asserts terminal cancellation, lease removal, unchanged
expiry and zero added attempts. This fixture has not been executed.

The supervisor profile explicitly bounds jobs per scope and the number of tracked scope cursors. A bounded in-memory `(created_at, job_id)` cursor advances before processing and wraps after the end, so a permanently unavailable prefix cannot monopolize every pass. A full scope capacity reports `PC_RULE_SCOPE_CAPACITY_REQUIRED` rather than evicting another active scope's progress. Cursor expiry is no later than its selected job or original supervisor deadline; it stores no actor, body, result or new durable history. Changing generation configuration cannot extend a captured cursor or reauthorize a job. An isolated integration fixture covers repeated failures and wraparound; it is authored only.

The global pass exposes publication retention/withdrawal readiness separately. An unknown publisher outcome does not become a common approval gate for recommendation READ or unrelated evaluation. Physical retention and deletion while the PC is stopped are not claimed.

Alpha17 must supply the actual measured/approved host dependencies at this constructor, verify startup/restore ordering and run the consolidated acceptance checks before enabling it. This is an explicit source integration point, not a completed operational deployment. Unit cases are authored in `alpha16-pc-runtime.test.ts`; tests, types, lint, build, SQL and process execution remain NOT_RUN.
