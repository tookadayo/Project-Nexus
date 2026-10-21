# alpha16 CASE13–20 implementation record

Status: CASE13–20 registry and synthetic acceptance code implemented; no tests, type checks, lint, build, migrations, or environment checks have been run for this work. This record concerns code and synthetic fixtures, not operational enablement.

The immutable source package is in `alpha16-source/`. The read order was README → migration plan → contract decisions → decision gate → design index, then IV-0, IV-D source copy, IV-E, V-A, V-B, VI, and the operating-case research. The migration plan and contract decisions override superseded reference conditions. G1 implementation authorization comes from the user; the documents themselves do not supply that authorization.

## Scope and boundaries

CASE13–20 use `AUTHORIZED_OPERATIONAL_CONTEXT` roots. Every initial action is `REVIEW_ONLY`. No direct posting, activation, role changes, security changes, deletion, billing, or other external action is introduced by these definitions. Typed editors are not inferred from explanatory text.

Operational context requires registered source, current authorization, exact guild/target/version/window, immutable observation revision, observation and expiry times, approved retention and config, and sufficient input quality. A declared source ID is a contract identifier; it does not assert that a production adapter exists. Unavailable adapters and unapproved retention/config remain disabled. Missing input is never converted to a zero, false, or resolved state.

| Case | Typed input and source contract | Adopted correction |
|---|---|---|
| 13 | Authorized restricted queue aggregate, permission snapshot, structured staff review, explicit ownership and operating scale | Triage requires `actionableNoiseMixState=MIX_CONFIRMED`; rule ambiguity does not substitute for a confirmed mixture. All output is restricted. No report bodies are read. |
| 14 | Explicit duty availability/rota, queue aggregate, registered role/duty bucket assignment counts, responsibility review | Concentration is maximum open assignments in a role/duty bucket divided by all open assignments in those buckets. Zero denominator is undefined; source absence is distinct. No user buckets, rankings, online time, health or ability assessment. |
| 15 | Same immutable filter-review set, staff-confirmed false positives, reviewed total, unique triggered-rule set, feature-support review | Single-rule FP comparison requires supported feature, reviewed set, config minN, exactly one triggered rule, valid numerator/denominator. Multiple-rule review uses count ≥2. Candidate thresholds are not operational defaults. |
| 16 | Campaign register, explicit incident state, platform alert observation, temporary restriction and resolution metadata | ACTIVE first; then restricted alert confirmation; then resolved restrictions recovery; then planned campaign with explicit no-alert `NONE`. Alert alone never confirms an incident. No universal join-rate threshold. |
| 17 | Expected permission, observed permission, authorized privacy checklist, retention scope and aggregate status | Expected restricted versus actual public establishes the access mismatch. Public-by-design feedback alone is not a privacy violation. Output remains restricted. |
| 18 | Explicit content checklist, description and text-companion presence, separate essential-information equivalence, optional structured barrier report | Concrete reported barrier takes priority. Description presence does not establish equivalent information. No OCR, recording, transcript, disability inference or reporter identity. |
| 19 | Explicit purpose/task/entry-barrier review and authorized aggregate viewing availability/stability | Urgent task clarity precedes resource maintenance. A social entry barrier does not depend on unrelated viewing fields. Source absence is an analysis boundary, never zero readership. |
| 20 | Channel metadata, explicit tags/outcome, archive/lock metadata, buried-help and navigation checklist | Forum pilot begins in TEXT_CHAT with confirmed multiple buried help discussions. Existing FORUM gets navigation review. Old, archived and locked do not establish solved. |

## Explanation and provenance

Each selected leaf has Japanese and English slots in the order observation → branch reason → qualified hypothesis when applicable → one bounded action and owner → caution/alternative → review condition. Observations and action selection refer to the evaluated typed fields and branch path. The catalog does not guarantee improvement, infer member intent, or turn official guidance into a causal study or numeric benchmark.

The accompanying operating-case research, checked 2026-10-16, classifies all eight source patterns as official guidance or official product documentation. NEXUS branch conditions and proposed actions are separately marked design inference. No measured operational effect is claimed. The research supplied these canonical URLs; this implementation does not claim a fresh web verification.

| Case | Source | Research date information |
|---|---|---|
| 13 | https://discord.com/safety/creating-moderation-team-channels | Official moderation guidance, 2022-06-03 |
| 14 | https://discord.com/safety/understanding-and-avoiding-moderator-burnout | Official moderation guidance, 2022-06-03 |
| 15 | https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ | Official product documentation, updated 2026-06-15; external AutoMod may use machine learning |
| 16 | https://support.discord.com/hc/en-us/articles/10989121220631-How-to-Protect-Your-Server-from-Raids-101 | Official safety guidance, updated 2023-07-28 |
| 17 | https://discord.com/safety/confidentiality-in-moderation | Official moderation guidance, 2022-06-03 |
| 18 | https://support.discord.com/hc/en-us/articles/211866427-How-do-I-upload-images-and-GIFs and https://discord.com/blog/improving-app-accessibility-a11y-updates | Product guidance updated 2026-06-11 and accessibility blog 2022-07-07 |
| 19 | https://discord.com/blog/fostering-a-thriving-partner-worthy-community-on-discord | Historical guidance, 2020-12-03/2020-12-22; Partner requirements are not generic health thresholds |
| 20 | https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ | Official product guidance, updated 2024-10-24 |

## Deferred acceptance

