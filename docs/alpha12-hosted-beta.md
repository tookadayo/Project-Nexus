# alpha12 — invited Hosted Beta foundations

2026-10-08. Version `0.6.0-alpha.12`. Normal Development on the owner's MacBook;
the intended deployment OS remains Windows 11. Requested reasoning effort is
exactly `max`; the actual runtime setting was not independently verified.

The starting checkout was clean at
`6779d6baece92d0b0bb88f9bab775039bf125fb0`, branch
`codex/alpha11-analysis-experience`. A separate local clone preserves that exact
unpublished alpha11 commit at `task-4/Project-Nexus`, branch
`codex/alpha12-hosted-beta`. No remote baseline replaced alpha11. Local editing,
synthetic tests and a local commit are authorized; publication and real
credentials/data operations are separate decisions. The final commit SHA and
command logs are recorded in the local `.local/alpha12-handoff.md` after commit.

## Implemented boundaries

| Responsibility           | Implementation and boundary                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local operations         | `apps/operator`, `scripts/operator.ts`: separate foreground Fastify process, literal `127.0.0.1` bind, separate port, no operator routes in Next or public API. No Tunnel, proxy, service or firewall configuration is added.                                                                                                                                                          |
| Operator identity        | Owner-created private OS-local credential file; Node scrypt `N=131072,r=8,p=1`, independent salt/epoch/CSRF key. Dedicated opaque cookie and hashed persistent session table. Public OAuth cookies are never accepted.                                                                                                                                                                 |
| Local request protection | Exact Host/Origin, loopback peer, rejection of forwarding/proxy headers and cross-site fetch, login bootstrap plus session CSRF, POST-only mutations, bounded bodies, CSP, no credentialed wildcard CORS. Password reset exists only as a TTY CLI.                                                                                                                                     |
| Public OAuth             | Browser contains a random 32-byte opaque ID. Separate `public_oauth_sessions` table stores digest plus AES-GCM encrypted identity/access/refresh tokens. Keys remain outside DB backups. This uses the existing DB service with separate tables and authentication realms, rather than adding a second database service.                                                               |
| Refresh/revocation       | Durable refresh owner/lease and generation CAS; one provider request outside transaction, bounded concurrent wait, rejection on ambiguous rotation/crash/failure, no automatic replay of a possibly rotated token. Logout persistently revokes this session; personal OAuth disconnect revokes all sessions of that user.                                                              |
| Guild admission          | Persistent invitation and generation, independent of Bot installation and deletion state. Current role authorization, invitation, expiry and finite grant must all pass. Production requires admission; `off` is rejected there. Nonproduction legacy fixtures can explicitly retain their prior behavior.                                                                             |
| Intake and work          | Gateway refuses uninvited data before Guild creation/inbox/Redis writes; ingress stamps generation. Recovery, projectors, discovery, analysis and action workers recheck current persisted state. Unknown/store-unavailable states deny new work.                                                                                                                                      |
| Stop/save race           | Analysis holds scoped fences for snapshot and publication separately and checks generation before publication. Bounded ordinary workers hold scoped session fences through effect/save; stop acknowledgement waits for that work. Nested services inherit an already-held read fence to avoid waiting behind their own stop/delete waiter. Fence context expires when its owner exits. |
| Usage                    | Existing entitlement grants, UTC monthly analysis grants, reservations and immutable usage ledger remain canonical. Cancellation releases only RESERVED usage once; completed consumption stays consumed. Global heavy-worker concurrency is one in Beta.                                                                                                                              |
| Deletion/recovery        | Persistent scoped intent/tombstone; ordinary admission cannot block maintenance. Database erasure and Redis scrub have separate PENDING/ERASED/DONE stages. Bounded automatic retry and audited local retry never reactivate collection. Encrypted minimal deletion exports are reapplied offline before restoring traffic, with all restored sessions revoked.                        |

The same session cookie names are not distinguished by port. Operator isolation
comes from its own name, `/operator` path, key/epoch and server-side validation.
Its chosen transport is HTTP on literal loopback only: HttpOnly, SameSite=Strict,
no Domain, Secure=false. Chromium confirmed that this works locally. Public
HTTPS cookie Secure settings remain unchanged. This does not authorize forwarding
the operator port or exposing the host process.

## Invitations and finite grants

Registration requires fresh Bot membership/read-permission proof and Guild ID
matching; it does not start collection. First successful activation starts 30
days. Pause/resume preserves the original deadline. Requests check expiry even
when maintenance is delayed. An extension adds at most 30 days from the later
of current expiry or now, and an expired invitation becomes PAUSED until a
separate capacity-checked resume.

Activation/resume is serialized across Guilds under PostgreSQL advisory locks.
The hard cap is ten unexpired ACTIVE invitations, with no override. Changes need
an expected generation, reason and request UUID. Replays return the original
result, altered reuse conflicts, and stale confirmations are rejected. Changes
cancel outdated analysis reservations; readers can retain qualified history while
paused, but existing entitlement/retention/role checks still cap what they see.

