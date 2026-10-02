# Collection epochs and integration health

`collection_epochs` records tenant-scoped observation intervals, their start/end reasons and the capability snapshot when available. Epochs are additive. Migration does not invent historical intervals or attach old facts to guessed epochs. New lifecycle and adaptive facts receive an epoch only when their event timestamp is inside an observed interval. Historical events received after installation can remain unattributed.

Gateway connection, accepted intent configuration, heartbeat, disconnect, resume and process restart are separate observations. A heartbeat by itself cannot prove that the Guild Members intent is available. Delivered events can prove their own intent is delivering; they do not prove unrelated intents. A denied privileged intent marks member measurements unavailable. Outdated health packets cannot replace newer health or destroy current voice observation state.

Missing heartbeats, disconnection intervals, durable delivery failures and holes between epochs become comparison blockers. Restart and reconnect end live voice clocks so downtime never becomes co-presence. The inbox and projection use at-least-once delivery with tenant-scoped deduplication; dispatch ordinals distinguish multiple normalized events sharing a sequence.

`discord_integration_health` stores safe availability categories and timestamps, not tokens or exception text. A connection is stale after the existing 90-second heartbeat tolerance. Capability discovery is stale after one hour or a newer failed refresh. Metric-specific requirements decide which unavailable input invalidates a measurement.

Guild deletion removes epochs and health. Closed epochs follow detailed-data retention. Open epochs are routing state; they do not contain member identity. Fact references become null when an old epoch is purged, so attribution is never manufactured after retention.

Channel census: before the [2026-11-16 rollout](https://docs.discord.com/developers/change-log#channel-obfuscation-for-users-and-bots), a successful complete channel response can establish a known total. Afterwards, [Get Guild Channels](https://docs.discord.com/developers/resources/guild) returns visible channels only. NEXUS records a lower bound and a null total/ratio. Gateway `ChannelObfuscated` payloads retain only the official usable fields (`id`, `type`, `parent_id`; position is unused); hidden names, owners and tags are not interpreted. Restored visibility requires a newer complete payload. Verified 2026-10-02.
