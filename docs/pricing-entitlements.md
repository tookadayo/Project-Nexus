# Pricing and entitlements v3 — 0.6.0-alpha.8

NEXUS sells history, analysis depth and community operations. No Discord surface
requires a paid plan merely to observe it. Correct UNKNOWN/PARTIAL states, Metric
Evidence, Data Coverage, Integration Health, privacy, deletion and security remain
available to every tier. Payment does not turn unavailable observations into zero.

| Plan       | Purpose                 | Guild allowance | Visible aggregate history | Available additional value                                                                                                                                                                   |
| ---------- | ----------------------- | --------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FREE       | Observe & Check         | 1               | 30 days                   | Basic observations and evidence, Attention, private 7/30-day Discord PNG charts, one explicit intake form                                                                                    |
| STARTER    | Understand & Explore    | 1               | 90 days                   | Saved views/segments, surface and role filters, heatmaps, comparable periods, aggregate CSV, custom intake and ICS event templates                                                           |
| GROWTH     | Operate & Integrate     | 1               | 365 days                  | Evidence-backed Inbox, immutable versioned Playbooks, escalation, before/after reviews, weekly/monthly branded charts, scoped read API and signed webhooks                                   |
| SCALE      | Team, Automate & Govern | 5               | 730 days                  | Explicit organization licensing and aggregate overview, five NEXUS roles, teams, independent approval, redacted audit export, historical dry runs, recurring exports and advanced scoped API |
| ENTERPRISE | Secure & Integrate      | Contract        | Contract                  | Scoped contract arrangements; SSO/SAML/SCIM/residency/DPA remain PLANNED                                                                                                                     |

The alpha.8 capability catalog provides Discord PNG charts and explicit intake on
Free; Starter saved views, segments, heatmaps, CSV and ICS event templates; Growth
Attention Inbox, versioned Playbooks, weekly/monthly branded chart reports, scoped
read API and signed outbound webhooks; Scale explicit organization membership for
five guilds, five roles, team assignment, independent approval, historical dry runs,
recurring aggregate exports, service accounts and selected Attention writes.
AI explanations remain PLANNED and are rejected even for Enterprise. Google OAuth,
Slack/email/Jira/CRM destinations, SAML SSO, SCIM, residency and custom DPA are
PLANNED. The implementation does not imply approval to sell publicly.

Provisional internal monthly price points remain unchanged in the registry; they
are not approved public offers.
Registry pricing metadata classifies these USD amounts as INTERNAL_PROVISIONAL.
Server-owned `commercialLaunch` separates publication and Checkout enablement
from product capabilities. Configured Sandbox exposes real hosted purchase CTAs;
production hides unapproved prices and requires every Live launch gate. Tax,
public prices and production purchase availability require separate approval.

`plan-registry.ts` separates canonical features from numeric limits, at revision 3. Existing purchased commercial Offering revision 2 remains immutable: new capability benefits do not mutate its financial identity. Limits cover guilds, historyDays, monthlyObservedMembers, customRecipes,
automationRules, scheduledReports, teamSeats, webhooks and apiRequestsMonthly.
The member allowance is secondary operational accounting, currently a **soft**
guard: it does not drop measurement, report zeros or automatically charge overage.
Accounting deduplicates observed activity once per member, guild and UTC month.
Future hard enforcement must propagate BILLING_LIMIT_REACHED into evidence and
coverage instead of silently suppressing events.

| Community               | Free experience                                         | Paid workflow                                                                           |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Replies                 | First post, direct reply, unanswered newcomer Attention | Starter distributions and comparisons; Growth reminders                                 |
| Threads / Support Forum | Creation, first human response and unanswered count     | Starter surface/tag details and Journey; Growth staff routing and escalation            |
| Reaction / Poll creator | Observed current participation                          | Starter time/surface comparison; Growth scheduled aggregate charts                      |
| LFG + Voice             | LFG post, response and qualified co-presence            | Starter post → response → Voice Journey; Growth helper reminders                        |
| Voice-first             | Participation and configured co-presence threshold      | Starter trends/repeat participation; Growth digest and configured improvement tracking  |
| Event / Stage           | Signup and observable Voice/Stage attendance            | Starter event Journey/ICS; Growth improvement comparison and scheduled aggregate charts |
| Large mixed             | The same basic surfaces and evidence                    | Breakdown depth and operational limits, without paying for a primary surface            |

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

Current alpha.8 implementation: [community operations](alpha8-community-operations.md)
and [Stripe integration](billing/stripe-integration.md). Real Sandbox is tested;
Stripe Live remains DISABLED.
