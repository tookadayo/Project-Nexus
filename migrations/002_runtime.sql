ALTER TABLE flow_sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE interaction_jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE interaction_jobs ADD COLUMN attempts integer NOT NULL DEFAULT 0;
CREATE INDEX outbox_pending ON action_outbox(state,available_at);
CREATE INDEX sessions_episode ON flow_sessions(organization_id,guild_id,episode_id,created_at DESC);
