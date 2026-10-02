ALTER TABLE capability_refresh_jobs
 ADD COLUMN priority integer NOT NULL DEFAULT 10,
 ADD COLUMN revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN requested_at timestamptz,
 ADD COLUMN last_error_category text,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX capability_job_claim ON capability_refresh_jobs(priority DESC,due_at) WHERE lease_token IS NULL;
CREATE INDEX action_pending_claim ON action_outbox(organization_id,guild_id,available_at,created_at) WHERE state='PENDING';

ALTER TABLE action_outbox ADD COLUMN operation_phase text;
