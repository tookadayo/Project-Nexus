-- 046 remains immutable. Structure tombstones prevent stale discovery/retries
-- from resurrecting an explicitly deleted location.
ALTER TABLE discord_surface_state ADD COLUMN deleted_at timestamptz;
ALTER TABLE discord_surface_state ADD COLUMN collection_forbidden boolean NOT NULL DEFAULT false;

-- Location occurrence population, distinct from eligible member activity.
-- Metadata only: no body, attachment, name, Bot identity or Webhook identity.
CREATE TABLE location_post_observations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,message_id text NOT NULL,
 channel_id text NOT NULL,sent_at timestamptz NOT NULL,
 author_kind text NOT NULL CHECK(author_kind IN ('HUMAN','BOT','WEBHOOK','UNKNOWN')),
 subject_hash text,reference_id text,message_type integer NOT NULL,
 first_reply_seconds double precision CHECK(first_reply_seconds IS NULL OR first_reply_seconds>=0),
 definition_version text NOT NULL DEFAULT 'observation-v3',
 reply_source text CHECK(reply_source IN ('DIRECT','THREAD')),
 PRIMARY KEY(organization_id,guild_id,message_id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX location_post_window ON location_post_observations(organization_id,guild_id,sent_at,channel_id);
CREATE INDEX location_post_subject ON location_post_observations(organization_id,guild_id,subject_hash);
INSERT INTO location_post_observations(organization_id,guild_id,message_id,channel_id,sent_at,author_kind,subject_hash,reference_id,message_type,first_reply_seconds,definition_version,reply_source)
 SELECT o.organization_id,o.guild_id,o.message_id,o.channel_id,o.sent_at,'HUMAN',i.lookup_hash,
 f.data->>'referenceId',COALESCE((f.data->>'messageType')::integer,0),o.first_reply_seconds,o.definition_version,
 CASE WHEN o.first_reply_seconds IS NOT NULL THEN 'DIRECT' END
 FROM message_observations o JOIN lifecycle_events f ON f.organization_id=o.organization_id AND f.guild_id=o.guild_id AND f.id=o.fact_id
 JOIN membership_episodes e ON e.organization_id=o.organization_id AND e.guild_id=o.guild_id AND e.id=o.episode_id
 JOIN member_identity_map i ON i.organization_id=e.organization_id AND i.guild_id=e.guild_id AND i.id=e.identity_id
 WHERE o.message_id IS NOT NULL AND o.channel_id IS NOT NULL ON CONFLICT DO NOTHING;
