# N16-08 native rule source implementation evidence

Source/fixture code prepared 2026-10-16 in the existing Windows checkout. Tests, typecheck, lint, build, DB/migration, browser and Discord execution: **NOT RUN**. No deployment, credentials, live configuration, collection or operational approval was activated. Formal source files are unchanged.

## Entry and boundaries

native-source-request.ts is the pure strict schema for **14 descriptor kinds**. It accepts no Facts, raw source payload, body, SQL/code, arbitrary event name or approval flag. native-projections.ts dispatches the closed set; SOURCE_ADAPTER_CATALOG and NATIVE_SOURCE_READERS list 14 distinct source contracts. PERMISSION_REQUIREMENTS covers both requirement-registry and permission-observation sources, while REPORT uses two independent descriptors.

RulePlatform.snapshotNativeSources and the parent first-accepted nativeInputs enqueue share the reader. The acceptance transaction seals evaluationAsOf/config/observations/refs once; AUTO-002 projects at that exact asOf. Duplicates reuse the saved job. A business batch with UNKNOWN/DISABLED members returns no partial input set.

Native query compatibility is not operational approval. Current approved OPERATIONAL config/source registration plus independent retention/budget/visibility approval remain required for persistence/evaluation/publication. Defaults stay disabled. Fact units come from METRIC_CATALOG rather than a shared COUNT fallback.

## Exact reader/source/health map

| Descriptor | Implemented native reader and source | Exact remaining condition |
| --- | --- | --- |
| ONBOARDING_FIRST_ACTION | native-cohort-projections.onboarding: flow_sessions case, completion AND matching pinned activation.completed within case start/next restart/maturity. Maturity-end assigns the calendar window. | Current native flow helper version, production eligibility, tombstones, retained interval, epoch/gap/intents. First-action conditions needing unrecorded historical REST/role absence remain UNKNOWN; current roles do not prove historical absence. |
| HELP_BACKLOG_COHORT | help: current panel revisions, strict SLA definition, intake created in CURRENT and SLA-mature at asOf, one latest structured row per intake. Does not read fields_ciphertext. | **Missing numerator source:** native first_response_at and explicit STALLED are absent. ACK/acknowledged_at and IN_PROGRESS/updated_at are not answers/stalled observations. Numerator null; HELP_FIRST_RESPONSE_AND_STRUCTURED_STALLED_SOURCE_UNAVAILABLE. Eligible-cohort SQL and config CRUD are implemented. |
| ENGAGEMENT_CONTINUATION_COHORT | continuation: previous unique eligible identity cohort intersected with current participants using selected existing structured signals/channels. Newcomers are excluded from the previous denominator. | Two contiguous calendar windows within detail retention and current policy/scope. Identity sets stay inside SQL and are not saved. |
| CHANNEL_PARTICIPATION_COHORT | participation: unique target-channel participants / unique eligible participants in the same configured guild channel population. | Current nonstaff scope/fresh observable surfaces and immutable capability snapshot ID + channel structure hash as native target version. Never source-head ordinal. Retained previous elapsed seven-day periods are supported. Topic/editor fields not collected are not inferred. |
| EVENT_RSVP_ATTENDANCE_COHORT | eventParticipation: confirmed Discord subscription at event start intersected with same-event observable voice/stage attendance. Latest unsubscribe and unmatched attendance excluded; cancellation/maturity and eligible event count checked. | Original detail retention and created/started/completed metadata. A previous 28-day period requiring 56 days of detail stays UNKNOWN under existing 7/14/30-day retention. No new personal cohort/long-term source is added. External attendance stays unknown. |
| AUTO_RUN_OUTCOMES | Current revision native Run outcomes, one Run once; COMPLETED maps to SUCCEEDED. UNKNOWN/approval waits/cancelled/expired stay separate. Native authoring/active/generation/state helper supplies target version. | Retained census, privacy gap and terminal consistency; original deadline/terminal +7d wins. Unproven seven-day purge boundary is UNKNOWN. Actual native status timestamps supply business ingest, not heartbeat. |
| AUTO_EXECUTION_OBSERVATION | native-execution-permission-projections: Run unit, 075 authoritative due/deadline/terminal and explicit worker heartbeat, future waits excluded, expected/observed counts separate. | Explicit approved grace config and retained source/census. Legacy missing observations/unknown outcomes lower coverage. No scheduler lease or generic updated_at is a heartbeat. |
| PERMISSION_REQUIREMENTS | Same module: current enabled native requirement registry/epoch matched to saved capability observation after that epoch. Observation + registry health paired. | Uncollected channel send overwrites, role hierarchy and ownership stay UNKNOWN; unknown is not DENY. Current version/invalidation/freshness/source-expiry checks remain. |
| REPORT_DELIVERY | native-report-projections: schedule locator resolves native immutable template; 071 template_revision-to-definition binding validates each Run, then confirmed original outbox/webhook states. | Original record presence/retention and exact template/content/reference binding. Missing outbound is UNKNOWN. Generation failure is not delivery failure, and expired generated_* observation does not erase an independently retained delivery result. |
| REPORT_GENERATION_STATE | Same module, separate point observation using actual generated_at/source-expiry/definition ID/content/reference hash. | Legacy/missing/expired generation provenance is UNKNOWN. Scheduler due/next_at is only planned time; next_at/completed_at never become last successful generation. A separate delivery-only request remains possible. |
| STRUCTURED_ISSUE_PERIODS | issue-registry: explicit nine-base-issue/target binding and three retained authoritative base Rule result periods. | Exact versions/period lengths/real result state/refs/expiry. Never Suggestion counts or fabricated absent history. |
| EXPERIMENT_STATE | Same registry + current native experiment control/census. | Exact mapping/census required; no rows or unrelated experiments do not mean ABSENT. Original observation clocks and earliest source expiry. |
| PLAYBOOK_STATE | Same registry + explicit issue-to-native-playbook coverage/census. | Enabled unrelated playbooks are not coverage. Typed state/version/expiry only. |
| DATA_SOURCE_HEALTH | Exact immutable health ID/revision/hash/effective-expiry reuse. | Missing/expired ref remains UNKNOWN. Health existence never creates a business Fact value. Independent native health read exposes actual unknown/partial observations without publishing partial business metrics. |

