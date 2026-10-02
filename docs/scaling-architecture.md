# Scaling Community Operations

PostgreSQL is canonical storage. The durable Gateway inbox, tenant-scoped idempotent projectors, typed current state, daily contributions, and transactional action outbox remain the pipeline. Redis transports work; Kafka is not required.

## Typed state and rollups

Migration 031 adds reaction edges and reset watermarks, independent poll answer/participant state, voice session tombstones, `lifecycle_daily_rollups`, `member_daily_activity`, and the aggregate `surface_daily_rollups` view. Generic alpha.4 states/facts remain compatibility projections. Session/sequence/ordinal ordering prevents replay from resurrecting removed state. Tied clocks across sessions are ambiguous and block current-state metrics.

Daily lifecycle contributions preserve first/last metadata, observation counts, definition and recipe versions, and collection epoch IDs. They exclude message content. A dashboard reads interior UTC days from these contributions and reads raw facts only for its two exact boundary days. It still reads selected reply facts for latency distributions; a daily average cannot substitute for a median. Member deletion cascades through contribution rows; guild deletion and retention also purge typed state. `nexus_rebuild_guild_rollups` reconstructs contributions under the existing scoped privacy lock.

Voice uses one accumulated clock per channel and one session per participant. Qualification is bounded to 500 sessions per tick. It never creates a pair graph, and a Gateway gap invalidates active clocks. Interaction pairs carry `DIRECT_REPLY` provenance; legacy unknown pairs are excluded from connection analysis.

## Measurements during implementation

Same Windows host, local PostgreSQL, synthetic fixtures, 2026-10-02. These are fixture measurements, not production latency promises. alpha.4 assertions passed, but its sandboxed process cleanup failed; alpha.5 runs use the environment that permits PostgreSQL shutdown.

| Fixture                | alpha.4 | alpha.5 preliminary | Change |
| ---------------------- | ------: | ------------------: | -----: |
| 10,000 members         | 2,798ms |             2,924ms |  +4.5% |
| 50,000 members         | 2,258ms |             3,150ms | +39.5% |
| 600 Voice participants | 2,443ms |             2,663ms |  +9.0% |

The 50k result exceeds the default 20% regression goal and needs further profiling. It additionally computes versioned journeys, health/evidence, and queue operations; these checks must not be removed to improve the number. Final measurements and any remaining exception belong in the quality audit.

Synthetic read-path fixtures explicitly seed known member flags and healthy observation before asserting eligible counts. They rebuild daily projections after bulk fact loading; they do not treat legacy default-false member rows as observed.
