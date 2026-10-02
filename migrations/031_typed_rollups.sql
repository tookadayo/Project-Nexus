-- Compact, typed high-volume state. Generic alpha.4 projections remain compatibility readers.
CREATE TABLE reaction_state (
 organization_id uuid NOT NULL,guild_id text NOT NULL,channel_id text NOT NULL,message_id text NOT NULL,
 emoji_hash text NOT NULL,reaction_type integer NOT NULL,subject_hash text NOT NULL,target_hash text,
 active boolean NOT NULL,observed_at timestamptz NOT NULL,source_session text,source_sequence bigint,source_ordinal integer,
 ambiguous boolean NOT NULL DEFAULT false,definition_version text NOT NULL DEFAULT 'observation-v3',
 PRIMARY KEY(organization_id,guild_id,channel_id,message_id,emoji_hash,reaction_type,subject_hash),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX reaction_active_window ON reaction_state(organization_id,guild_id,observed_at) WHERE active;
CREATE INDEX reaction_subject ON reaction_state(organization_id,guild_id,subject_hash);
CREATE INDEX reaction_target ON reaction_state(organization_id,guild_id,target_hash);
CREATE TABLE reaction_resets (
 organization_id uuid NOT NULL,guild_id text NOT NULL,channel_id text NOT NULL,message_id text NOT NULL,emoji_key text NOT NULL,
 observed_at timestamptz NOT NULL,source_session text NOT NULL,source_sequence bigint NOT NULL,source_ordinal integer NOT NULL,
 PRIMARY KEY(organization_id,guild_id,channel_id,message_id,emoji_key),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE poll_answer_state (
 organization_id uuid NOT NULL,guild_id text NOT NULL,channel_id text NOT NULL,message_id text NOT NULL,subject_hash text NOT NULL,answer_hash text NOT NULL,
 active boolean NOT NULL,observed_at timestamptz NOT NULL,source_session text,source_sequence bigint,source_ordinal integer,ambiguous boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,guild_id,channel_id,message_id,subject_hash,answer_hash),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX poll_answer_subject ON poll_answer_state(organization_id,guild_id,subject_hash);
CREATE TABLE poll_participant_state (
 organization_id uuid NOT NULL,guild_id text NOT NULL,channel_id text NOT NULL,message_id text NOT NULL,subject_hash text NOT NULL,
 answer_count integer NOT NULL CHECK(answer_count>=0),observed_at timestamptz NOT NULL,ambiguous boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,guild_id,channel_id,message_id,subject_hash),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX poll_active_window ON poll_participant_state(organization_id,guild_id,observed_at) WHERE answer_count>0;
CREATE TABLE voice_sessions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,subject_hash text NOT NULL,episode_id uuid,
 channel_id text,joined_at timestamptz,observed_at timestamptz NOT NULL,baseline_seconds double precision NOT NULL DEFAULT 0,
 is_guest boolean NOT NULL,voice_known boolean NOT NULL,is_stage boolean NOT NULL,suppress boolean,qualified boolean NOT NULL,
 PRIMARY KEY(organization_id,guild_id,subject_hash),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE INDEX voice_active_channel ON voice_sessions(organization_id,guild_id,channel_id) WHERE channel_id IS NOT NULL;
CREATE FUNCTION nexus_sync_voice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.domain='voice' THEN UPDATE voice_sessions SET channel_id=NULL,joined_at=NULL WHERE organization_id=OLD.organization_id AND guild_id=OLD.guild_id AND subject_hash=OLD.subject_hash; END IF;
  RETURN OLD;
 END IF;
 IF NEW.domain='voice' AND NEW.data ? 'episodeId' THEN
  INSERT INTO voice_sessions VALUES(NEW.organization_id,NEW.guild_id,NEW.subject_hash,(NEW.data->>'episodeId')::uuid,NEW.data->>'channelId',(NEW.data->>'joinedAt')::timestamptz,NEW.observed_at,COALESCE((NEW.data->>'baseline')::double precision,0),COALESCE((NEW.data->>'guest')::boolean,true),COALESCE((NEW.data->>'voiceKnown')::boolean,false),COALESCE((NEW.data->>'stage')::boolean,false),(NEW.data->>'suppress')::boolean,COALESCE((NEW.data->>'connected')::boolean,false))
  ON CONFLICT(organization_id,guild_id,subject_hash) DO UPDATE SET episode_id=EXCLUDED.episode_id,channel_id=EXCLUDED.channel_id,joined_at=EXCLUDED.joined_at,observed_at=EXCLUDED.observed_at,baseline_seconds=EXCLUDED.baseline_seconds,is_guest=EXCLUDED.is_guest,voice_known=EXCLUDED.voice_known,is_stage=EXCLUDED.is_stage,suppress=EXCLUDED.suppress,qualified=EXCLUDED.qualified WHERE voice_sessions.observed_at<=EXCLUDED.observed_at;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER adaptive_voice_typed AFTER INSERT OR UPDATE OR DELETE ON adaptive_states FOR EACH ROW EXECUTE FUNCTION nexus_sync_voice();
-- Backfill only explicit current states, without fabricating ordering or historical collection.
INSERT INTO reaction_state(organization_id,guild_id,channel_id,message_id,emoji_hash,reaction_type,subject_hash,target_hash,active,observed_at,definition_version)
 SELECT organization_id,guild_id,data->>'channelId',data->>'messageId',data->>'emojiHash',COALESCE((data->>'reactionType')::integer,0),subject_hash,target_hash,(data->>'active')::boolean,observed_at,'alpha4-v1' FROM adaptive_states WHERE domain='reaction' AND data ? 'emojiHash' AND data ? 'channelId' AND data ? 'messageId' AND data ? 'active';
INSERT INTO poll_answer_state(organization_id,guild_id,channel_id,message_id,subject_hash,answer_hash,active,observed_at)
 SELECT organization_id,guild_id,data->>'channelId',data->>'messageId',subject_hash,answer,true,observed_at FROM adaptive_states CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(data->'answers','[]')) answer WHERE domain='poll';
INSERT INTO poll_participant_state SELECT organization_id,guild_id,channel_id,message_id,subject_hash,count(*)::integer,max(observed_at),false FROM poll_answer_state GROUP BY organization_id,guild_id,channel_id,message_id,subject_hash;

CREATE TABLE lifecycle_daily_rollups (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,day date NOT NULL,
 kind text NOT NULL,channel_key text NOT NULL,definition_version text NOT NULL,recipe_key text NOT NULL,
 first_at timestamptz NOT NULL,last_at timestamptz NOT NULL,first_id uuid NOT NULL,last_id uuid NOT NULL,
 observations bigint NOT NULL,first_data jsonb NOT NULL,last_data jsonb NOT NULL,epoch_ids uuid[] NOT NULL DEFAULT '{}',
 PRIMARY KEY(organization_id,guild_id,episode_id,day,kind,channel_key,definition_version,recipe_key),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE INDEX lifecycle_rollup_window ON lifecycle_daily_rollups(organization_id,guild_id,day);
CREATE TABLE member_daily_activity (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,day date NOT NULL,
 first_activity_at timestamptz NOT NULL,last_activity_at timestamptz NOT NULL,signal_bits integer NOT NULL,
 direct_reply_received boolean NOT NULL,thread_response_received boolean NOT NULL,qualified_voice_copresence boolean NOT NULL,
 poll_participated boolean NOT NULL,reaction_received boolean NOT NULL,event_attended boolean NOT NULL,
 PRIMARY KEY(organization_id,guild_id,episode_id,day),FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE INDEX member_activity_window ON member_daily_activity(organization_id,guild_id,day);
CREATE FUNCTION nexus_rollup_data(data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(data) WHERE key IN ('channelId','messageId','messageType','receivedExplicitReply','receivedHumanParticipant','firstReplyLatencySeconds','latencySeconds','seconds','eventId','entityType','suppress','definitionId','definitionVersion','roleId');
$$;
CREATE FUNCTION nexus_activity_bits(kind text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE kind WHEN 'message.sent' THEN 1 WHEN 'reply.received' THEN 2 WHEN 'thread.response_received' THEN 4 WHEN 'voice.connected' THEN 8 WHEN 'poll.participated' THEN 16 WHEN 'reaction.received' THEN 32 WHEN 'scheduled_event.attended' THEN 64 WHEN 'voice.started' THEN 128 WHEN 'reaction.added' THEN 256 ELSE 512 END;
$$;
CREATE FUNCTION nexus_refresh_member_day(org uuid,guild text,episode uuid,activity_day date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM member_daily_activity WHERE organization_id=org AND guild_id=guild AND episode_id=episode AND day=activity_day;
 INSERT INTO member_daily_activity SELECT org,guild,episode,activity_day,min(first_at),max(last_at),bit_or(nexus_activity_bits(kind)),bool_or(kind='reply.received'),bool_or(kind='thread.response_received'),bool_or(kind='voice.connected'),bool_or(kind='poll.participated'),bool_or(kind='reaction.received'),bool_or(kind='scheduled_event.attended') FROM lifecycle_daily_rollups WHERE organization_id=org AND guild_id=guild AND episode_id=episode AND day=activity_day AND EXISTS(SELECT 1 FROM membership_episodes WHERE organization_id=org AND guild_id=guild AND id=episode) HAVING count(*)>0;
END $$;
CREATE FUNCTION nexus_rebuild_rollup_key(event lifecycle_events) RETURNS void LANGUAGE plpgsql AS $$
DECLARE activity_day date=(event.occurred_at AT TIME ZONE 'UTC')::date;
BEGIN
 DELETE FROM lifecycle_daily_rollups WHERE organization_id=event.organization_id AND guild_id=event.guild_id AND episode_id=event.episode_id AND day=activity_day AND kind=event.kind AND channel_key=COALESCE(event.data->>'channelId','') AND definition_version=event.definition_version AND recipe_key=COALESCE(event.recipe_version_id::text,'');
 INSERT INTO lifecycle_daily_rollups SELECT f.organization_id,f.guild_id,f.episode_id,activity_day,f.kind,COALESCE(f.data->>'channelId',''),f.definition_version,COALESCE(f.recipe_version_id::text,''),min(f.occurred_at),max(f.occurred_at),(array_agg(f.id ORDER BY f.occurred_at,f.id))[1],(array_agg(f.id ORDER BY f.occurred_at DESC,f.id DESC))[1],count(*),(array_agg(nexus_rollup_data(f.data) ORDER BY f.occurred_at,f.id))[1],(array_agg(nexus_rollup_data(f.data) ORDER BY f.occurred_at DESC,f.id DESC))[1],COALESCE(array_agg(DISTINCT f.collection_epoch_id) FILTER(WHERE f.collection_epoch_id IS NOT NULL),'{}'::uuid[])
 FROM lifecycle_events f WHERE f.organization_id=event.organization_id AND f.guild_id=event.guild_id AND f.episode_id=event.episode_id AND f.context='PRODUCTION' AND f.kind=event.kind AND COALESCE(f.data->>'channelId','')=COALESCE(event.data->>'channelId','') AND f.occurred_at>=(activity_day::timestamp AT TIME ZONE 'UTC') AND f.occurred_at<((activity_day+1)::timestamp AT TIME ZONE 'UTC') AND f.definition_version=event.definition_version AND COALESCE(f.recipe_version_id::text,'')=COALESCE(event.recipe_version_id::text,'') AND EXISTS(SELECT 1 FROM membership_episodes e WHERE e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id) GROUP BY f.organization_id,f.guild_id,f.episode_id,f.kind,f.definition_version,COALESCE(f.data->>'channelId',''),COALESCE(f.recipe_version_id::text,'');
 PERFORM nexus_refresh_member_day(event.organization_id,event.guild_id,event.episode_id,activity_day);
END $$;
CREATE FUNCTION nexus_project_daily_rollup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN PERFORM nexus_rebuild_rollup_key(OLD);RETURN OLD; END IF;
 IF TG_OP='UPDATE' THEN PERFORM nexus_rebuild_rollup_key(OLD);IF (NEW.organization_id,NEW.guild_id,NEW.episode_id,NEW.occurred_at,NEW.kind,NEW.data->>'channelId',NEW.definition_version,NEW.recipe_version_id) IS DISTINCT FROM (OLD.organization_id,OLD.guild_id,OLD.episode_id,OLD.occurred_at,OLD.kind,OLD.data->>'channelId',OLD.definition_version,OLD.recipe_version_id) THEN PERFORM nexus_rebuild_rollup_key(NEW);END IF;RETURN NEW; END IF;
 IF NEW.context<>'PRODUCTION' THEN RETURN NEW; END IF;
 INSERT INTO lifecycle_daily_rollups VALUES(NEW.organization_id,NEW.guild_id,NEW.episode_id,(NEW.occurred_at AT TIME ZONE 'UTC')::date,NEW.kind,COALESCE(NEW.data->>'channelId',''),NEW.definition_version,COALESCE(NEW.recipe_version_id::text,''),NEW.occurred_at,NEW.occurred_at,NEW.id,NEW.id,1,nexus_rollup_data(NEW.data),nexus_rollup_data(NEW.data),CASE WHEN NEW.collection_epoch_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[NEW.collection_epoch_id] END)
 ON CONFLICT(organization_id,guild_id,episode_id,day,kind,channel_key,definition_version,recipe_key) DO UPDATE SET observations=lifecycle_daily_rollups.observations+1,first_at=LEAST(lifecycle_daily_rollups.first_at,EXCLUDED.first_at),last_at=GREATEST(lifecycle_daily_rollups.last_at,EXCLUDED.last_at),first_id=CASE WHEN (EXCLUDED.first_at,EXCLUDED.first_id)<(lifecycle_daily_rollups.first_at,lifecycle_daily_rollups.first_id) THEN EXCLUDED.first_id ELSE lifecycle_daily_rollups.first_id END,last_id=CASE WHEN (EXCLUDED.last_at,EXCLUDED.last_id)>(lifecycle_daily_rollups.last_at,lifecycle_daily_rollups.last_id) THEN EXCLUDED.last_id ELSE lifecycle_daily_rollups.last_id END,first_data=CASE WHEN (EXCLUDED.first_at,EXCLUDED.first_id)<(lifecycle_daily_rollups.first_at,lifecycle_daily_rollups.first_id) THEN EXCLUDED.first_data ELSE lifecycle_daily_rollups.first_data END,last_data=CASE WHEN (EXCLUDED.last_at,EXCLUDED.last_id)>(lifecycle_daily_rollups.last_at,lifecycle_daily_rollups.last_id) THEN EXCLUDED.last_data ELSE lifecycle_daily_rollups.last_data END,epoch_ids=ARRAY(SELECT DISTINCT unnest(lifecycle_daily_rollups.epoch_ids||EXCLUDED.epoch_ids));
 INSERT INTO member_daily_activity VALUES(NEW.organization_id,NEW.guild_id,NEW.episode_id,(NEW.occurred_at AT TIME ZONE 'UTC')::date,NEW.occurred_at,NEW.occurred_at,nexus_activity_bits(NEW.kind),NEW.kind='reply.received',NEW.kind='thread.response_received',NEW.kind='voice.connected',NEW.kind='poll.participated',NEW.kind='reaction.received',NEW.kind='scheduled_event.attended')
 ON CONFLICT(organization_id,guild_id,episode_id,day) DO UPDATE SET first_activity_at=LEAST(member_daily_activity.first_activity_at,EXCLUDED.first_activity_at),last_activity_at=GREATEST(member_daily_activity.last_activity_at,EXCLUDED.last_activity_at),signal_bits=member_daily_activity.signal_bits|EXCLUDED.signal_bits,direct_reply_received=member_daily_activity.direct_reply_received OR EXCLUDED.direct_reply_received,thread_response_received=member_daily_activity.thread_response_received OR EXCLUDED.thread_response_received,qualified_voice_copresence=member_daily_activity.qualified_voice_copresence OR EXCLUDED.qualified_voice_copresence,poll_participated=member_daily_activity.poll_participated OR EXCLUDED.poll_participated,reaction_received=member_daily_activity.reaction_received OR EXCLUDED.reaction_received,event_attended=member_daily_activity.event_attended OR EXCLUDED.event_attended;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_daily_projection AFTER INSERT OR UPDATE OR DELETE ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION nexus_project_daily_rollup();
-- Existing explicit facts can be rolled up, but their definition and absent epoch/recipe attribution remain unchanged.
INSERT INTO lifecycle_daily_rollups SELECT organization_id,guild_id,episode_id,(occurred_at AT TIME ZONE 'UTC')::date,kind,COALESCE(data->>'channelId',''),definition_version,COALESCE(recipe_version_id::text,''),min(occurred_at),max(occurred_at),(array_agg(id ORDER BY occurred_at,id))[1],(array_agg(id ORDER BY occurred_at DESC,id DESC))[1],count(*),(array_agg(nexus_rollup_data(data) ORDER BY occurred_at,id))[1],(array_agg(nexus_rollup_data(data) ORDER BY occurred_at DESC,id DESC))[1],COALESCE(array_agg(DISTINCT collection_epoch_id) FILTER(WHERE collection_epoch_id IS NOT NULL),'{}'::uuid[]) FROM lifecycle_events WHERE context='PRODUCTION' GROUP BY organization_id,guild_id,episode_id,(occurred_at AT TIME ZONE 'UTC')::date,kind,COALESCE(data->>'channelId',''),definition_version,COALESCE(recipe_version_id::text,'');
INSERT INTO member_daily_activity SELECT organization_id,guild_id,episode_id,day,min(first_at),max(last_at),bit_or(nexus_activity_bits(kind)),bool_or(kind='reply.received'),bool_or(kind='thread.response_received'),bool_or(kind='voice.connected'),bool_or(kind='poll.participated'),bool_or(kind='reaction.received'),bool_or(kind='scheduled_event.attended') FROM lifecycle_daily_rollups GROUP BY organization_id,guild_id,episode_id,day;
CREATE VIEW surface_daily_rollups AS SELECT organization_id,guild_id,day,channel_key,kind,definition_version,recipe_key,sum(observations)::bigint AS observations,count(DISTINCT episode_id)::integer AS members,min(first_at) AS first_at,max(last_at) AS last_at FROM lifecycle_daily_rollups GROUP BY organization_id,guild_id,day,channel_key,kind,definition_version,recipe_key;
CREATE INDEX lifecycle_rollup_rebuild ON lifecycle_events(organization_id,guild_id,episode_id,kind,occurred_at) WHERE context='PRODUCTION';
ALTER TABLE member_interaction_pairs ADD COLUMN source text NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE voice_sessions ADD COLUMN source_session text, ADD COLUMN source_sequence bigint, ADD COLUMN source_ordinal integer;

CREATE FUNCTION nexus_rebuild_guild_rollups(org uuid,guild text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy:'||org||':'||guild,0));
 DELETE FROM lifecycle_daily_rollups WHERE organization_id=org AND guild_id=guild;
 DELETE FROM member_daily_activity WHERE organization_id=org AND guild_id=guild;
 INSERT INTO lifecycle_daily_rollups SELECT organization_id,guild_id,episode_id,(occurred_at AT TIME ZONE 'UTC')::date,kind,COALESCE(data->>'channelId',''),definition_version,COALESCE(recipe_version_id::text,''),min(occurred_at),max(occurred_at),(array_agg(id ORDER BY occurred_at,id))[1],(array_agg(id ORDER BY occurred_at DESC,id DESC))[1],count(*),(array_agg(nexus_rollup_data(data) ORDER BY occurred_at,id))[1],(array_agg(nexus_rollup_data(data) ORDER BY occurred_at DESC,id DESC))[1],COALESCE(array_agg(DISTINCT collection_epoch_id) FILTER(WHERE collection_epoch_id IS NOT NULL),'{}'::uuid[]) FROM lifecycle_events WHERE context='PRODUCTION' AND organization_id=org AND guild_id=guild GROUP BY organization_id,guild_id,episode_id,(occurred_at AT TIME ZONE 'UTC')::date,kind,COALESCE(data->>'channelId',''),definition_version,COALESCE(recipe_version_id::text,'');
INSERT INTO member_daily_activity SELECT organization_id,guild_id,episode_id,day,min(first_at),max(last_at),bit_or(nexus_activity_bits(kind)),bool_or(kind='reply.received'),bool_or(kind='thread.response_received'),bool_or(kind='voice.connected'),bool_or(kind='poll.participated'),bool_or(kind='reaction.received'),bool_or(kind='scheduled_event.attended') FROM lifecycle_daily_rollups WHERE organization_id=org AND guild_id=guild GROUP BY organization_id,guild_id,episode_id,day;

END $$;
