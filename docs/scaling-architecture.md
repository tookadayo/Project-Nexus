# Scaling Community Operations

PostgreSQL is canonical storage. The durable Gateway inbox, tenant-scoped idempotent projectors, typed current state, daily contributions and transactional action outbox remain the pipeline. Redis transports existing work; no Kafka migration is introduced.

## Typed state and bounded reads

Migration 031 adds reaction state/reset watermarks, independent poll answer/participant state, voice session tombstones, lifecycle daily contributions, member/day activity and the surface aggregate view. Generic alpha.4 states/facts remain compatibility projections. Session/sequence/ordinal ordering prevents replay from resurrecting removed state. Equal ambiguous clocks across sessions invalidate the affected current state.

Daily contributions retain first/last metadata, counts, definition/recipe versions and collection epoch IDs. Only whitelisted metadata enters rollups. Dashboard activity reads interior UTC days from contributions and raw facts on the exact window edges plus the optional interior reaction cutoff day. It does not scan 30 days of raw message facts. Reaction counts preserve the exact cutoff, and journey transitions reuse the already scoped eligible activity observations instead of reading the same activity twice.

Migration 033 adds metadata-only message observations and versioned first direct-reply latency. The first-post query selects eligible newcomers before joining messages and counts one first scoped post per member. Medians are calculated from those observations, not daily averages. Legacy ambiguous replies remain unproved. Migration 034 adds separately proved eligible retention counters; anonymous alpha.4 counters stay historical and never become eligible denominators.

Member deletion cascades through personal contributions/message projections/retention tracking. Guild deletion removes all scoped domains. Detailed retention applies to member-linked daily projections; anonymous eligible retention counters follow the existing aggregate retention. Rebuild functions use the scoped privacy lock. Run ANALYZE after a bulk import or rebuild; production autovacuum/analyze must remain enabled. Fixture bulk loads explicitly update planner statistics, since a newly populated table has no normal background warm-up period.

Voice uses one accumulated clock per channel and one session per participant, with at most 500 qualification candidates per tick. It advances through observed Gateway time, never wall-clock downtime, and invalidates active clocks on a gap. The 600-participant fixture creates no pair graph. Direct-reply interaction pairs have explicit provenance; old UNKNOWN provenance is excluded.

## Final fixture results

2026-10-02, Windows, Node 24.18.1, local PostgreSQL. These are representative fixture measurements, not hosted latency promises. alpha.4 assertions passed, but sandboxed PostgreSQL cleanup failed; alpha.5 uses the environment permitting normal process shutdown.

| Fixture                | alpha.4 | alpha.5 | Change |
| ---------------------- | ------: | ------: | -----: |
| 10,000 members         | 2,798ms |   408ms | -85.4% |
| 50,000 members         | 2,258ms | 2,335ms |  +3.4% |
| 600 Voice participants | 2,443ms | 2,395ms |  -2.0% |

All representative results stay within the 20% regression goal. New calculations include immutable recipe attribution, aggregate journeys, metric-specific evidence, health and team queue operations. Typed current reaction/poll state is populated with the same logical participation workload. Known eligibility and continuous healthy observation are explicit fixture evidence, not inferred default-false rows. Final measurements retain existing 10k/50k timeout assertions.

The separate deterministic rollup fixture contains 200,000 message facts for 500 members over 20 days. Raw and compact reads preserve the same activity signature. Median of three reads: raw 295ms, compact 94ms; returned rows 200,000 → 20,000. Rebuild: 2,371ms. The prepared and standalone journey paths and interior reaction boundary are also regression tested.

## Operational limits

Integration Operations exposes projection lag, inbox/outbox/refresh backlog and safe error categories. OpenTelemetry-compatible spans/instruments cover normalize/persist/project/rollup/evidence and authorization/mutation/outbox/REST boundaries. Pool saturation, exporter retention, hosted p95/load tests, backup scheduling and restore drills require deployment configuration. No production latency or exactly-once delivery guarantee is claimed. See [background processing](background-processing.md) and [backup/restore operations](backup-restore-operations.md).
