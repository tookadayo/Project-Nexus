# alpha16 isolated database verification — 2026-10-16

The parent authorized the combined verification phase after implementation.
Every current integration file was executed. The latest complete result for each
file is **108 files / 1,058 tests passed**, with no failed, skipped, blocked or
unexecuted file/test and no unresolved unhandled error. This is a file-level
merge of recorded batches, not a claim that one command ran all tests green.

| Latest results by file group | Files | Tests | Result |
| --- | ---: | ---: | --- |
| alpha16 | 33 | 173 | Passed |
| alpha15 regression | 33 | 389 | Passed |
| Other integration regression | 42 | 496 | Passed |
| Total | 108 | 1,058 | Passed |

The machine-readable authority is `.local/alpha16-db-latest-results.json`.
It records every file's counts, latest evidence log and historical batch
summaries. `.local/alpha16-db-ledger.mjs` regenerates it from saved logs, verifies
case counts against console summaries, checks available native Vitest JSON
reports, and replaces earlier results only when a later complete batch covers
the same file. Initial failures remain preserved in their original logs.

## Execution boundary

Commands used the installed Node/Vitest dependencies directly, with
`vitest.integration.ts`, `--fileParallelism=false` and `--maxWorkers=1`.
The fixture created fresh synthetic `nexus_test` PostgreSQL clusters under
project `.local`, bound to dynamic `127.0.0.1` ports. The shared fixture now reuses
that same isolated PostgreSQL implementation. When required, the existing local
Redis executable used a dynamic loopback port with persistence disabled.
`NEXUS_TEST_INFRA=embedded`, `REDIS_BINARY`, `TEMP` and `TMP` were process-local.
Database fixtures do not consume `DATABASE_URL` or `REDIS_URL`.

No existing database/cluster, Docker, dependency download, external HTTP service,
production data, production credential, permission grant, deployment or real
restore was used. An initial sandbox loopback EACCES attempt was interrupted and
excluded from test counts. The authorized exact test commands then ran with
escalation; no environment blocker remains for these database results.

All fixture stop hooks completed. A final read-only process inventory at
2026-10-16T12:19:09Z found zero `postgres` and zero `redis-server` processes.
Evidence is `.local/alpha16-db-process-check.json`. No existing service was
queried or stopped to obtain that result.

## Findings resolved during verification

Actual new databases applied migrations through 082. Tests exposed and verified
the repair of the shared immutable-payload trigger's zero-argument NULL handling,
native observation timestamp parameter casts, and the distinction between a
post observation and a structural channel event. Those source fixes were made
by their owning agents and rechecked in the final alpha16 batch.

Fixture corrections retained the production contracts: required original-source
columns and complete safety proofs, proper plan entitlements, exact current
authorization scopes, synthetic actor hashes, current full schema, schema count
82, explicit approved synthetic cooldown, and whole-second authored datetime
inputs. Runtime/derived clock precision and existing boundary assertions were
preserved. Legacy publication reader fixtures explicitly seed prior published
rows; actual unconfigured publish/withdraw and unreviewed legacy mutations stay
closed with 503/428 and unchanged state. No production gate was weakened to make
a test pass.

The final alpha16 batch includes operator/privacy, finite restore source expiry,
UNKNOWN safety roots, runtime admission, publication purge and STATIC fallback,
role-only access metadata, canonical context purge, source metadata, immutable
CASE/Fact storage, measured operating configuration, and webhook uncertainty.
These results establish synthetic integration behavior. They do not approve a
measured operating profile, independent safety lifetime or external provider,
and do not establish live Discord/onamae/Windows deployment readiness. The parent
records unit/type/lint/build/browser and Windows ACL outcomes separately.

## Evidence logs

- `.local/alpha16-db-alpha16-final.log` and `.vitest.json`: 33 files / 173 passed.
- `.local/alpha16-db-alpha15-fixes.log` and `.vitest.json`: full alpha15 rerun;
  the remaining four datetime fixtures are superseded by the next log.
- `.local/alpha16-db-temporal-fixtures.log` and `.vitest.json`: 4 files / 76 passed.
- `.local/alpha16-db-remaining.log`: initial remaining 41-file regression run;
  four corrected files are superseded by the next log.
- `.local/alpha16-db-legacy-fixes.log` and `.vitest.json`: 4 files / 58 passed.
- `.local/alpha16-db-webhook-source.log`: includes the 5-test existing operations
  API/webhook file, outside the alpha16/alpha15 filename groups.

The complete eleven-batch inventory and every file's exact latest log are in the
machine-readable report. There is no remaining database-test failure or blocker.
