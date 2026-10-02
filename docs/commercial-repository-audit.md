# Pricing and entitlement hardening audit

Base: `8ba55f83c91253eeeb218ee97340e2e821cda042`, clean master and fetched
origin/master equal on 2026-10-02. No branch, PR, detached checkout or reset.
Installed Node 24.18.1, discord.js 14.27.0, discord-api-types 0.38.55.
Migrations 001–034 inspected before allocating 035 onward.

Reviewed settings (registry, entitlements, revisions, recipes), shared (Community
Model v2, recipes, evidence, health), presentation (community, adaptive, Journey,
templates), operations (Attention, recommendations, integration), lifecycle
(projection, discovery, eligibility, intervention), Discord (REST limiter,
discovery, fenced outbox), events (strict metadata registry), security (current
authorization, privacy, verification), identity vault and database conventions.
Reviewed Web pricing/session/control/server authorization, interaction ACK and
modal paths, worker actions/helpers/digest/interventions and scheduler, API scope
tokens, tests/fixtures, docs/privacy inventory, validation and CI workflows.
The Web AGENTS.md requires installed Next documentation; authentication and
server/client directive guides are used for new routes.

Reuse the existing EntitlementService as the single decision boundary. Extend
PostgreSQL state and the existing scheduler; no parallel activity ingestion,
identity map, Attention engine, provider ID feature checks or in-memory billing.
Billing mutations need a fresh actor check: an API tenant token alone is not a
billing actor. Internal operators have a separate allowlist, never Discord roles.

Findings: Free incorrectly excludes connection metrics; legacy feature names mix
depth with surfaces; billing lifecycle is a stub; helper/digest lack plan fences;
announcement usage is plural while capability is singular; mixed External events
erase observable Voice/Stage attendance in both metrics and Journeys. Existing
raw member-linked history has privacy retention independent of paid visibility.
Scale security/API/multi-guild and Webhooks remain planned until workflows ship.

## Final repository review

The canonical service now owns plan resolution and all protected writes; old
feature names survive only as explicit compatibility aliases. Historical v02
billing prose is labeled and linked to the v2 documents. Provisional prices remain
internal and publication stays disabled. Monthly member usage remains soft.

Announcement usage uses the shared typed singular key. Mixed observable and
External Event attendance preserves known counts with PARTIAL coverage and hides
the unavailable denominator, including Journey transitions. Forum capability
does not depend on the Community flag; unknown future channel types remain safe.
Dedicated native LFG remains experimental, without an invented API type.

Verified provider events are projected transactionally; duplicate, reordered and
equal-order conflicting events have persistent handling. Provider timestamps are
normalized to UTC so equivalent ISO offsets do not invent conflicts. Privacy
fences cover inbox projection, promotion redemption and reconciliation leases.
Anonymous lifetime redemption counters survive deletion of guild-linked history.
Worker execution checks paid access and preserves paused definitions on downgrade.

No public currency price, fake checkout, card store, production SKU ID, successful
payment claim or SSO/SAML workflow was introduced. Native configuration inspected
without printing secrets is DISABLED; external checkout is NOT_CONFIGURED.
JA/EN public pricing and private billing screens use human labels. Billing screens
were inspected from browser screenshots and their light-surface contrast corrected.
The final validation results and limitations are recorded in the hardening report.
