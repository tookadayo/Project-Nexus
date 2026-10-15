-- Normalized calendar meaning belongs to the immutable revision, not a new
-- history purpose. Cascade and existing definition retention apply unchanged.
CREATE TABLE automation_schedule_reviews (
 organization_id uuid NOT NULL,guild_id text NOT NULL,flow_id text NOT NULL,revision integer NOT NULL,
 snapshot jsonb NOT NULL,checked_at timestamptz NOT NULL,invalidated_at timestamptz,reason text,
 PRIMARY KEY(organization_id,guild_id,flow_id,revision),
 FOREIGN KEY(organization_id,guild_id,flow_id,revision) REFERENCES automation_revisions ON DELETE CASCADE,
 CHECK(pg_column_size(snapshot)<=1048576),
 CHECK((invalidated_at IS NULL)=(reason IS NULL))
);
ALTER TABLE automation_schedules ADD COLUMN review_required boolean NOT NULL DEFAULT false;
ALTER TABLE automation_schedules ADD COLUMN review_reason text;
ALTER TABLE automation_schedules ADD COLUMN rules_checked_at timestamptz;
ALTER TABLE automation_schedules ADD COLUMN planned_local jsonb;
ALTER TABLE automation_schedules ADD COLUMN planned_offset text;