| Setting                    | Default                         | Permitted local setting / semantics                                                           |
| -------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| Detailed analysis requests | 20 / Guild / UTC calendar month | 1–20; existing analysis grant period, not invitation rolling days                             |
| Daily detailed requests    | 3 / Guild / UTC day             | 1–3; counts RESERVED + CONSUMED, canceled unused reservations release                         |
| Guild heavy executions     | 1                               | Existing Guild exclusivity retained                                                           |
| Host heavy executions      | 1                               | Beta worker setting; increasing needs separate measured capacity evidence                     |
| Guild waiting              | 2                               | 1–2 QUEUED requests, distinct from running work                                               |
| Host waiting               | 10                              | 1–10; strictest setting among active invitations applies across Guilds                        |
| Invitation                 | 30 days                         | First successful activation; explicit bounded extensions                                      |
| Eligible-history grace     | At most 30 days after expiry    | Never extends existing raw/detail retention or delays requested deletion                      |
| Operator session           | 15 min idle / 8 h absolute      | Environment can shorten these ceilings                                                        |
| Public session             | 12 h idle / 7 days absolute     | Environment can shorten; provider validity and current authority still apply                  |
| Operator failed attempts   | 5 in 15 min                     | One account-wide budget, not IP-only; can lower failures or lengthen the window up to one day |

The local Beta grant uses the existing `PARTNER` entitlement source, scoped to
one Guild and invitation end, with `plan=NULL`. No payment, subscription or
billing-admin identity is fabricated. `betaFeatures` grants currently implemented
canonical capabilities except `multi_guild`; `ai_explanation` remains planned
and excluded. Existing aliases and feature requirements still resolve through
the existing entitlement service.

| Existing product responsibility       | Grant mapping / limit                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic Analysis / Analytics            | Existing observation, charts, saved views and comparable metrics; basic views do not consume a detailed request                                |
| Detailed Analysis / Compare / History | Existing available recipes/features, analysis grants, 20 monthly maximum, daily cap, one execution; history limit 30 days                      |
| Attention / Operations                | Existing attention inbox, automation/escalation, playbooks, interventions, reports and approval mechanisms; current role requirements retained |
| Intake / supported APIs               | Existing intake/API features; intake panels 10, API requests 1000/month; no new public API contract                                            |
| Other finite feature limits           | Observed members 5000/month, custom recipes 5, automation rules 10, scheduled reports 10, team seats 5, webhooks 5, Guilds 1                   |

Compatibility decisions: the existing analysis pool covers all detailed recipe
types, so Beta reuses that pool rather than creating a separate Detailed billing
model. Existing monthly grant quantities use `GREATEST` to preserve usage
provenance; lowering the invitation cap is enforced by current admission against
the same reservations/ledger, without shrinking consumed accounting. Grant
feature access cannot override invitation stop/deletion. Existing stricter
per-feature system checks and external limits remain in place.

Invitation revocation ends participation. Because there is no independent blanket
right to retain revoked API data, this implementation conservatively starts
prompt scoped deletion for revoke, unlink, Bot removal or Guild deletion. Pause
and expiry alone do not immediately erase everything. Personal OAuth disconnect
affects that identity's tokens/sessions, not another administrator's Guild grant.
The GUI distinguishes these operations and explains their effects before applying
them; it offers forms, lists, details, history, session state and bounded deletion
retry in JA/EN without requiring raw JSON input.

## Migration and mixed versions

`051_hosted_beta.sql` is additive. No published migration is modified. It adds
public/operator sessions, login budget, minimal operator audit/idempotency,
invitations, deletion jobs and nullable `analysis_runs.beta_generation`.
Isolated PostgreSQL tests apply migrations 001–051. No existing or unknown DB
was migrated in this task.

Before a separately approved deployment, stop all alpha11 ingress/workers, apply
051 to the approved environment, and start only matching alpha12 processes.
Mixed alpha11 workers do not know invitation fences and are unsupported for
Hosted Beta. Legacy queued data without a matching generation cannot run in Beta.
Old self-contained public cookies require re-login. Operator startup does not
automatically migrate or configure credentials. Restoring an older DB does not
undo external effects, cancellations or deletion obligations: apply the newest
protected tombstones and remain offline until recovery checks pass.

## Focused verification

The final local execution record lists commands, times, exit status and the
tested dirty tree at the alpha11 base; a local commit follows the checks. Logs
and two synthetic screenshots are ignored local artifacts, not secrets or
evidence of remote CI. The final result table is in the handoff record.

