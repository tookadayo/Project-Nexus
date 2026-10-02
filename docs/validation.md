# Alpha.5 validation record

2026-10-02, Windows, Node.js 24.18.1, pnpm 11.19.0. Base master: 557a5897a99fcb2c7a6d9766f84b476ac01f0f1f.

## Final local CI-equivalent gate

| Check                                      | Result | Final implementation run                                                      |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| ESLint                                     | PASS   | No errors                                                                     |
| TypeScript strict root / Web               | PASS   | Root check and Next production build                                          |
| Prettier                                   | PASS   | Changed TS/TSX/JSON/Markdown/YAML files; generated Next declarations excluded |
| Unit / property / Discord payload          | PASS   | 302 tests, 29 files, 4.91s                                                    |
| PostgreSQL / Redis integration             | PASS   | 146 tests, 13 files, 62.52s                                                   |
| Turborepo / Next production build          | PASS   | 19 packages; 25.115s (0 cached)                                               |
| Release status / version integration       | PASS   | 20 tests, 1 file, 5.53s                                                       |
| Frozen offline dependency synchronization  | PASS   | Lockfile unchanged                                                            |
| Browser E2E                                | PASS   | 22 tests, 1.0 minute                                                          |
| Production OAuth / Server Verification E2E | PASS   | 6 tests, 8.7s                                                                 |
| Performance                                | PASS   | 4 tests, 3 files, 107.18s                                                     |
| Windows runtime                            | PASS   | Runtime manager tests passed                                                  |
| Git whitespace check                       | PASS   | Generated Next declaration drift restored                                     |

Unit/property coverage includes member eligibility, forward/reply semantics, observation/coverage states, comparison/readiness gates, immutable recipes, rate limiting, privacy, auth, Components V2 limits and safe error copy. Payload tests use 12 cases / 10 snapshots. Integration includes deterministic reordered/replayed reaction/poll/voice cases, observation gaps, epoch attribution, attention races, safe retry/unknown outcomes, deletion during network work, tenant collisions and alpha.3/alpha.4 fixture upgrades through migration 034. No failed test is skipped, and no existing CI check or timeout assertion is removed.

Browser E2E uses synthetic fixtures in an isolated PostgreSQL database and the real API/Next services. It covers JA/EN, desktop/mobile, setup, improvement preview/confirmation/activation, saved attention during intent loss, ACK/snooze/resolve, all current dashboard/public surfaces and authorization. The alpha.5 matrix produces 164 screenshots across seven archetypes plus non-Community and eight observation states. Actual images were inspected across all archetypes and operations/model/public views; screenshots are archived locally in .local/alpha5-visual-final. Layout/payload approximation does not prove live Discord-client rendering.

## Performance

| Fixture                | alpha.4 | alpha.5 | Change |
| ---------------------- | ------: | ------: | -----: |
| 10,000 members         | 2,798ms |   408ms | -85.4% |
| 50,000 members         | 2,258ms | 2,335ms |  +3.4% |
| 600 Voice participants | 2,443ms | 2,395ms |  -2.0% |

All representative results meet the <=20% regression goal. Voice retains 600 sessions, one channel clock and zero pairs. The deterministic 200,000-fact read comparison preserves equivalent activity: raw median 295ms, compact 94ms, 200,000 → 20,000 returned rows; rebuild 2,371ms. These are local fixture measurements, not hosted latency promises. See [scaling architecture](scaling-architecture.md) for workload/planner and privacy details.

## Live and external status

- Live Discord acceptance: **PARTIAL**. Read-only bot-member metadata and capability discovery passed against one development guild with three visible channels and an explicitly known current total. No Discord write occurred. Controlled multi-account scenarios, live OAuth, Gateway reconnect/intent-loss and Developer Portal obfuscation acceptance were **NOT RUN**; controlled participants/seven-guild setup are unavailable.
- Channel Obfuscation code/fixture readiness: **PASS**. Real early Portal opt-in and post-2026-11-16 REST omission remain unverified.
- Privileged Intent fallback/runbook readiness: **PASS**. Actual Discord app approval/annual renewal is **NOT VERIFIED**.
- Linux Docker/Testcontainers execution: **NOT RUN** on this Windows host. The same suites use local real PostgreSQL/Redis; remote GitHub Actions is not claimed as locally executed.
- Hosted load, encrypted backup/PITR restore drill and exporter/alert deployment: **NOT RUN**. OAuth refresh custody/rotation/revocation remains a hosted-beta blocker.

Logs are local .local/alpha5-*.log artifacts. Deliberate simulated timeout/403/429/5xx failures produce safe diagnostic records; these are exercised fault paths, not failing tests. The finalized audit and final delivery report identify the release commit. Release unit, typecheck, lint, uncached build and status/version integration checks passed after version finalization. The complete functional, performance, browser, verification and runtime gate above passed on the same implementation before the release metadata change.
