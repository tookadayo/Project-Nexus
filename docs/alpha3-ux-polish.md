# NEXUS 0.6.0-alpha.3 UX polish

Version remains `0.6.0-alpha.3`. This change uses master directly, with no branch or PR.

## Discord operating screen

Home puts unresolved newcomer posts and their oldest wait before the daily and weekly measures. Attention, New Members, Analysis and the configured Web Dashboard have direct buttons. Refresh is secondary; Results and Settings are in More. All-clear Home explains what NEXUS observes and provides the detection rules.

Daily joins use the configured timezone and require coverage from local midnight. Missing coverage, no eligible members, incomplete observation windows, insufficient samples and measured zeros have separate labels.

Weekly cards use seven-day joining periods with completed observation windows. Reply and first-connection cards observe the first 72 hours; later-activity cards use the configured completed retention window. Reply time is the average of each member's first observed direct reply. Rates use covered, eligible members. At least five observations are required. Previous-period differences appear only when both periods have a measured value. Gaps and detailed-data expiry prevent unsupported measurements. These periods are shown on the cards rather than being relabeled as calendar-week totals.

Suggestions retain the existing backend comparison and evidence. A reply comparison does not establish a causal explanation.

## Reactions and privacy

`reaction.received` records observed reaction additions from another human to an already observed newcomer post during the receiver's first 72 hours. Bot and self reactions are excluded. Replays remain deduplicated. Multiple additions are counted exactly, even though the presentation query transfers only first/last observations per member, kind, channel and day. Channel-scope filters apply to totals and member status.

The count includes removal followed by re-addition; it is not a current emoji total. Historical messages are not backfilled. Stored payloads contain only message/channel identifiers, with no emoji, content or reacting user's identifier. Existing detailed retention and member deletion remove these observations.

Received reactions are weak responses. They neither create a first connection nor acknowledge, snooze or resolve Attention. Those operations remain controlled by buttons and context commands. First connection still requires another member's direct reply or observed voice sharing. Optional reaction feedback on NEXUS messages was not added.

## Settings and authority

The public Settings summary has four detail buttons: Measurement, Notifications, Team and Goals. Details open as ephemeral responses; notification wait and enabled state can be edited together in a modal. Destination and role choices retain Discord-native selectors.

Private controls are bound to the requesting actor and installed panel, expire, and retain revision checks. Modal submission rechecks authority. Ordinary component ACKs remain message updates; private entry points ACK ephemerally before queue/database work. Existing REST retries, durable jobs, move-panel flow, setup flow and Attention lifecycle remain covered by regression tests.

Context commands have no restrictive default member permission. Execution still requires owner/administrator, Manage Guild or a configured NEXUS manager role. Discord's guild-specific application command overrides can still affect command visibility. Web OAuth authority remains unchanged.

## Web and pricing decision

Guided Setup uses “Sign up for an event” and “First reply to a post” in both languages. Goals & Rules explains the definitions independently of data availability, and only individual cards describe missing samples or coverage. Home hides provisional numbers while collection is incomplete.

Mobile public navigation contains Product, Pricing, Support, Login, language choices and Add NEXUS to Discord when an application ID is configured. Landing includes a plan teaser and FAQ.

**Currency decision: option B.** No approved public pricing currency is recorded, so public currency-denominated paid prices are hidden. The internal USD registry and price values are preserved. The page states that currency and prices will be published after approval. No JPY conversion or new price has been invented. Paid checkout remains unavailable.

Plan cards use the registry's actual server allowances and monthly distinct observed-member allowances, not event counts. Scale includes 5 server slots and 25,000 observed members per server/month; Enterprise includes 100 slots and no observed-member plan limit. Current inherited features are explained. AI explanations, webhooks, API, consolidated multi-server management, role-based access and audit export are explicitly planned.

## Validation and visual evidence

Local validation: lint, typecheck, 165 unit tests, 75 integration tests, all 18 workspace builds, 17 browser tests, Windows runtime tests and both performance fixtures pass. Performance fixture results: 10,000 members 562 ms; 50,000 members 8,616 ms, within the unchanged test thresholds. These are local synthetic-fixture timings, not hosted latency claims.

Playwright writes JA/EN desktop/mobile screenshots for landing, pricing and dashboard, plus the mobile menu and Goals & Rules, to ignored `test-results/polish-*` files. Discord screenshot previews cover Home, no-data Home, Attention, New Members, Analysis, Settings and Notifications in both languages and widths. They render actual Components V2 payloads with labeled fixture data and check component limits and overflow.

Discord previews approximate client appearance; they are not a live Discord acceptance test. No real guild configuration, command registration, OAuth installation or production deployment was performed. Screenshot artifacts are local and are regenerated by the browser suite.
