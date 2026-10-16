# alpha16 role access source evidence

Source implementation only, 2026-10-16. No test, type check, lint, build, SQL,
Discord request, application boot or production operation has been executed.

## Implemented path

`packages/discord/src/role-access.ts` supplies a strict role-only DTO and native
permission projection. `DiscordRest.roleChannelMetadata()` uses the existing
guild roles and channel metadata endpoints. It makes no member request, message
request or additional privileged-intent request. A member overwrite is reduced
immediately to `memberOverwritePresent`; its identifier, allow/deny values and
other properties are never copied to the DTO, hash, stored observation or UI.
Role names and tags are also excluded from the source DTO.

`createRoleAccessSourcePlugin()` in `packages/rules/src/role-access-source.ts`
implements `ROLE_ACCESS_NATIVE` and exports its strict finite editor schema.
It supplies only these SYSTEM_OBSERVATION fields:

| Case | Native target and destination binding | Field |
| --- | --- | --- |
| CASE01 | Existing current ONBOARDING_FLOW id/version; settings start channel, native onboarding default channel, or an exact prompt/option destination | onb.actualAccess |
| CASE10 | Existing CHANNEL id and native observed channel version; current analysis scope | channel.actualAccess |
| CASE17 | Existing PERMISSION alias for the selected current reporting channel id/native version | reportChannel.actualPermission |

CASE17 concerns the selected reporting/privacy route, not an aggregate report
schedule. Expected audience, administrator preview, expected access and confirmed
redaction findings remain separate staff declarations. A source config never
supplies their answers or actual permission values.

Config fields are channelId, channelVersion, representativeRoleIds (unique, at
most eight, with @everyone implicit) and destinationKind. The native option
branch additionally requires promptId/optionId and an exact option role-set.
Finite editor branches carry `x-case-ids` so unrelated destination choices can
be omitted from that case's form; server validation remains authoritative.
It does not infer the choices or additional roles of a person. The representative
composition is explicit; it is not a measured member or a population census.

Base permissions combine @everyone and the complete declared role composition.
Channel overwrites apply @everyone, then combined selected-role deny/allow. A
selected Administrator has Discord's explicit bypass. With any member overwrite,
non-administrator observations become UNKNOWN because its impact cannot be
excluded without person data. Threads and obfuscated channels are UNKNOWN.
CASE01 SendMessages classification is restricted to supported text/announcement
channels. Report PUBLIC means @everyone's native baseline can view; RESTRICTED
means @everyone cannot view and the declared role composition can view. It does
not certify that no other role or individual has access, or that a person has
read or received anything. Administrator on a chosen role alone does not prove
@everyone/public access.

## Authorization, race and storage boundary

Capture uses authorized canonical scoped transaction -> close transaction -> two
Discord metadata reads -> fresh authorized scoped transaction. Both complete
native role/overwrite DTOs must agree apart from their source clock. The current
capability snapshot/hash, surface type/parent/visibility, settings revision,
destination, flow target version, scope, actor proof and declared request are
bound to a private opaque prepared token. No DB transaction is open during REST.
The write transaction checks this binding again and invokes `beforeWrite` before
each DELETE/INSERT. A browser cannot forge the prepared source evidence.

079 stores one immutable role observation per operational context. The original
REST observation clock is retained. Expiry is bounded by that source's 48 hours,
the original context deadline and the earlier existing capability/surface
viewability freshness (one hour). Native capability coverage ratios use the
operational canonical hash, without integer rounding. Original source reference,
revision, window and expiry are returned for EAV provenance.

Runtime VALIDATE makes no Discord call and performs no write. It requires the
same still-current scope/settings/capability/channel/destination/hash and original
stored source expiry. A missing source yields no fabricated observation. A
changed, stale or unauthorized source fails closed; the common case adapter
projects unavailable evidence to UNKNOWN rather than renewing its clocks.
An explicit new capture may replace an observation, within the first context
deadline. Routine read/retry cannot recapture or extend it.

`079_alpha16_role_access_observation.sql` has no actor/member/message/Run field.
Its context FK is deferred and ON DELETE CASCADE. Guild deletion therefore uses
the canonical context purge. Role-only metadata does not require an actor purge.
`expireRoleAccessObservations(tx, scope, now)` physically removes its own earlier
expiry. Static source inspection confirms the existing scoped Rule retention
transaction and registered operational plugin expiry path call this helper.
`purgeRoleAccessObservations` and plugin purge/expire hooks are also exported.

## Prepared verification

Unit fixture source covers role union/overwrite ordering, Administrator bypass,
member overwrite erasure and UNKNOWN, unsupported threads, wrong guild, missing
role coverage, strict config and prohibited browser observation/permission input.
Integration fixture source covers all three native target contracts, immutable
source clock/ref/expiry, no REST on VALIDATE, pre/post changes, forged token,
current proof/surface changes, earlier expiry and canonical context cascade.
Files: `tests/unit/alpha16-role-access.test.ts` and
`tests/integration/alpha16-role-access-source.test.ts`.

Static inspection also confirms migration 079 registration, server-only plugin
registration and the common native CASE17 PERMISSION authoring alias. Normal
targeted `git diff --check` passed; new files have no trailing whitespace. A
second agent's read-only check found no additional blocking codec/expiry issue.
These checks do not establish runtime, type or database correctness.

These fixtures have not run. Their synthetic permissions and metadata are not
an operating-profile approval. Source availability does not enable external
Apply or a production measured operating profile. No new personal collection,
permission grant, bot scope, native configuration mutation or actual API call
was performed.

## Authorized isolated verification on 2026-10-16

The parent subsequently authorized the combined test phase. The role-access
integration file passed all four cases in the final alpha16 batch (33 files,
173 tests passed). This supersedes the earlier NOT RUN status for this file.
Evidence: `.local/alpha16-db-alpha16-final.log` and its `.vitest.json` report.
Each database was newly created with synthetic credentials on private loopback.
Discord metadata reads used injected fixture ports; no Discord API was called.
Synthetic profiles do not approve an operating profile or enable external Apply.