HELP needs authoritative request-bound first_response_at and an explicit structured stalled state/outcome, with observation revision/asOf and retention provenance. It must not be populated from ACK, elapsed time, body classification, staff message scans or an unobserved external reply. The precise data/collection gap is reported to the parent; the reader/config/schema portion exists and closes only that metric.

### HELP existing-source cross-check

The 2026-10-16 follow-up with the CASE native-source owner confirmed that the
available response clocks do not share the intake grain:

| Existing source | Exact native identity/semantics | Why it cannot supply this intake numerator |
| --- | --- | --- |
| `operations_requests` and its attention item (`packages/operations/src/intake.ts:311`, `:331`) | The native writer creates `attention_key = 'intake:' + requestId`, `channel_id = ''`, `item_type = OPERATIONS_REQUEST`, `target_surface = INTAKE_FORM`. | This is a submitted form identity, not a Discord message snowflake. |
| `location_post_observations` (`migrations/047_channel_scope_observation.sql:8`) | Real Discord message/channel/sentAt, authorKind, referenceId and firstReplySeconds. | Neither messageId nor referenceId is an authoritative binding to the synthetic intake key. Matching channel/time/actor or a notification category would change the grain. |
| Observed-response attention path (`packages/operations/src/attention.ts:183`, `:197`) | `detected_at` is the native message event time; observed response resolves only TEXT_NEWCOMER/FORUM_SUPPORT/LFG_RESPONSE by that same message ID. | OPERATIONS_REQUEST is expressly outside this path. `resolved_at` is projector/update time, not an intake first-human-response timestamp. |
| Intake Discord notification (`packages/operations/src/intake.ts:349`; `apps/worker/src/actions.ts:416`, `:459`) | Send returns the actual published message ID. The worker persists that ID only for INTAKE_PUBLISH panel publication. | INTAKE_NOTIFY does not save an intake-request-to-notification-message binding. An outbox requestId/dedupe key alone cannot recover the confirmed Discord message ID. |

The CASE owner additionally identified that the pre-081 BOT/Webhook event branch
did not emit referenceId; the existence of a reference column therefore did not
prove complete Bot-reply coverage. The new source-metadata contract described in
`alpha16-source-metadata-evidence.md` repairs new packets prospectively, retaining
NULL for old queued/projected rows and requiring actual protocol/window coverage.
This does not create an intake-to-Discord-message binding. No
missing row, ACK, IN_PROGRESS or unrelated answered Discord post becomes an
unanswered/answered intake value.

