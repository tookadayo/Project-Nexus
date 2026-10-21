# Alpha16 native metadata contracts (081)

Source and synthetic fixture code only, 2026-10-16, existing Windows checkout.
Tests, typecheck, lint, build, migrations/SQL, browser and Discord requests are
**NOT RUN**. No operational configuration, source approval or collection is
activated by this work. Original specification files remain unchanged.

## Bot/Webhook direct references

`packages/events/src/index.ts` exports `BOT_REPLY_REFERENCE_CONTRACT =
DIRECT_REPLY_V1`. Only the new MESSAGE_CREATE Bot/Webhook normalizer and the
new gateway health producer supply this internal Envelope stamp. A direct reply
retains the existing message/channel/type fields and guarded reference ID: Reply
type, default reference type, same guild and same channel. Forwarded, cross-guild
and cross-channel references do not become direct. A malformed Reply missing its
reference is not stamped. Default posts can be stamped as known non-replies.
Bot/Webhook identity, encrypted user ID, body, attachment and role ID arrays are
not added.

The location projector stores `reference_contract_version` on the existing
location observation. Migration `081_alpha16_source_metadata_contracts.sql`
adds the nullable field with no default/backfill. Old queued events remain
unstamped. Existing rows use ON CONFLICT DO NOTHING, so a later retry cannot
retrofit reference completeness to an old observation.

Reference IDs can point at another author's post. Actor erasure therefore also
has to clear references from surviving authors' location rows (including Bot
rows) to the erased person's message IDs and clear their reference contract
marker. A NULL reference produced by erasure is not an observed no-reply result.
The parent owns this PrivacyService change and the existing gateway-ingest/
queued Envelope copies and tombstone checks. ON CONFLICT DO NOTHING protects an
existing cleared row on retry; the parent tombstone/backlog path must also block
deleted references in a new insert or reclaimed queued Envelope.

## Actual protocol coverage

The existing `location_population_collection` receives nullable
`bot_reference_started_at` and `bot_reference_observed_at`. Migration time and
guild bootstrap do not set either. The new gateway producer attaches the same
protocol stamp to its actual connected/disconnected/heartbeat Envelope.

`projectObservation` updates feature clocks only after the native health write
accepts that event, at the actual Envelope observation instant. The new stamp
and explicit messages intent are required for positive coverage. Missing stamp
or disconnect clears the feature clocks. A telemetry gap clears them as well.
Full-precision PostgreSQL comparisons ignore out-of-order telemetry before it
can rotate newer epochs or update feature clocks.

Continuous coverage additionally requires the previously saved feature observed
instant to equal the previous native `last_gateway_at`, with no heartbeat gap
over the existing 90-second bound. Thus an old projector advancing only native
health breaks the pairing; the next current heartbeat restarts feature coverage.
An old producer processed by a new projector clears it. New health must not
certify collection before the real first stamped observation. Equal-clock
positive replays cannot restart a cleared feature clock.

The CASE source helper owns the final population proof: current native gateway
and feature observed instants must match; startedAt must cover the requested
window; existing source epoch/gap/intents must also cover it; every relevant Bot
row must have its reference marker. Missing/legacy rows and a pre-upgrade window
remain UNKNOWN. A new schema or running binary alone never establishes a healthy
seven-day historical zero.

## Scheduled event times

The scheduled-event normalizer independently validates native
`scheduled_start_time` / `scheduled_end_time`, converts offset timestamps to UTC,
and emits `scheduledStartAt`, `scheduledEndAt`,
`scheduledMetadataObservedAt` and `eventScheduleContract = NATIVE_SCHEDULE_V1`
only for a complete valid pair (explicit null end is allowed; end cannot precede
start). Missing or malformed metadata does not discard the existing structural
event packet; the new fields stay unknown.

The adaptive state/fact strict DTOs retain those fields in the existing metadata
source. They do not replace actual `activeSince`, completion or attendance time.
A new partial/legacy edit clears the state's old time marker/observation rather
than carrying stale scheduled times forward. Current helper consumers must
verify the current event status/version, observed timestamp and original source
expiry; edited, cancelled, missing or stale events cannot create a current
upcoming-event count. No event title, description, participant or new historical
retention was added.

## Mass mention metadata

The MESSAGE_CREATE normalizer independently validates the literal native
`mention_everyone` Boolean and bounded `mention_roles` ID array. Only when both
are present and valid does it emit `mentionEveryone`, `roleMentionCount` and
`massMentionContract = ROLE_EVERYONE_V1`. The role count is the number of distinct
native role targets, at most 1000; the array itself is dropped. The location row
stores nullable `mention_everyone`, `role_mention_count` and
`mention_contract_version`. Missing raw fields, legacy queues and legacy rows
stay NULL. Explicit false plus an empty validated array can represent zero.

This supports only an explicitly selected MASS target-count contract: everyone
is one mass target and each distinct role is one target. It is not the number of
individual mentions, total text tokens or repeated mentions of the same role.
The source helper must retain UNKNOWN for an individual/all-mention semantic;
the existing personal mention hashes are not repurposed. No body parsing or new
mention identities are introduced. Original observation retention and erasure
continue to own these nullable columns.