`packages/rules/src/cases-13-20.ts` exports eight case definitions, 32 ordered branches/actions, English/Japanese explanations, source registrations and provenance. It also implements the bounded role/duty concentration and same-review-set/trigger-set aggregate adapters. Every operational source is explicitly unconfirmed and has no asserted production code path.

`tests/fixtures/alpha16-cases-13-20.ts` contains 32 corrected leaf fixtures, 88 safety variants and 13 edge/priority fixtures (133 total). Every fixture carries complete typed baseline observations, source quality and immutable revision, guild/target/live version, fixed enqueue as-of, declared window, fixture-only config profile and exact expected path/result/reason/action. The profile is explicitly synthetic and unapproved for production. The original CASE16 F04 is preserved as restricted alert confirmation; explicitly unreviewed incident context also enters restricted confirmation when no alert is present. Original CASE20 F01 is corrected to TEXT_CHAT.

`tests/unit/alpha16-cases-13-20.test.ts` encodes the fixture acceptance, deterministic input preservation, restricted audiences, separate aggregate budget, bilingual explanation/provenance checks, role/duty rather than person aggregation, zero denominator, count validation and trigger-set count consistency. Execution is deferred until the parent reports completion of all alpha16 implementation before consolidated acceptance. No fixture is an observed Discord result or a passing test claim.

## Rules dashboard implementation

The additional assigned UI lives in `apps/web/app/rules/page.tsx`, `view.tsx` and `rules.css`. The page uses the existing live `dashboardContext` authorization and then reads the same-origin `/api/rules` BFF. It displays the unapproved retention/config reasons, initial-catalog scope, alpha17 environment boundary, empty versus unavailable states, source readiness, suggestion explanation/history/expiry, and current server-granted action flags. Personal view/save/hide and shared rejection have separate confirmation wording. Mutations use the existing CSRF helper, displayed guild, a request key and the expected suggestion version for shared rejection; a synchronous lock prevents repeated clicks. Unknown mutation results have no automatic resend.

Draft, Apply and evaluation controls remain disabled in this release's UI because approved source/config and a typed target editor are not established. The UI does not invent inputs, prices, execution limits or plan entitlements. Block capabilities are described as shared; existing plan/billing surfaces remain the source for actual usage allowances.

`tests/e2e/alpha16-rules.spec.ts` prepares 14 synthetic browser acceptance tests for Japanese/English, 320px overflow, empty/disabled catalog, source scope, detail/action wording, back/cancel, repeated confirmation, CSRF/guild/version headers, unknown-result non-resend, permission/communication failures, stale detail, conflict and disabled-readiness enforcement. The fixture mounts the actual client component and intercepts BFF requests. It does not claim live OAuth, PostgreSQL, real Discord, browser verification or plan-pricing validation. These tests have not been executed.

The UI work read `apps/web/AGENTS.md` and the bundled Next.js guides for pages/layouts, server/client boundaries, fetching, CSS and async cookies before editing. The preexisting `apps/web/next-env.d.ts` change was not edited.

## Latest user clarification and integration mapping

The parent relayed the user's latest explicit direction: remove the approval-based presentation and clearly call the output a recommended response. This overrides any wording in the reference package that implies approval before viewing. `/rules` now says “推奨される対応 / Recommended responses” and directly displays readable responses under current READ authorization. It has no proposal-display approval workflow or approval-waiting state. `REVIEW_ONLY` continues to mean no automatic side effect. G3 governs new generation/persistence, not whether a current authorized user may read an existing response. Explicit controls for an actual change retain permission, scope, content/version and duplicate-safety checks. No guarantee or blanket liability disclaimer was added.

Semantic leaf targets map to the platform's existing canonical registry as follows. Input target IDs, current version and authority scope are preserved; no broader target or source is inferred, and source mappings remain unconfirmed.

| Case | Canonical target mapping |
|---|---|
| 13 | All queue and ownership leaves → MODERATION_QUEUE |
| 14 | Rota, load, backup and responsibility leaves → DUTY_BUCKET |
| 15 | Single-rule, mixed-rule and review-state leaves → FILTER |
| 16 | Security, recovery and campaign context → GUILD |
| 17 | Expected/actual access → PERMISSION; public summary → ANNOUNCEMENT; retention source → SOURCE; public feedback route → CHANNEL |
| 18 | Content, voice route and specific barrier → ACCESSIBILITY |
| 19 | Resource, entry, analysis and urgent task guidance → CHANNEL |
| 20 | Text-chat pilot/maintenance → CHANNEL; existing forum state/navigation → FORUM |

These are canonical registry mappings for the review contracts, not claims that an authorized production adapter or editor is available for each source/target. The fixture scopes use the mapped canonical target, and unit acceptance asserts registry membership.


## Communication identity and arbitration integration

Rules personal/shared mutations prepare the server-issued key through `/api/rules/mutation-request-key` with the exact operation, target, expected version when required and actual payload; the actual POST uses that key and exact body. Unknown results are not automatically repeated. `canView` reflects current READ access; recording a view uses the independent server `canRecordView` capability. Evaluation readiness does not block direct display or an independently authorized retained personal-state action.

All 32 CASE13-20 actions carry explicit finite priority-band and target-specificity metadata in `ACTION_PRIORITY_13_20`. Safety/incident, data quality, access, pending work, capacity, purpose and reversible bands follow the parent common-engine contract. Branch priority is ascending declaration order. Cross-case selection is implemented by the common evaluator and operates only within its registered target/window scope. These metadata do not confer execution permission, establish causal evidence or confirm an unregistered production source. Observation fixtures declare `sourceKind=SYSTEM_OBSERVATION`.
