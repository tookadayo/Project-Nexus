# Privacy data inventory — alpha.8

alpha12 adds separate local operator authentication, durable public OAuth
sessions, scoped invitations/finite grants and deletion tombstone recovery.
Their actual retention, access and disconnect/delete paths are mapped in the
[alpha12 data inventory](alpha12-data-inventory.md); existing shorter detailed
retention is not extended by Beta history grace.

Commercial hardening adds a separate billing domain. Billing providers receive no
community activity or message data. These operational records do not imply an
invoice archive or established legal financial retention policy.

alpha.8 adds scoped saved views/segments (aggregate filters), immutable Playbook
definitions, report templates/schedules and aggregate evidence snapshots. Explicit
intake answers are encrypted separately from message observations and are visible
only to operation-authorized staff; member deletion removes that person's requests
and associated Attention/events. No form plaintext enters audit or outbound payloads.
API credentials retain only token digests/prefixes; outbound signing keys are sealed.
Organization staff references are explicit administrative membership bindings,
encrypted with lookup digests; they are not community-member tracking or a graph.
Organization aggregates contain only guild-level evidence/health/counts. Guild
deletion cascades these configurations; redacted operation audit records keep only
safe scalar actor digests, action categories, target keys and revision/outcome.
Downgrade pauses execution while retaining configuration, without extending privacy
retention. Background Discord/webhook delivery holds its final privacy and source
configuration fences through the bounded external request.

| Billing domain                             | Persisted data                                                                                                     | Deletion / retention                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Accounts / subscriptions / offerings       | Internal organization UUID, plan/state/clocks, encrypted minimal customer/subscription references and lookup HMACs | Guild allocations removed; unused provider references removed and account tombstoned; no card data                                 |
| Verified provider inbox / reconcile leases | Safe normalized plan/state/order, protected provider references, projection/retry/lease clocks                     | Guild deletion; no provider raw payload, activity metadata or message bodies                                                       |
| Grants / recovery / rule state             | Scoped plan/features/limits, start/end/revoke, recovery deadline and paused rule keys                              | Guild deletion overrides all paid/recovery grace; member creator provenance scrubbed                                               |
| Campaigns / codes / redemptions            | Campaign conditions, one-time code prefix/HMAC, grant/redemption UUIDs and scoped actor HMAC                       | No persisted plaintext codes; guild bindings revoked/scrubbed and redemptions deleted on guild deletion; member actor HMAC removed |
| Billing authorization / audit              | Organization-scoped actor HMAC, role/revoke, safe action categories/counts/UUIDs                                   | Member authorization/provenance removed; guild/actor/reason audit fields scrubbed; unrelated assigned organization roles preserved |
| Usage                                      | Existing guild/month member HMAC counters plus billing monthly aggregate snapshot                                  | Existing accounting semantics retained; member/guild deletion remains applied                                                      |

Paid aggregate **visibility** limits and a default 30-day downgrade recovery period
do not extend member-linked detailed retention or defeat configured aggregate
retention. Already deleted data cannot be restored by upgrading. The provider-side
financial/legal record exception requires explicit policy and implementation before
live checkout; see [billing security](billing-security.md).

NEXUS observes Discord metadata for community operations. It requests Guild Members for membership lifecycle and eligibility, Guild Messages for message IDs/times/references, Guild Message Reactions, Guild Message Polls, Guild Voice States, Guild Scheduled Events, Guilds and Auto Moderation Execution where enabled. It does **not** request Message Content, Guild Presences or Direct Messages intents.