## Prepared validation, all NOT RUN

- Unit/fixture source: guarded direct Bot/Webhook references; forward/cross-scope
  and malformed replies; identity/body exclusion; legacy stamp absence; explicit
  versus missing mass zero; native UTC scheduled pair/partial/reversed times.
- Isolated PostgreSQL source: nullable migration state; actual heartbeat start;
  missing/old protocol and mixed projector invalidation; disconnect/gap/restart;
  sub-millisecond stale health; legacy row retry without backfill; new row
  markers; scheduled state partial-edit/cancellation handling.

The parent owns migration registration/restore compatibility and the CASE source
helper integration. HELP remains separately blocked by the absence of an
authoritative intake-to-message or request-bound first-response/STALLED source;
fixing Bot reference metadata does not change that grain.

## Source freeze: reference erasure and replay protection

`packages/lifecycle/src/alpha16-reference-privacy.ts` now owns the two narrow
source operations, with no new identity mapping, tombstone, body or retention
purpose:

- `scrubStoredPostReferences(tx,scope,actorHash)` runs inside the parent's
  canonical exclusive privacy transaction before native actor rows are removed.
  It resolves existing owned post IDs from location observations and from the
  minimal metadata of not-yet-projected owned Gateway originals. Referencing
  rows of every author kind lose referenceId/reference contract and receive
  `reply_provenance_erased = true`, so a surviving HUMAN reply cannot become a
  new unanswered question just because its parent ID was erased.
- Surviving direct questions and same-channel native starters whose cached reply
  may depend on the erased actor lose `first_reply_seconds` / `reply_source` and
  receive that quality bit. The helper removes only the affected
  `lifecycle_events.data.firstReplyLatencySeconds` cache field. The existing 033
  trigger/rebuild therefore leaves `message_observations.first_reply_seconds`
  NULL, rather than restoring the erased clock. Direct message-observation
  clocks are also cleared for legacy projections. The bit remains on the
  original retained row and does not create a separate history or deadline.
- Scope-local queued Gateway Bot/Webhook post references are conservatively
  deleted and the Bot-reference collection clocks are reset. Bot identity is
  unavailable by design; the helper does not guess which Bot event belongs to
  a person. The parent connected the helper before actor-source deletion in
  PrivacyService, and the Redis owner added the matching scope-local Bot/
  Webhook-reference deletion without changing the HUMAN queue path.

`sanitizeBotPostReference(tx,scope,event)` applies only to
`channel.post_observed` references. It requires a known same-guild/channel
original post within the existing validated native detail retention and no
pending or completed subject/scope deletion tombstone. A retained location
original is authoritative; fallback is permitted only for one typed original
whose Gateway ingress has not yet been projected. Projected-but-missing,
expired, ambiguous, future, cross-channel or deleted originals do not qualify.
Only minimal source metadata is selected, without loading plaintext or keeping
another source payload copy. Unknown references lose referenceId/referenceType/
Bot contract while preserving Bot post/count metadata.

GatewayPublisher calls the sanitizer under its privacy-read transaction before
persisting/publishing; its database-free development path cannot certify a Bot
reference. LifecycleService repeats it under its existing privacy-read fence
before projection, covering an old Redis Envelope. When sanitization strips a
reference, both entry points also remove that reference/type/contract from an
existing same-dedupe Gateway ingress copy, so recovery cannot retain the unsafe
old payload. Existing cleared location rows are not overwritten on retry.

Positive protocol health older than the latest existing deletion request/
completion timestamp cannot reopen a reset feature clock. This consults the
existing deletion record only, rather than adding a new person/tombstone or
inventing a feature observation. Ordinary out-of-order/native-health pairing and
epoch/gap/intent checks continue to apply. Deletion-induced missing source or
stamp periods remain UNKNOWN.

Purpose boundary: the existing anonymous `receivedExplicitReply` and
`receivedHumanParticipant` Booleans, existing target-episode `reply.received`
activity and legacy Attention/activation meanings remain intact. They are not
used to recreate an erased first-response time. The parent added the quality
guard to the existing analytics waiting/reply metrics, and the CASE source
owner was notified that the quality bit makes a NULL clock UNKNOWN, never an
unanswered/zero value. No historical staff classification stamp was added.

Prepared source fixtures, still **NOT RUN**:

- `tests/fixtures/alpha16-source-metadata.ts`
- `tests/unit/alpha16-source-metadata.test.ts`: six unit cases, including the
  pure reference-strip boundary and unchanged HUMAN event handling.
- `tests/integration/alpha16-source-metadata.test.ts`: six isolated-PostgreSQL
  cases, including 033 trigger/rebuild non-resurrection, preserved existing
  Booleans, direct/starter quality flags, HUMAN/Bot surviving references,
  unprojected-original erasure, Gateway/old-Redis projection sanitization and
  pre-erasure/out-of-order protocol clock rejection.

Collector/source implementation is frozen at this handoff. All tests, typecheck,
lint, build, migration/database execution and external application operations
remain unexecuted; the migration registration, restore mapping, parent privacy
call, analytics guard and Redis scrub integration were reported by their owners.
