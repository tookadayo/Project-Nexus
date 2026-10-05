# Pricing and entitlements v2 — 0.6.0-alpha.7

NEXUS sells history, analysis depth and community operations. No Discord surface
requires a paid plan merely to observe it. Correct UNKNOWN/PARTIAL states, Metric
Evidence, Data Coverage, Integration Health, privacy, deletion and security remain
available to every tier. Payment does not turn unavailable observations into zero.

| Plan       | Purpose                                  | Guild allowance | Visible aggregate history | Available additional value                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------- | --------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FREE       | Observe / See what's happening           | 1               | 30 days                   | Newcomer joins, direct replies and first connections; Thread/Forum responses; current Reaction/Poll participation; Voice participation and qualified co-presence; Event signup and observable attendance; basic Attention and one confirmed matching preset with a basic Journey |
| STARTER    | Understand / Understand where it happens | 1               | 90 days                   | Preset catalog, surface breakdowns, detailed Journeys, median/p75/p90 subject to sample rules, comparable periods, weekly digest and basic before/after tracking                                                                                                                 |
| GROWTH     | Operate & Improve                        | 1               | 365 days                  | Custom immutable recipes, custom Attention/intervention settings, unattended reminders and helper escalation, staff channel/role routing, full improvement experiments and aggregate CSV export                                                                                  |
| SCALE      | Team & Automate                          | 5 reserved      | 730 days                  | Growth capabilities with larger catalog allowances; allocation, multi-guild overview, RBAC, API and audit export are **PLANNED**                                                                                                                                                 |
| ENTERPRISE | Govern & Integrate                       | Contract        | Contract                  | Scoped contract overrides and operator support arrangements; no implemented SSO/SAML claim                                                                                                                                                                                       |

Scheduled reports, Webhooks and AI explanations are also PLANNED. Limits alone do
not make a planned workflow available. `EntitlementService.check` rejects planned
features even for Enterprise. Existing guild-scoped API credentials do not become
a production Scale RBAC/API workflow.

Provisional internal monthly price points remain unchanged in the registry; they
are not approved public offers.
Registry pricing metadata classifies these USD amounts as INTERNAL_PROVISIONAL.
Server-owned `commercialLaunch` separates publication and Checkout enablement
from product capabilities. Configured Sandbox exposes real hosted purchase CTAs;
production hides unapproved prices and requires every Live launch gate. Tax,
public prices and production purchase availability require separate approval.

`plan-registry.ts` separates canonical features from numeric limits, at revision 2. Limits cover guilds, historyDays, monthlyObservedMembers, customRecipes,
automationRules, scheduledReports, teamSeats, webhooks and apiRequestsMonthly.
The member allowance is secondary operational accounting, currently a **soft**
guard: it does not drop measurement, report zeros or automatically charge overage.
Accounting deduplicates observed activity once per member, guild and UTC month.
Future hard enforcement must propagate BILLING_LIMIT_REACHED into evidence and
coverage instead of silently suppressing events.

| Community               | Free experience                                         | Paid workflow                                                                             |
| ----------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Replies                 | First post, direct reply, unanswered newcomer Attention | Starter distributions and comparisons; Growth reminders                                   |
| Threads / Support Forum | Creation, first human response and unanswered count     | Starter surface/tag details and Journey; Growth staff routing and escalation              |
| Reaction / Poll creator | Observed current participation                          | Starter time/surface comparison; custom scheduled reports remain planned                  |
| LFG + Voice             | LFG post, response and qualified co-presence            | Starter post → response → Voice Journey; Growth helper reminders                          |
| Voice-first             | Participation and configured co-presence threshold      | Starter trends/repeat participation; Growth digest and configured improvement tracking    |
| Event / Stage           | Signup and observable Voice/Stage attendance            | Starter event Journey; Growth improvement comparison; custom event reports remain planned |
| Large mixed             | The same basic surfaces and evidence                    | Breakdown depth and operational limits, without paying for a primary surface              |

Voice co-presence never proves conversation. Emoji never imply sentiment. External
Event attendance is unobservable. Mixed-event counts preserve observed attendance
as PARTIAL while withholding an all-event denominator and attendance ratio.

History limits are **visibility**, separate from privacy retention. Raw/member
detail remains configured 7/14/30 days and anonymous aggregates remain bounded by
the configured retention policy. A plan cannot restore already deleted data.
Downgrades hide excess history immediately at the effective date, retain eligible
aggregate history for a default 30-day recovery period, then allow compaction.
Privacy deletion always wins. Rules remain stored as PAUSED_PLAN_LIMIT and are
checked again before worker side effects. See [architecture](billing-architecture.md),
[migration](plan-migration.md) and [hosted blockers](hosted-beta-blockers.md).

## Final focused hardening (2026-10-03)

History reads validate against `SYSTEM_MAX_HISTORY_DAYS = 3650` before applying
plan visibility and scoped contract overrides. Free/Starter/Growth/Scale still
clamp to 30/90/365/730 days. Enterprise `null` means no catalog visibility limit,
not infinite storage retention: requests remain bounded and only retained data
can be returned. A contract may allow more than 730 days within the system bound.
This change does not extend physical retention or the public retention promise.


Current alpha.7 contracts and commerce: [contracts](billing/contract-hardening-alpha7.md)
and [Stripe integration](billing/stripe-integration.md). Real Sandbox is tested;
Stripe Live remains DISABLED.
