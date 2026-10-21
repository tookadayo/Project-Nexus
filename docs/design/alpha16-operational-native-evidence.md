# CASE13–20 retained native source implementation

Source and synthetic verification code only. Tests, type/lint/build, UI, SQL,
migrations, network/provider calls, application start and operational configuration
changes performed for this task: **0**. Migration `080_alpha16_operational_native_context.sql`
is saved and has not been applied.

`createOperationalNativeContextPlugin` in `packages/rules/src/operational-context-native.ts`
implements the common `CASE_13_20_NATIVE` source interface. Its editor descriptor
and strict discriminated schemas are finite; neither direct counters nor body,
person score, caller provenance, approval flags or executable input are accepted.
The common context owner supplies prepared communication identities, current
GOVERN authoring, CSRF, scope, context-version CAS and one explicitly selected
resource per case per evaluation. Multiple authoring resources may be registered.
This module adds no external effect or automatic activation.

|CASE|Implemented exact source|Boundary|
|---|---|---|
|13|All current retained open native Attention rows of explicitly selected item types, matched one-for-one with explicit staff classifications and current versions; actionable/noise counts derive from that same set.|This is `CURRENT_RETAINED_NATIVE_ATTENTION_V1`, not a Discord-wide moderation/report census. Item category/reason never proves actionable status. Incomplete review remains UNKNOWN.|
|14|Same complete saved queue gives load and oldest open age; role or four finite duty buckets give maximum bucket numerator and total assigned denominator.|Unassigned source remains unknown. Empty queue has unknown oldest age and an explicitly undefined 0/0 concentration. No person IDs, availability monitoring, hours or individual workload scores. Roles are checked through the existing role inventory outside transactions; only selected role IDs and their original finite observation expiry are retained.|
|15|Explicit internal filter registry revision and declared configured language, plus one immutable native AutoMod execution-event review set. FP count, denominator and distinct triggered rule hashes come from the same existing event IDs.|Configuration fields have OPERATOR provenance and are not claimed to observe Discord's live rule configuration. Existing native scoped rule hashes are required. Events cannot be replaced by generic errors, messages or an arbitrary denominator. The unit is an execution event, not a unique person or message; no body is read.|
|16|No false active-platform-alert claim is emitted.|Current native `incidents_data` contains detection timestamps and temporary restriction deadlines, without the exact active RAID_ALERT/SAFETY_ALERT/explicit NONE contract. Raw detection, join bursts and DM-spam timestamps are not relabeled as an active alert. This unsupported reader is excluded from `supportedFields`, leaving the original source unconfirmed.|
|18|Existing finite staff accessibility checklist remains authoritative.|No changes to collection or inference.|
|19|Current authorized text-channel posting aggregate availability, backed by the retained location population collector, uninterrupted collection epoch, messages intent and current visibility/version.|Posting is not viewing. With no authorized viewing source, viewing availability/stability remain UNKNOWN rather than zero or false. A complete observed zero only establishes that the posting aggregate exists.|
|20|Latest retained direct reply metadata from the explicit start through capture time; message type must be Reply, or the record must be a non-starter post in a supported public thread. The exact complete tail is sealed in field metadata.|A past configured end cannot substitute for the current latest reply. Revalidation preserves the saved tail, original observation clock and expiry, and actual later posts change the source reference, closing the copied observation UNKNOWN. No reply in a retained sample cannot prove never-replied. Forum-container archived-thread census is incomplete, so it remains UNKNOWN. Archive/lock/age does not imply solved. The formal IV-E postingActivity field is explicitly staff-confirmed with no numeric threshold; the common owner connects that OPERATOR enum rather than inventing a low-posting threshold.|

The bounded queue read refuses a truncated population beyond 500 records. Review
sets refuse duplicate keys, stale versions and foreign/missing native IDs. Source
windows are explicit half-open UTC instants within the existing purpose's retained
detail window. The 48-hour capture lifetime is not a business-window limit; no calendar or DST reinterpretation is introduced. Native details are
queried only within their existing purpose, authorized scope and retention.

`080` stores one current source snapshot and optional internal filter configuration
per authoring context. It stores no actor/member identity or narrative. A hash
binds configuration, target, exact native metadata and classification/review set.
VALIDATE has no writes. CAPTURE checks `beforeWrite` and current proof at every
write in the existing canonical scoped transaction. Existing matching source
snapshots reuse original field clocks and expiry; recapture never extends the
first-capture deadline. Parent context, original native expiry and finite role
observation expiry win. SQL triggers also reject first-capture movement and expiry
extension. Source changes invalidate the copied EAV fields during the common
runtime recheck, rather than replacing accepted evidence.

`purgeOperationalNativeContextSources(tx, scope)` is the guild purge and
conservative actor-deletion source invalidation hook. `expireOperationalNativeContextSources(tx, scope, now)`
deletes native snapshots/configurations by their own deadline. The plugin exposes
these as `purge`, `purgeActor` and `expire`; callers already hold the complete
canonical scope set. The common owner also removes personal-dependent source
descriptors and copied fields and cancels affected queued/running case jobs.
Context deletion has an FK cascade. No Run or safety history is copied here.

CASE20 revalidation also requires uninterrupted native coverage from the saved
start through the current evaluation time. A collection gap after capture closes
the latest-reply claim even when the missing interval produced no retained row;
the current clock itself is not inserted into the saved source-reference hash.

The `/rules/context` source editor uses finite JSON-Schema-shaped controls for
discriminators, nested objects, bounded record sets, explicit empty sets, enums,
booleans, IDs, numbers and UTC instants. It has no free JSON/code textarea.
Source choice is optional and explicit; blank inputs do not become numeric zero,
boolean false or a known empty set. Per-case source variants use server-owned
`x-case-ids` descriptors. Save follows the existing prepare → exact body/key →
CAS write flow; uncertainty uses a read-only request lookup. Cancel resets source
drafts and optional UTC boundaries. English/Japanese labels and the existing
responsive layout are retained. Native/public report channel aliases are offered
for CASE17 rather than a fabricated logical channel ID.

`readOperationalNativeSourceOptions(tx, scope, actor, proof)` returns bounded
queue IDs/current versions and eligible AutoMod event/rule references only after
current GOVERN, proof, scope and deletion checks. ANALYZE-only options do not
include this metadata. Truncated or expired populations are identified explicitly;
input suggestions do not assert complete coverage or replace the server recheck.
BASE recommendation choices use an ID plus actual native target composite key;
their canonical source window is read-only and server-bound. CASE03/04 unavailable
native issue sources remain unavailable in server metadata: finite staff drafts
can be saved, while their operational-profile enable control stays disabled.

Prepared verification: seven native-source unit cases, five integration cases,
seven form-model unit cases, and four source-editor browser cases plus updated
existing multiple-resource expectations. They cover bounded/complete queue sets,
same-source assignments, blank-vs-zero, explicit empty sets, UTC/microseconds,
forbidden properties, current proof/scope, expiry extension/cascade, source
unavailability, exact prepared bodies, double-click and cancellation. All remain
**unexecuted**; source inspection is not passing runtime evidence.
