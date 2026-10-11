# Backup, restore and delivery recovery

PostgreSQL is canonical for the normalized durable inbox, projections, immutable recipes, attention, verification and action outbox. Redis streams and worker wakeups can be reconstructed; they are not the only copy of an accepted event.

Before hosted beta, configure encrypted PostgreSQL backups and point-in-time recovery, retention/access controls, off-host storage and tested recovery targets. Protect IdentityVault/encryption/lookup keys separately; a DB backup without the matching keys cannot route or decrypt identity. Keys and tokens must never appear in command history, logs or public artifacts.

Restore drill:

1. Restore a consistent backup into an isolated environment. Disable Gateway and Discord outbound transports before starting workers.
2. Match encryption/lookup key versions through the deployment secret manager. Run additive migrations through 051; verify schema and immutable recipe revisions. Keep every ingress, public endpoint and outbound transport closed.
3. Apply the **newest protected deletion tombstone export**, which may be newer than the restored DB backup, using the offline procedure in [alpha12 operator operations](alpha12-operator-operations.md). This reapplies scoped Guild/member deletion and revokes every restored public/operator session. An older DONE marker does not authorize restored data. Missing keys, identity evidence, current tombstones or incomplete queue scrub mean remain offline. Verify org/guild scoping, UNKNOWN legacy flags and retained epoch attribution after erasure.
4. Compare source fact counts and typed daily projections. Use `nexus_rebuild_guild_rollups(organization_id, guild_id)` under a scoped privacy transaction if a repair is required.
5. Replay pending durable inbox events through idempotent projectors. Expired ambiguous creates/sends remain UNKNOWN for review; do not enqueue them as new messages. Safe edits/deletes may use their bounded retry policy.
6. Reconcile outbox leases/backlog, integration freshness, collection gaps and retained panel/role ownership before reconnecting the controlled Discord app.
7. Record elapsed restore time, lost-data boundary, duplicate-write results, deletion results and operator approval before production restoration.

Local migration/replay/projection tests do not substitute for a hosted encrypted backup/restore drill. That drill remains a hosted beta blocker until deployment infrastructure exists.

alpha12 supplies encrypted, minimal tombstone export/application code, not an
automatic off-host backup or deletion journal replication service. Export before
backups and after new deletions; separately protect current archives and keys.
Do not retire tombstones while a covered backup is still restoreable. Actual
backup expiry, continuous preservation of newer deletions and Windows ACL/restore
acceptance remain release gates. A DB restore cannot undo an external effect or
legitimate erasure, and a stale archive is not acceptable proof of recovery.
