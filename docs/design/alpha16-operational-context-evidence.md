# alpha16 operational CASE context: implementation and source limits

Source and synthetic test code only. Test/type/lint/build/UI/database/Discord execution count for this work is **0**. Additive migrations 077, 079, 080 and 082 have not been applied. Original specification files and the pre-existing next-env change remain protected.

## Server and authoring boundary

`operational-context-contract.ts` defines finite staff checklists, explicit typed profiles and strict source descriptors. `operational-context.ts` provides guild-scoped catalog/detail/options/create/edit/delete, prepared communication identities, exact body fingerprint/CAS, first-capture expiry, and `createOperationalCaseRuntime(db,scope,actor,proof)`. `/rules/context` and `/api/rule-context` use current server authorization, displayed guild, CSRF and If-Match. GOVERN is required for authoring/profile activation. Existing READ/ANALYZE/GOVERN still protect distinct read surfaces and restricted moderation data. No permission is added.

Storage permits up to 100 current resources, including multiple resources for the same case. An evaluation selects at most one resource per case and twenty cases. `requestedContextIds` is an explicit bounded selector; `requestedCaseIds` alone with multiple matching resources returns `CASE_CONTEXT_AMBIGUOUS`. There is no latest-one-wins selection. CASE09 can refer to another existing same-guild request resource. Arbitrary or other-guild references remain invalid. The DTO declares `ONE_SELECTED_RESOURCE_PER_CASE_PER_EVALUATION`.

Options verify current native identity/version/visibility. CASE17 uses canonical PERMISSION as an alias for its native report-channel ID/version. CASE01 uses ONBOARDING_FLOW. Logical staff resources use their context UUID and CAS revision. A staff label cannot establish actual permission, cohort membership, a measured count, personal preference or asker outcome.

Prepare validates the bounded intent and creates a server communication key. Actual POST reads current request/target state under the canonical scope lock, closes that transaction, completes optional Discord metadata reads, then opens the final scoped transaction. The fresh DB clock after those reads, identical target/window intent, current proof, plan and native binding are checked before capture and every write. A completed key returns before any new probe; a missing key never starts a mutation. Native CAPTURE and common EAV/context writes commit together using deferred foreign keys. VALIDATE performs no writes or Discord reads. An unknown HTTP outcome uses request status; the UI does not automatically resend.

The same plugin instances survive outsideTx to CAPTURE, including their opaque in-memory metadata seals. Runtime uses separate instances in VALIDATE mode only. The factory retains its four-argument signature and reads bounded profiles under current proof; it does not collect native facts or call Discord. Enqueue reads selected contexts in its transaction, then the common service seals current rule targets separately from case targets and binds the current base-rule result/hash. Historical FIRE registration is not relabeled as a current result. FIRE uses !partialCoverage and unexpired actionableUntil, not the NO_FIRE-only sufficient flag.

## Provenance, retention and cancellation

077 context/profile/communication records are capped at original first capture +48h. Earlier source, capability and visibility expiries win. Updates, retries, reading and profile enable/disable do not extend the ceiling. Exact UTC microsecond windows and scalar timestamps survive reconstruction. Decimal/count/cohort values use the shared typed codec. Per-field source metadata retains source kind, original reference/revision, observation/expiry, business window, period role, metric and cohort contract. A server-only captureExpiresAt passes the validated parent ceiling to native child captures.

Missing input is UNKNOWN with NULL value and NULL provenance. Existing PARTIAL/UNKNOWN source observations retain their quality. Original unsupported source IDs remain unconfirmed; separate .operator/.native mappings identify implemented readers. Runtime confirmation additionally requires actual current captured data. An implemented reader with insufficient history differs from a nonexistent source or an unconfigured profile. Budgets, thresholds and cohort minimums are explicit typed GOVERN configuration. Fixture thresholds are never adopted.

VALIDATE compares native current binding/hash/ref/value/quality/window to the captured observation and returns original clocks. Change/deletion yields UNKNOWN, rather than replacing a sealed input with a fresh aggregate. A new SQL aggregate has a legitimate one-time capture clock; validation cannot move it. Profile seals include case/version/hash/createdAt/original expiresAt to prevent expiry/recreation ABA.