Completing this source would require an explicit native response contract:
request-bound actual first-response time and structured STALLED revision, or an
authoritative confirmed request/message binding with an approved definition of
which observed human reply answers that intake, together with observation and
source-expiry provenance. This follow-up added no collection, binding schema,
response action or operational value for HELP. The prepared HELP fixture now uses the
real synthetic native key and includes an unrelated replied-to Discord post,
which must not change the null numerator.

## Configuration and current access

073 adds non-personal immutable rule_native_cohort_revisions plus CAS heads, under existing CONFIG purpose and explicit policy. Strict definitions pin flow/first-action revisions, panel versions/SLA, existing participation signals/channels, channel population/native observation version, or explicit event program. No member lists are saved.

ONB targets use onboardingFlowTargetVersion, CHANNEL uses nativeObservedChannelVersion, and HELP/RET/EVENT use the immutable 073 policy head version. Detached drafts are not live sources. Shared MAX ordinal allocation/baseVersion/draft-parent replay support is supplied by the draft writer owner.

GET /api/rules/source-config, UUID detail and /options require READ with current OAuth/Bot scope proof. They expose non-personal config/visible native IDs/versions only. POST revisions/UUID-disable requires CONFIGURE, same-origin/displayed-guild, If-Match and Idempotency-Key exactly equal to the client immutable revision UUID. canConfigure is from existing actor permissions. No approval switch is created. Actual metric/source-health reads remain ANALYZE. The UI/contract owner connects /rules/sources and the exact BFF boundary.

## Clocks, retention and health

**Fresh native aggregation differs from copying a Fact.** A new authorized SQL query over still-retained original records observes at the accepted DB asOf and makes a snapshot for at most 48h, clamped by the earliest original detail/Run/outbound/config deadline. Historical period end and last business ingest are not creation clocks. This supports retained previous-period comparison. Existing Fact/health references keep their original observation/hash/effective expiry; reading/copying/retrying a ref never restarts its deadline.

Gateway-derived HEALTHY assessments require historical epoch/gap/intent coverage and a current CONNECTED source with a real heartbeat within the existing 90s observation contract. lastSuccessfulIngestAt stays the actual relevant native business timestamp; SQL success never replaces it. Missing first success stays null/unknown. Generated health uses immutableSourceHealthId(scope,sourceType,revision,observedAt,target); revisions include native target identity. The same accepted observation replays with the same identity and expiry.

observeNativeSourceHealth and read-only POST /api/rules/source-health/observations return real headers/diagnostics with persisted:false, even when business Facts are unavailable; they do not save or enqueue. The explicit internal snapshotNativeSourceHealth requires approved SOURCE_HEALTH/config/source visibility, preserves clocks/expiry and creates distinct per-source+metric DATA targets using a stable metric/source/native-target hash. Partial availability is explicit, never labelled a complete business batch.

075 observation expiry has a parent Run-owned non-extending marker. Independent observation purge cannot be reversed by later status/terminal edits or a heartbeat. The marker contains no body/value/actor and disappears with the existing parent Run. No observation is backfilled or extended; the retention owner connects due-row purge to the canonical scope-fenced sweep.

## Prepared validation — all NOT RUN

- alpha16-native-projections unit source: outcome identity/state separation, 14 source reader entries, strict descriptors.
- alpha16-native-cohorts unit/fixture source: five strict definitions, native version pins, 167/169h calendar DST versus elapsed periods, zero denominator/intersection, first-action completeness, separate Report point descriptor.
- alpha16-native-cohorts isolated-PostgreSQL source: ONB same-case AND/maturity; RET unique intersection/TEST exclusion/gap; ENG matched population plus retained previous period/current visibility; exact HELP missing-response closure; EVENT same-RSVP attendance/unsubscribe/unmatched attendance/expired previous detail.
- Runtime/permission unit/DB fixture sources include explicit heartbeat and an expired observation followed by independent purge, two terminal edits and heartbeat without resurrection.

No test result is claimed. Existing alpha15 partial/not-run and historical timezone pinning caveats remain unchanged.