| Domain                         | Persisted data                                                                                 | Purpose                                                             | Deletion / retention                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IdentityVault                  | Tenant-derived lookup HMAC and authenticated encrypted user ID                                 | Scoped routing, current authorization and member deletion           | Member deletion removes the map and cascading episodes; departed membership expires with detailed retention                                                    |
| Membership                     | Join/leave/eligible-start times; separately observed screening/guest/flags clocks              | Keep UNKNOWN, pending, guest and eligible distinct                  | Member/guild deletion; active membership is routing state, departed episodes expire                                                                            |
| Durable inbox                  | Strict normalized metadata, source session/sequence/ordinal, projection state                  | Replay and idempotency                                              | Member/guild scrub; detailed retention                                                                                                                         |
| Lifecycle / adaptive facts     | IDs, signal kind, timestamp, bounded metadata, definition/recipe/epoch attribution             | Evidence and aggregate transitions                                  | Member/guild deletion; detailed retention                                                                                                                      |
| Direct reply pairs             | Tenant-local identities and first reply time, with explicit DIRECT_REPLY provenance            | Aggregate early reply partners; never a social graph across servers | Both sides removed for member deletion; detailed retention; old UNKNOWN provenance excluded                                                                    |
| Reactions                      | User/message/HMAC emoji/type state and resets, recipient HMAC where known                      | Current observed participation, separate from event counts          | Actor or recipient deletion; owned-message reset deletion; detailed retention                                                                                  |
| Polls                          | Hashed answer keys, user/poll answer count, observation ordering                               | One participant per poll, regardless of answer count                | Member/guild deletion and detailed retention                                                                                                                   |
| Voice                          | One observed session per member and one aggregate channel clock                                | Qualified co-presence without participant pairs                     | Gaps clear active state; member deletion invalidates clocks; detailed retention                                                                                |
| Message observations           | Metadata-only message ID/channel/time and versioned first direct reply latency                 | Avoid raw dashboard scans; legacy ambiguous replies remain unproved | Fact/episode cascade, member/guild deletion, detailed retention                                                                                                |
| Eligible retention             | Separately proved eligible episode cohort and anonymous day counters                           | Legacy default-false members never enter a denominator              | Episode tracking is removed on member deletion; anonymous counted results retain no member identity; guild deletion removes both; existing aggregate retention |
| Daily projections              | Member/day signal bits and typed day/channel extrema/counts; whitelisted metadata              | Bounded dashboard reads                                             | Episode cascade, fact update/delete propagation, guild deletion and detailed retention                                                                         |
| Capabilities / epochs / health | Channel IDs/types/visibility, safe feature categories, collection intervals, health categories | Explain what can be measured                                        | Guild deletion; old closed epochs/snapshots expire; latest snapshot retained for inspection but becomes stale                                                  |
| Recipes / settings             | Administrator-confirmed purposes, mappings, thresholds and immutable definition revisions      | Preserve measurement meaning                                        | Guild deletion; no personal scoring                                                                                                                            |
| Attention / action outbox      | Target IDs, observed evidence, queue lifecycle clocks; safe action payload and error category  | Team response and reliable Discord writes                           | Target member/guild deletion, scoped privacy fences, detailed retention; interaction tokens/jobs have shorter existing lifetimes                               |
| Verification / auth            | Hashed one-use challenges; authenticated encrypted tokens/identity; scoped links               | Current Discord authorization and server verification               | Challenge expiry, unlink/revocation, member/guild deletion; OAuth session expiry                                                                               |
| Product telemetry / logs       | Allowlisted operations, safe categories and latency; redacted references                       | Product reliability, separately from community analysis             | Product telemetry up to 90 days; log sink retention must be configured by operator                                                                             |

Detailed retention remains the configured 7/14/30 days. Existing anonymous aggregate retention remains 3/12/24 months. New member-linked daily projections use **detailed** retention, not the longer anonymous aggregate policy. Closed collection epochs and old snapshots expire with detailed retention; losing attribution never authorizes a complete comparison.

Message bodies, attachments, embeds, poll labels, forum titles, emoji meanings, presence, DM content, voice audio/transcripts and voice relationship graphs are excluded. Outbound administrator-authored messages are configuration/action payloads, not collected Discord content. No individual engagement score, moderator productivity ranking, cross-server identity or benchmark exists.

`PrivacyService` serializes deletion against scoped mutations. Legacy panel/role REST writes run outside their DB transaction and require before/after ownership checks and compensation where supported. Alpha.8 chart/report/webhook sends retain a bounded final privacy/configuration fence through delivery, so deletion waits for the admitted send; later sends are rejected. PostgreSQL cannot cancel a remote write already in flight. Already delivered outbound messages and unavailable compensation require operator review. Unknown writes are not treated as safely repeatable sends.

There is no public member export endpoint in the existing product. An operator-assisted access request must use the verified tenant/member scope, decrypt only that identity, and include applicable new typed projections. It must exclude other members' identities and credentials. Do not expose raw SQL or introduce an unauthenticated export route.

Deletion and retention tests cover the typed projections, daily rollups, inbox, verification, scoped tenant collisions and absent content. [Intent operations](privileged-intent-operations.md) explains the privileged intent's purpose and review evidence.

Current alpha.7 contracts and commerce: [contracts](billing/contract-hardening-alpha7.md)
and [Stripe integration](billing/stripe-integration.md). Real Sandbox is tested;
Stripe Live remains DISABLED. Card data and raw Webhook payloads are never stored.

## alpha.10 detailed analysis records

Runs keep tenant scope, completed UTC period, recipe/configuration/input identity,
lease/recovery clocks and existing sealed requester routing. Results contain
aggregate MetricEvidence, never message content or member lists/scores. Results
expire within configured aggregate retention and accepting-plan history; current
plan controls visibility. Downgrade does not delete configuration/results
immediately. Accounting run/grant/reservation/ledger records remain operational
provenance until guild deletion, not permanent result storage.

Member deletion scrubs requester/manual-grant provenance and deletes that
actor's 15-minute setup drafts. Guild deletion removes all analysis and draft
records under the existing privacy lock. Expired result payloads/drafts are
purged separately from accounting. Purchased-result retention is undecided
because pack sales are disabled. No new individual behavior scoring, cross-server
identity, content/DM/presence/audio analysis or provider sharing is added.