Profile revision/disable cancels unfinished jobs for that case. Resource revision/delete cancels jobs bound to that exact resource through sealed snapshots or explicit context selectors. A case-only fallback applies only without sealed references. Other resources/cases are not stopped indiscriminately. Existing worker final CAS honors CANCEL_REQUESTED without input substitution or expiry extension.

Actor privacy runs source hooks before original subject data is removed. Role-only 079 metadata has no person dependency. The 01-12/13-20 aggregate readers cannot prove independence from a deleted subject, so their native snapshots are conservatively purged. Common cleanup removes corresponding source descriptors (including anchor/review references) and copied EAV values, revises context hash/version and cancels affected unfinished jobs. Unrelated finite OPERATOR shared fields and role-only metadata survive. Guild purge and expiry call plugin cleanup too. Minimal audit records reuse the separate fourteen-day purpose and contain action/target/version only.

## Connected fields

Exact staff fields are exported as OPERATOR_CASE_FIELDS and native fields as NATIVE_CASE_FIELDS. Staff values include access expectations, coverage/availability, resource purpose/clarity, role ownership/status/canonical references, accessibility checklists and restricted queue policy. These are OPERATOR declarations, not measurement guarantees. CASE20 postingActivity is the formal staff-confirmed enum; no numeric low-activity threshold is invented.

|CASE|Native fields and exact source contract|
|---|---|
|01|onb.actualAccess: representative-role channel access, native onboarding destination/flow/version. No member role composition is inferred.|
|02|welcome.humanStaffReplyCount, welcome.botReplyCount, welcome.nextDestinationConfigured: explicit root messages, onboarding purpose/window, native reply-reference coverage, staff/bot metadata and current native flow destinations.|
|03|Prepared native Attention issue-clock reader only. Current intake-policy roots have no exact issue relation; support.unansweredAgeSeconds remains UNAVAILABLE/UNKNOWN.|
|04|Prepared same-native-Attention-issue reopen reader only. Current intake-policy roots lack the exact relation; support.sameTopicReopenCount remains UNAVAILABLE/UNKNOWN. No topic/body inference.|
|05|cohort.newCurrent/newPrior/establishedCurrent/establishedPrior: four comparable maturity cohorts, permitted production membership/signals, exact calendar/elapsed windows and coverage.|
|06|event.scheduled: exact native upcoming scheduled event. Historical attendance is not a schedule.|
|07|format.comparableParticipationState: dedicated purpose/window-comparable attendance contract with explicit minimum. It does not establish preferredFormat.|
|08|activity.integrationErrorCount: finite current native integration-component-error contract.|
|10|channel.actualAccess and channel.messageCount: role metadata and exact permitted human-post population/window/full coverage.|
|11|event.repeatPoint and event.repeatSourceContract: dedicated EVENT.REPEAT_WINDOW_V1 prior/current native event participation projection and cohort/calendar metadata.|
|12|announcement.mentionCount: distinct role/everyone targets from genuine native publication metadata. It is not recipient count, individual user mentions or repeated text tokens. Missing old metadata stays UNKNOWN.|
|13|actionableCount/noiseCount: explicitly classified retained native Attention review set, restricted staff scope and original references. Not an arbitrary Discord report inventory.|
|14|queueLoadCount, oldestOpenQueueAgeMinutes, assignmentConcentrationState/Numerator/Denominator: native queue and verified role or finite duty buckets. No personal workload score.|
|15|ruleId/ruleVersion/reviewSetRef/staffFpCount/totalReviewed/triggeredRuleCount/configuredLanguage: immutable native AutoMod execution-event review set. Internal registry revision/language are explicit OPERATOR configuration, not observed current Discord rule configuration. Review units are execution events, not people or bodies.|
|17|reportChannel.actualPermission: current role-only channel overwrite/effective-access metadata. Member overwrite uncertainty gives UNKNOWN; private IDs and allow/deny bits are discarded.|
|19|postingAggregate: exact retained channel/public-thread posting population with full coverage. It says nothing about viewing/readership.|
|20|channelType/archiveState/locked: current capability/surface metadata. lastReplyAt: complete retained direct-text/public-thread reply metadata. Forum-container census limitations stay explicit.|

