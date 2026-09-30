# Server verification and Web authorization — alpha.3

Discord OAuth (`identify guilds`) identifies the signed-in user. Bot installation,
server verification, and current administration rights are independent checks.
An existing installation never becomes verified automatically. `/servers` shows
`NOT_INSTALLED`, `INSTALLED_NOT_VERIFIED`, `VERIFICATION_PENDING` (the current
user's active challenge), or `VERIFIED` from actual installation and database state.

## Deployment and operation

Apply migration `025_server_verification` with `corepack pnpm migrate` before
starting the updated Web app. It adds separate challenge and permanent-link
tables plus a durable, opaque per-user attempt budget. The link contains a random
revision so old disconnect confirmations cannot revoke a new connection.

The Web server requires the existing `DATABASE_URL`, `IDENTITY_KEY`, `LOOKUP_KEY`,
`COMPONENT_KEY`, `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, and `API_KEY`, in
addition to `DISCORD_CLIENT_SECRET`, `NEXUS_SESSION_SECRET` (32+ characters), and
HTTPS `NEXUS_WEB_URL`. These stay in server processes. No new public API or
credential type is introduced. OAuth cookies retain AES-GCM encryption,
HttpOnly, SameSite=Lax, and HTTPS Secure settings. Guild listing paginates
[Discord's current-user guild endpoint](https://docs.discord.com/developers/resources/user#get-current-user-guilds).

1. Install NEXUS and sign in on the Web with Discord.
2. Run `/nexus link` in the desired server. Its ephemeral reply includes a code,
   expiry, and `/link` URL. Sign in with the same account that issued the code.
3. Enter the code on `/link`; successful redemption offers Open Dashboard.
4. Disconnect through `/nexus unlink` or Settings → Server connection → Disconnect.
   Both require confirmation and current authority. Analytics, bot installation,
   settings, and history remain intact. Run `/nexus link` again to reconnect.

Verified Discord panels link to `/dashboard/[guildId]`; unverified panels offer
Connect Web Dashboard and `/nexus link` help. Production links reject HTTP,
loopback hosts, credentials, query strings, and fragments in the configured URL.

## Authorization and security

The shared policy accepts server ownership, Administrator, Manage Guild, or the
configured NEXUS admin/manager roles. Helper roles alone do not grant access.
The Bot's current member, roles, ownership, and NEXUS settings are checked on each
Web access/write and verification/disconnect operation. The Bot guild list alone
has a 60-second cache; live member/guild lookups still fail closed if the Bot or
user loses access. Discord/API outages fail closed. Explicit unknown guild URLs
never fall back to another server. Every dashboard data/control handler uses
the verified-and-currently-authorized context.

Dashboard and control requests fetch OAuth identity once to check the grant and
authorize only the selected guild. `/servers` alone fetches the OAuth guild list
and cached installation list. Each installed server card is checked independently
with bounded concurrency; one failed lookup produces an unavailable card with a
safe reference, while other cards remain usable. The selected dashboard still
fails closed when its authority cannot be confirmed.

Issue, redeem, and disconnect perform Discord calls before acquiring database
transaction locks. A request-local authorization snapshot contains current
member permissions/roles, ownership, NEXUS settings revision, actor and timestamp.
The transaction checks scope/user binding, a maximum age of ten seconds, current
settings revision under the same settings lock, challenge/link state, and the
current NEXUS permission policy. No cross-request permission cache is introduced.
Settings changes while Discord is slow cause rejection; external Discord
revocation can occur after a check, so this is bounded freshness, not atomicity
between Discord and PostgreSQL.

Codes contain 12 cryptographically random characters (about 59 bits), omit
`0/O/1/I/L`, normalize spaces, hyphens, and case, expire in ten minutes, and work
once. A purpose-separated HMAC of the normalized code is stored; the issuer is
represented by the existing scoped identity hash and authenticated ciphertext.
Plaintext codes are never put into the reply outbox, audit, logs, URLs, telemetry,
or server-rendered HTML. Sensitive Discord replies are sent directly in memory;
delivery failure revokes the challenge. `/link` uses POST and clears its input
after submission. Supplied browser user IDs are ignored.

Database transactions and guild locks serialize redemption and disconnect;
concurrent redemption succeeds exactly once. Reissue revokes the issuer's older
unused challenges. Issuance has a 30-second user/guild cooldown, five codes per
user and ten per guild per ten minutes. Redemption permits ten attempts per user
per ten minutes across sessions, including malformed codes. An issuer's challenge
is revoked after eight authorization failures. Another user's attempts cannot
consume that challenge's budget. No IP limit is inferred from untrusted proxy
headers. POST writes require matching configured Origin and same-origin Fetch
Metadata. GET cannot redeem or disconnect.

Disconnect confirmations are signed, actor/guild bound and tied to the current
link revision. Disconnect revokes the link and all unused challenges. Audits use
`server_verification.issued/completed/revoked/failed` with identifiers and states;
they never record supplied guesses. Existing privacy deletion removes challenge
identities and scrubs permanent-link verifier identity; guild deletion removes
both tables. Expired challenges and idle rate budgets are purged after one day
by the existing retention job.

`NEXUS_WEB_AUTH_MODE=development` is an explicit local convenience, protected by
the existing Basic password. A visible DEVELOPMENT AUTH MODE notice appears on
every dashboard page. It cannot redeem or disconnect OAuth server links. Normal
OAuth mode always requires verification; missing configuration never activates
development mode.

The shared configuration validator and Next startup instrumentation reject
`NODE_ENV=production` with development auth before accepting requests. Unknown
auth modes and a missing/short development password also fail. Basic E2E uses a
nonproduction Next dev server in a separate output directory; the OAuth
verification E2E profile uses the production build.

Session expiry is capped by the provider's access-token expiry and seven days.
Cookies are authenticated AES-GCM ciphertext, HttpOnly, SameSite=Lax, and Secure
on configured HTTPS. OAuth state is single-use, expires after ten minutes and is
compared in constant time. Redirects accept only supported local paths. Logout
clears session, selected guild and OAuth temporary cookies even if the two-second
best-effort provider revocation fails. The revocation endpoint follows
[Discord's token-revocation guidance](https://docs.discord.com/developers/discord-social-sdk/development-guides/publisher-level-account-linking).

Refresh tokens are not retained or logged. OAuth refresh remains a Beta blocker:
safe refresh rotation, encrypted server-side storage, concurrent refresh control
and a durable session-revocation mechanism need design and acceptance. Clearing
local cookies does not invalidate a copied encrypted cookie; live OAuth identity
checks block it after provider revocation, but provider failure leaves it usable
until expiry. No silent or infinite refresh loop is added.

## Validation and practical limits

Targeted unit tests cover code generation/normalization, shared policy, encrypted
session identity, Origin checks, OAuth return to `/link`, four states, safe links,
and confirmation handling. PostgreSQL integration tests cover expiry, issuer
binding, concurrent use/issuance, rate limits, permission loss, digest-only storage,
private reply delivery, confirmation ownership, disconnect/data retention/relink,
and privacy deletion. OAuth-mode Playwright tests cover JA/EN mobile views and the
complete verify/disconnect/relink flow. The production app has no alternative
Discord endpoint: its test-only preload runs in the isolated fixture process.

Run `corepack pnpm test:e2e:verification` for that profile. CI runs it after the
existing Web build/E2E profile. Codes, session cookies, and confirmation tokens
are kept out of screenshots and traces.

Real Discord account consent, hosted HTTPS deployment, and live command delivery
remain operational acceptance checks; automated tests use synthetic credentials
and Discord fixtures. No OAuth token refresh, new login method, or invite system
was added. Deployments must run the migration and existing command synchronization
to expose `/nexus link` and `/nexus unlink`.
