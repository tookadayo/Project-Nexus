-- A narrow response projection avoids parsing every message fact in dashboard windows.
-- It contains metadata only. Historical reply semantics retain their original version.
CREATE TABLE message_observations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,fact_id uuid NOT NULL,
 episode_id uuid NOT NULL,message_id text,channel_id text,sent_at timestamptz NOT NULL,
 first_reply_seconds double precision,definition_version text NOT NULL,recipe_version_id uuid,collection_epoch_id uuid,
 PRIMARY KEY(organization_id,guild_id,fact_id),
 FOREIGN KEY(organization_id,guild_id,fact_id) REFERENCES lifecycle_events ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,recipe_version_id) REFERENCES measurement_recipe_versions ON DELETE SET NULL(recipe_version_id),
 FOREIGN KEY(organization_id,guild_id,collection_epoch_id) REFERENCES collection_epochs ON DELETE SET NULL(collection_epoch_id),
 CHECK(first_reply_seconds IS NULL OR first_reply_seconds>=0)
);
CREATE INDEX message_observations_window ON message_observations(organization_id,guild_id,sent_at) INCLUDE(episode_id,channel_id,first_reply_seconds);
CREATE INDEX message_observations_episode ON message_observations(organization_id,guild_id,episode_id,sent_at);
CREATE FUNCTION nexus_project_message_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.kind<>'message.sent' OR NEW.context<>'PRODUCTION' THEN
  DELETE FROM message_observations WHERE organization_id=OLD.organization_id AND guild_id=OLD.guild_id AND fact_id=OLD.id;
  RETURN OLD;
 END IF;
 INSERT INTO message_observations VALUES(NEW.organization_id,NEW.guild_id,NEW.id,NEW.episode_id,NEW.data->>'messageId',NEW.data->>'channelId',NEW.occurred_at,
  CASE WHEN NEW.definition_version='observation-v3' AND jsonb_typeof(NEW.data->'firstReplyLatencySeconds')='number' AND (NEW.data->>'firstReplyLatencySeconds')::double precision>=0 THEN (NEW.data->>'firstReplyLatencySeconds')::double precision ELSE NULL END,
  NEW.definition_version,NEW.recipe_version_id,NEW.collection_epoch_id)
 ON CONFLICT(organization_id,guild_id,fact_id) DO UPDATE SET episode_id=EXCLUDED.episode_id,message_id=EXCLUDED.message_id,channel_id=EXCLUDED.channel_id,sent_at=EXCLUDED.sent_at,first_reply_seconds=EXCLUDED.first_reply_seconds,definition_version=EXCLUDED.definition_version,recipe_version_id=EXCLUDED.recipe_version_id,collection_epoch_id=EXCLUDED.collection_epoch_id;
 RETURN NEW;
END $$;
CREATE TRIGGER message_observation_projection AFTER INSERT OR UPDATE OR DELETE ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION nexus_project_message_observation();
CREATE FUNCTION nexus_rebuild_message_observations(org uuid,guild text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy:'||org||':'||guild,0));
 DELETE FROM message_observations WHERE organization_id=org AND guild_id=guild;
 INSERT INTO message_observations
 SELECT organization_id,guild_id,id,episode_id,data->>'messageId',data->>'channelId',occurred_at,
 CASE WHEN definition_version='observation-v3' AND jsonb_typeof(data->'firstReplyLatencySeconds')='number' AND (data->>'firstReplyLatencySeconds')::double precision>=0 THEN (data->>'firstReplyLatencySeconds')::double precision ELSE NULL END,
 definition_version,recipe_version_id,collection_epoch_id FROM lifecycle_events WHERE organization_id=org AND guild_id=guild AND kind='message.sent' AND context='PRODUCTION';
END $$;
INSERT INTO message_observations
 SELECT organization_id,guild_id,id,episode_id,data->>'messageId',data->>'channelId',occurred_at,
 CASE WHEN definition_version='observation-v3' AND jsonb_typeof(data->'firstReplyLatencySeconds')='number' AND (data->>'firstReplyLatencySeconds')::double precision>=0 THEN (data->>'firstReplyLatencySeconds')::double precision ELSE NULL END,
 definition_version,recipe_version_id,collection_epoch_id FROM lifecycle_events WHERE kind='message.sent' AND context='PRODUCTION';