Factories are createCase01To12SourcePlugin (operational-case-01-12-sources.ts), createRoleAccessSourcePlugin (role-access-source.ts), and createOperationalNativeContextPlugin (operational-context-native.ts). operational-context-plugins.ts is the closed server registry. Browser input selects a known descriptor with strict configuration; it cannot add a reader or submit observations. Source-specific evidence is maintained by the owning agents.

## Genuine missing sources and coverage limits

|CASE/field|Reason for UNKNOWN; collection boundary|
|---|---|
|02 welcome.noContact|No authorized subject-specific preference binding for this shared resource. Staff cannot speak for a member; no new individual tracking is introduced.|
|03 support.askerOutcome/support.unansweredAgeSeconds; 04 support.askerExplicitOutcome/support.sameTopicReopenCount|No structured asker-confirmed outcome or exact intake-policy-to-native-issue response/topic relation exists. Staff-resolved state, unrelated Attention IDs and content are not substitutes. New personal response collection needs a concrete separate decision.|
|05/08 activity.optInInterest; 07 format.preferredFormat|No compatible explicit voluntary-interest/preference source. Attendance/staff opinion cannot establish personal intent. No survey/member preference collection is invented.|
|16 platformAlertType|Raw incident timestamps do not establish current RAID_ALERT/SAFETY_ALERT/NONE state. No exact active-alert source exists. The original source stays unconfirmed; staff-confirmed incident inputs remain separate.|
|19 authorizedAggregateViewing.stabilityReview/sourceAvailable|No authorized aggregate viewing source. Posts cannot establish viewing/readership. No per-reader tracking is added.|
|20 lastReplyAt on a forum container|Complete archived-thread census is unavailable. Direct text/public-thread readers exist; partial forum metadata cannot certify latest reply or never-replied state. CASE20 capture covers the retained tail through server asOf. Validation preserves that tail and also checks later real post metadata; new posts invalidate the source instead of preserving a stale latest-reply value.|

CASE03/04 currently inherit HELP_INTAKE_POLICY UUID roots, while native Attention issue observations have a different snowflake grain. No exact native request-to-response/topic relation exists. The issue reader is implemented, but an unrelated issue cannot be mapped to that policy to claim source completion; these current roots remain UNKNOWN for unanswered/reopen/outcome fields. Their operational enablement is separately closed with CASE_ISSUE_TARGET_SOURCE_UNAVAILABLE so staff-only branches cannot produce a fake ISSUE_TARGET recommendation. Disabled finite drafts can still be saved. Existing or malformed enabled 03/04 profiles are excluded from active runtime profiles; their source-readiness status does not block unrelated cases, current reads or request status. CASE06/07 separate the EVENT_PROGRAM root locator from the actual native EVENT recommendation target. Current definition.eventIds membership, native event ID/version and the same root/window seal are verified; the program UUID is never presented as a Discord event ID. See [native source evidence](alpha16-case-native-sources.md) for the source-specific policy/coverage contracts.

Other reader outputs can remain UNKNOWN when their exact native population, clocks, retained history, native publication fields, current binding or full coverage are absent. That is an explicit data limitation after reader implementation, not an observed zero or a profile-approval blocker.

## Verification preparation and current execution

Unit code covers split source registration, forbidden manual measured/personal fields, strict descriptors, finite checklists and explicit budgets/units. Integration code covers UNKNOWN/provenance, multiple resources/ambiguity/CAS, original expiry, typed capture, outside-TX reads, proof expiry after probes, exact replay, cancellation and privacy cleanup. Source-specific 079/080/082 tests cover their native contracts. Context e2e code covers Japanese/English, permission/communication/empty/stale states, source forms, cancellation/back, double-click and unknown-result behavior. Those were the prepared checks at the source-freeze stage. The later parent-authorized verification is recorded below; prepared coverage alone is not treated as a passing result.

On 2026-10-16, the dedicated offline eight-spec browser suite passed **85 tests**, including **18 context tests**. The CASE cooldown metadata is wired from the registered per-case configuration field to a Japanese/English label and positive minimum without adopting a default. The successful wire test uses 60 seconds explicitly as synthetic input; the integration profile helper uses that value only for CASE18. Contract/unit verification by its owner passed 267 related tests. These results do not enable any operational profile or add collection/permissions. See [browser verification](alpha16-browser-verification.md) for commands, limitations and artifacts. DB execution remains with the integration coordinator.
