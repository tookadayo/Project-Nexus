DROP INDEX sessions_episode;
DROP INDEX outbox_pending;
ALTER TABLE interaction_jobs DROP COLUMN attempts, DROP COLUMN lease_until;
ALTER TABLE flow_sessions DROP COLUMN created_at;
