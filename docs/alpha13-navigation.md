# alpha.13 navigation inventory (baseline e4a146a)

Approved 2026-10-09: summary Home, four primary entries, preserve all features; Web/Discord first. This supersedes the proposal's pending approval wording.

The table was established before navigation edits. All numeric destinations remain valid at `/dashboard` and `/dashboard/[guildId]` through `?view=N`. View 6 and 7 are secondary legacy deep links, also retained. The dashboard requires dashboardContext's live guild authorization, verified connection and CONFIGURE; otherwise existing redirect to Operations remains. Each read/mutation keeps its existing server policy. Navigation is not authorization.

| Old label/key | Old view | New location | Authority |
| --- | --- | --- | --- |
| control.overview | 0 | Home → full overview | dashboardContext; scoped reads |
| control.newMembers | 1 | Analysis → New members | same |
| control.attention | 8 | Needs attention | same; existing OPERATE for actions |
| operations.journeys | 10 | Analysis → Journeys | same |
| experience.insights | 5 | Analysis | same |
| experience.improvements | 2 | Needs attention → Improvements | same; existing action policy |
| control.results | 3 | History → response results | same |
| experience.goalsRules | 9 | Settings → Goals and rules | existing CONFIGURE |
| operations.model | 11 | Settings → Community model | existing CONFIGURE |
| operations.integration | 12 | Settings → Discord integration health | existing CONFIGURE |
| operations.coverage | 13 | Settings → Data coverage | existing CONFIGURE |
| operations.collection | 14 | Settings → Collection continuity | existing CONFIGURE |
| control.settings | 4 | Settings | existing CONFIGURE; link lifecycle unchanged |
| Explore & saved views | /explore | Analysis → Explore & saved views | operationsContext READ; analytics service access checks |
| Attention, automation & reports | /operations?view=attention | Needs attention → Operations | operationsContext READ; per-action OPERATE/CONFIGURE |
| Organization & teams | /operations?view=organization | Settings → Organization & teams | READ; service GOVERN for mutations |
| API & webhook integrations | /operations?view=integrations | Settings → API & webhooks | READ; credential/webhook data CONFIGURE-gated |

Supplementary routes retained: /servers → /auth/select (fresh authorization/full document navigation), /auth/logout, /locale, /privacy, /terms, /support. Discord connection is in dashboard settings and /link; API/webhooks are a different service. No guessed help/support URLs.

## Important implementation boundary

Web view 3 is existing response/experiment results, not the detailed-analysis run ledger. Detailed analysis menu, fixed preview, run state, saved run history, comparison and attention recording are already implemented in Discord (`views/analysis.ts`, action handlers). Reuse those operations and disclose this distinction in Web; do not rename experiment results into analysis history or create an unapproved Web run API. Existing Operations tabs (reports/playbooks/improvements/intake/events/organization/integrations), saved views, settings and billing destinations remain reachable. Hosted purchase gates stay unchanged.

Server switching is full-document navigation through /auth/select. Hide the old console immediately on selection; the destination rechecks authorization before rendering and does not inherit filters/comparison state. No new client cache or shared-tenant state.
