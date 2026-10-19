# alpha17 adjustment: alpha12 cold/warm connection diagnosis

Date: 2026-10-18. Only disposable, loopback, synthetic PostgreSQL fixtures were used. No production environment, credentials, schema, auth, timeout or pool-size changes were made by this diagnosis. Physical Node: `C:\Users\pc-ad\NEXUS-RUNTIME\tools\node-v24.22.0-win-x64\node.exe` (v24.22.0). Installed pg 8.23.0 / pg-pool 3.14.0 / Kysely 0.29.6 / Vitest 5.0.1 / embedded PostgreSQL 18.4.0-beta.17.

These measurements use the repository's native embedded PostgreSQL 18.4 beta fixture. They do not measure or certify the proposed production Docker PostgreSQL 18.6 image.

## Conclusion

The original cold parallel burst still fails on this PC. It is reproducible without Vitest, without PublicSessions, and without monkeypatching pg, Pool, Client or their returned promises. The immediate cause is that the existing 500 ms pool acquisition deadline expires while requests assigned to newly opening physical connections are still waiting for those connections. This is a cold connection readiness limitation under the measured conditions; the evidence does not identify the underlying reason for the slow PostgreSQL backend startup (for example, storage or OS effects were not isolated).

The fixture has one established idle connection after migration/create, but does not establish eight ready connections before the concurrency test. pg-pool queues the burst when an idle client exists, then promptly assigns seven requests to new clients. A queued item's original acquisition timer remains active through newClient startup. Later idle connections do not replace the new client already assigned to that item. Consequently, this timeout can occur with idle clients and a pool below max 10; that state is not evidence of a connection leak.

## Reproduction evidence

All below retain max 10 and connectionTimeoutMillis 500. Timing is diagnostic observation, not a production performance guarantee.

| Case | Outcome | Evidence |
|---|---|---|
| Original unchanged four-test Vitest file | First test failed at about 603 ms; other 3 passed; total about 55 s | `alpha12-sessions-vitest.json` |
| Original first test with timing/category instrumentation | Failed; newly opened physical connections completed in 329.5, 363.8, 388.9, 423.1, 466.7, 530.3 and 535.7 ms | `alpha12-vitest-instrumented-result.json`, `alpha12-vitest-pool-trace.json` |
| Standalone PublicSessions, original connector and Promise.all 8; no pg instrumentation | 528.7 ms, 6 successful / 2 queue timeouts; refresh called once | `alpha12-untouched-direct-result.json` |
| Standalone raw pg, one idle client then Promise.all 8 SELECT 1; no instrumentation | 513.9 ms, 6 successful / 2 queue timeouts; final total 8, idle 6, waiting 0 | Same report |
| Minimal Vitest raw pg, one idle client then Promise.all 8 SELECT 1; no instrumentation | 513.0 ms, 6 successful / 2 queue timeouts; event loop max lag 21.5 ms | `alpha12-minimal-pool-observations.json`, `alpha12-minimal-pool-vitest-result.json` |
| Immediate reuse of the same minimal raw pool | 289.0 ms, 8 successful / 0 failures; final total 8, idle 8, waiting 0 | Same minimal report |

An earlier instrumented standalone run completed a fresh SELECT burst in about 58 ms and session burst in about 62 ms. Its wrappers changed Promise/callback ordering, and it was a different run. It is not representative of the unchanged baseline and does not supersede the cold-burst failures above.

The task-only `alpha12-minimal-pool.test.mts` retains an all-eight-success assertion for the cold case. It currently fails; it does not expect a timeout, skip the cold case or redefine the failure as success. Its first test's eight original promises are all settled before fixture cleanup. The warm-only result must not be described as resolving this cold regression.

## Release, scheduling and backend evidence

The instrumented original test records:

- Eight acquisition requests while total 1 / idle 1; _pulseQueue and nextTick ran within about 2–11 ms; seven new physical clients started, bringing total to 8 (below max 10).
- TCP connection events completed in about 19–25 ms. Physical pg connect completion extended to 530–536 ms. Synthetic pg_stat_activity samples showed backends in `starting` while they were being established.
- Queue timeouts occurred at 507.5 and 539.6 ms with total 8 / idle 4 / waiting 0. Only two active leases remained, with maximum observed lease age about 109 ms at the second timeout. Event-loop maximum lag was 36.2 ms.
- The original transaction on the established client completed/released normally before external token refresh. Its subsequent refresh-result update also released normally. SQL categories were recorded without parameters or URLs.
- At diagnostic afterAll, pool total / idle / waiting and active leases were all zero.

Read-only source analysis of PublicSessions, migrate, Kysely's connection providers and pg-pool found no nested checkout or missing release on these paths. This does not prove every application path is leak-free; it rules out that explanation for the measured cold burst. No fake timers or mocked nextTick were active in the measured original test.

## Cleanup and scope

Every generated diagnostic cluster was stopped and removed. For the original, instrumented and final minimal Vitest runs, deletion occurred only after native pg_ctl status returned 3 and the resolved generated directory was checked under the expected .local root. The untouched standalone report records stopReturned true / pgCtlStatus 3 / clusterRemoved true. Relevant receipts:

- `alpha12-sessions-vitest-cleanup.json`: pg-alpha12-6xRqWc, status 3 before/after, removed.
- `alpha12-vitest-instrumented-cleanup.json`: pg-alpha12-TJhXvO, status 3, removed.
- `alpha12-untouched-direct-result.json`: stop returned, status 3, removed.
- `alpha12-minimal-pool-cleanup.json`: pg-alpha12-fQUe59, status 3, removed.