Related tests cover opaque/encrypted reload, concurrent refresh across separate
store instances, expired/failed/ambiguous refresh, logout/old-refresh CAS,
provider rejection and personal scope; operator Host/Origin/CSRF/epoch/expiry/
throttle; concurrent eleventh-Guild rejection; fresh Bot proof; no pre-invite
collection; stale inbox/job rejection; daily/monthly/waiting/execution limits;
one-time release/consumption; stop before publication; nested worker versus
pause/delete waiters; current permission loss; targeted deletion and failed Redis
scrub retry; encrypted offline tombstone application and missing identity refusal.
Alpha11 analysis, stabilization and scope regressions remain exercised.

The commands below used the bundled Node `24.19.0`, pinned pnpm `11.19.0`,
and locally copied alpha11 dependencies. The actual prefix was
`.local/bin/pnpm --config.verify-deps-before-run=never` with the bundled Node and
local pnpm wrapper on PATH. Verification target was the alpha11 HEAD above plus
the uncommitted alpha12 changes on `codex/alpha12-hosted-beta`; those code changes
are committed locally after verification. Database tests exclusively create new
private synthetic PostgreSQL clusters on loopback, ignoring `DATABASE_URL`.
There are no real OAuth/Discord/Stripe requests in the tests.

| Command after that pnpm prefix                                                                                                                                                                                                                                                     | Final result                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `exec vitest run tests/unit/alpha12-configuration.test.ts tests/unit/session-lifecycle.test.ts tests/unit/auth-hardening.test.ts tests/unit/server-verification.test.ts tests/unit/v05.test.ts tests/unit/alpha11-analysis.test.ts`                                                | PASS, 58 tests / 6 files                                                                                                            |
| `exec vitest run --config vitest.integration.ts tests/integration/alpha12-beta.test.ts tests/integration/alpha12-sessions.test.ts tests/integration/alpha11-analysis.test.ts tests/integration/analysis-stabilization.test.ts tests/integration/analysis-scope-boundaries.test.ts` | PASS, 37 tests / 5 files; 15 alpha12 and 22 relevant existing regressions                                                           |
| `exec vitest run --config vitest.integration.ts tests/integration/alpha12-beta.test.ts`                                                                                                                                                                                            | PASS, 11; rerun after final API state-store guard                                                                                   |
| `exec vitest run --config vitest.integration.ts tests/integration/alpha12-sessions.test.ts`                                                                                                                                                                                        | PASS, 4; rerun after configurable login budget                                                                                      |
| `exec tsx tests/ui/operator-smoke.ts`                                                                                                                                                                                                                                              | PASS, real Chromium/loopback HTTP cookie and form smoke, JA/EN, 390px viewport, no page errors; two synthetic screenshots inspected |
| `typecheck`                                                                                                                                                                                                                                                                        | PASS                                                                                                                                |
| `lint`                                                                                                                                                                                                                                                                             | PASS; final operator client also checked after visual adjustment                                                                    |
| `build --concurrency=2`                                                                                                                                                                                                                                                            | PASS, 21 packages; first full successful run was uncached, final affected rerun uses 18 valid cached tasks / 3 executed tasks       |
| `check:secrets`, `git diff --check`                                                                                                                                                                                                                                                | PASS; values never printed                                                                                                          |

The first build failed fetching existing Google Fonts under environment network
restrictions. A normal-font-access retry passed without changing network or
application settings. The first secret-scan CLI failed before execution because
tsx's local IPC listener was sandbox-blocked; the same read-only scan then passed.
Local loopback tests used sandbox escalation for newly created synthetic services,
not a different execution environment. Dependency lockfile-only refresh was
interrupted after registry resolution failed; no dependency versions changed,
and the lockfile addition is solely the empty operator workspace importer.
A fresh dependency install and Windows dependency/runtime acceptance are NOT RUN.

During development, an additional nested-fence regression first had an invalid
test `lock_timeout` unit. After correcting that fixture, the unfixed code
reproduced a real lock wait failure. The inherited-fence fix passes both pause
and deletion waiters without extending timeouts or weakening assertions. This
is evidence for the changed path, not a resolution of the separate known 40P01
release gate. Earlier failed checks are not counted as PASS.

## Remaining release gates

Normal Development does not establish Hosted Beta readiness. Windows 11 ACL,
TTY/foreground startup and stop, real OAuth consent/rotation/revocation, actual
HTTPS and tunnel topology, current provider permissions, monitored deletion,
fresh out-of-band tombstones and encrypted backup recovery, measured capacity,
SHOWCASE and the known 40P01 risk remain alpha14–15 gates. Alpha13 handles further
user UX. Full suites, broad E2E, load/performance and release audit were not run
for this task. Redis protocol behavior in changed tests is simulated; real Redis
and off-host restore require dedicated acceptance. No external publish, remote
CI, real password/key generation, live grant, real data deletion or payment is
included.

Owner procedures: [Local operator operations](alpha12-operator-operations.md).
Data/deletion map: [alpha12 data inventory](alpha12-data-inventory.md).
