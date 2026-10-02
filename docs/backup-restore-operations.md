# Backup, restore and delivery recovery

PostgreSQL is canonical for the normalized durable inbox, projections, immutable recipes, attention, verification and action outbox. Redis streams and worker wakeups can be reconstructed; they are not the only copy of an accepted event.

Before hosted beta, configure encrypted PostgreSQL backups and point-in-time recovery, retention/access controls, off-host storage and tested recovery targets. Protect IdentityVault/encryption/lookup keys separately; a DB backup without the matching keys cannot route or decrypt identity. Keys and tokens must never appear in command history, logs or public artifacts.

Restore drill:

1. Restore a consistent backup into an isolated environment. Disable Gateway and Discord outbound transports before starting workers.
2. Match encryption/lookup key versions through the deployment secret manager. Run additive migrations; verify schema and immutable recipe revisions.
3. Verify org/guild scoping, UNKNOWN legacy flags, retained epoch attribution and member/guild deletion.
4. Compare source fact counts and typed daily projections. Use `nexus_rebuild_guild_rollups(organization_id, guild_id)` under a scoped privacy transaction if a repair is required.
5. Replay pending durable inbox events through idempotent projectors. Expired ambiguous creates/sends remain UNKNOWN for review; do not enqueue them as new messages. Safe edits/deletes may use their bounded retry policy.
6. Reconcile outbox leases/backlog, integration freshness, collection gaps and retained panel/role ownership before reconnecting the controlled Discord app.
7. Record elapsed restore time, lost-data boundary, duplicate-write results, deletion results and operator approval before production restoration.

Local migration/replay/projection tests do not substitute for a hosted encrypted backup/restore drill. That drill remains a hosted beta blocker until deployment infrastructure exists.