No real secret values, full query parameters, database URLs or process command lines were recorded. Repository production source and the original test file were not edited by this agent during diagnosis. No further database diagnostic is running; the operator-policy agent was informed the DB slot is free.

## Minimal next step

The parent separately authorized the operator-policy agent to establish the existing concurrency test's ready-pool precondition: hold eight read-only connections acquired one at a time, then release all in finally before the unchanged original four tests. This can isolate session concurrency behavior from cold pool startup. It does not fix or certify cold production startup. Keep the cold-burst failure above as an operational readiness limitation. Do not change auth semantics, max 10 or the 500 ms deadline merely to claim a pass. The follow-up four-test result is owned by that agent and is not included in this report.

Evidence files named above are retained under `C:/Users/pc-ad/Documents/Codex/2026-10-18/task/`, outside the source and public site. The separate source cold regression and final warm-only results are recorded below; they do not establish production readiness.

## Follow-up regression separation

The existing `tests/integration/alpha12-sessions.test.ts` now explicitly prepares eight distinct authenticated connections sequentially, using only SELECT 1 during preparation before its unchanged four test bodies. Each acquisition still uses the production connector max 10 / 500 ms deadline. All held leases are released in finally and all completions are observed; setup failures remain failures. This is a warm refresh/authentication semantics check only.

The separate `tests/integration/alpha12-sessions-cold.test.ts` retains the original cold eight-reader condition and requires all eight to succeed. It is included by the default integration glob and has no skip, expected-failure marker or deadline override. Every request is settled before assertion/cleanup. A cold failure continues to keep full integration acceptance red; a warm-only run does not close the operational limitation.

Final warm-only run: 4/4 pass; first refresh test 866.0334 ms (whole-test duration). The 500 ms setting is per connection acquisition, so this whole-test number is not a changed acquisition deadline. Report: `alpha12-sessions-warm-vitest.json`. The final corrected cold regression observed 6 fulfilled / 2 timeouts in 514.04 ms (whole-test duration 640.5448 ms), and the all-success assertion failed. Report: `alpha12-sessions-cold-verified-vitest.json`. The cleanup hook succeeded: pg_ctl status 3 was checked after the owned fixture stopped, the resolved direct-child path was validated, and the generated cluster directory was removed. The earlier 518.66 ms and 511.73 ms cold-failure reports remain unchanged as investigation history.

On Windows, embedded-postgres force-terminates its owned test process and may leave postmaster.pid. A PID file alone is therefore not a running-server check. The new cold fixture resolves the installed public binary package (win32 maps to windows), runs read-only pg_ctl status for its own directory, and requires numeric exit 3 before deletion. Missing tools, errors, timeout, running status or unsafe paths stop cleanup instead of being treated as success. No shared fixture or production shutdown code was changed.

Final validation of this follow-up: full repository typecheck passed (alpha17-db-final-typecheck.log), the changed two test files passed ESLint, source secret scan passed for 1600 listed source files without printing values, and git diff --check passed. Git diff verification confirms production packages/db/src/index.ts and packages/security/src/public-sessions.ts, package/lock/workspace files, and apps/web/next-env.d.ts remain unchanged.

Both warm fixture runs were also independently confirmed stopped and removed: pg-alpha12-n5hmEY and pg-alpha12-1sNoul. Creation times matched these runs; each resolved non-reparse direct-child directory was removed only after pg_ctl status 3. Receipt: alpha12-sessions-warm-cleanup-verification.json. This cleanup covers the connection-diagnosis and cold/warm follow-up fixtures only; no unrelated cluster was modified.

## Approved Linux production-image comparison

After the user's second restart, WSL/VMP were enabled, Docker Desktop 4.95.0 installed successfully, and Docker Engine 29.8.2 linux/amd64 responded on the explicit local named pipe. The user separately approved Desktop/WSL initialization and a disposable, externally unpublished synthetic DB test with cleanup. No production environment, credential, volume or migration was used.

The independently reviewed task-only runner pulled postgres:18.6-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336. It used isolated empty Docker config, whitelist child environments, synthetic-only authentication without printing values, a UUID/label-owned container and volume, and only 127.0.0.1 publication. Separate pools retained max10 and 500ms per acquisition; cold started with one ready idle connection, warm prepared eight distinct connections sequentially.

| Case | Result | Eight-request elapsed time |
|---|---|---:|
| Raw SELECT cold | 8 fulfilled / 0 rejected, PASS | 97.064 ms |
| Raw SELECT warm | 8 fulfilled / 0 rejected, PASS | 13.130 ms |
| PublicSessions cold | 8 fulfilled / 0 rejected, PASS | 335.455 ms |
| PublicSessions warm | 8 fulfilled / 0 rejected, PASS | 781.876 ms |

Session whole-burst durations include refresh waiting and are not acquisition deadline measurements. Single refresh, encryption, reread, invalid-cookie rejection and revocation assertions also passed. Runner exit0; owned container, volume and isolated config removal were verified, cleanup.complete=true, with no uncertain create outcome. The fixed image cache and nonsecret reports remain.

Evidence: task/alpha12-linux-pg-c2094cd0-d680-4b42-9d99-c7deec4264c2/{run.json,measurement.json}; task/alpha12-linux-pg-runner.mjs and alpha12-linux-pg-measurement.mts. Runner/measurement were independently reviewed before execution.

This establishes success for these synthetic cases on the intended Linux PG18.6 image. It does not repair or overwrite the original native Windows PG18.4 beta cold failure, certify long-running production startup, or establish real credential/ACL/backup/reboot/Tunnel acceptance. The default native cold regression still records a positive all-eight-success requirement and its known failure.
