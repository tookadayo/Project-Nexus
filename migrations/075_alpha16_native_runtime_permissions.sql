-- Run-owned operational observations, not an audit/safety history. No backfill:
-- absence for a legacy Run is an explicit coverage gap until actually observed.
-- This source-only deadline remains on the parent Run after an observation
-- expires. A later metadata/status write cannot resurrect its retention clock.
ALTER TABLE automation_runs ADD COLUMN execution_observation_expires_at timestamptz;
CREATE FUNCTION bound_automation_execution_observation_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ceiling timestamptz;
BEGIN
 ceiling:=LEAST(NEW.deadline_at+interval '7 days',NEW.ended_at+interval '7 days');
 IF TG_OP='UPDATE' THEN ceiling:=LEAST(ceiling,OLD.execution_observation_expires_at,OLD.deadline_at+interval '7 days',OLD.ended_at+interval '7 days'); END IF;
 NEW.execution_observation_expires_at:=ceiling;RETURN NEW;
END $$;
CREATE TRIGGER automation_execution_observation_expiry BEFORE INSERT OR UPDATE ON automation_runs FOR EACH ROW EXECUTE FUNCTION bound_automation_execution_observation_expiry();
CREATE TABLE automation_execution_observations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,run_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),status text NOT NULL,
 due_at timestamptz,deadline_at timestamptz NOT NULL,terminal_at timestamptz,
 heartbeat_at timestamptz,observed_at timestamptz NOT NULL,
 checkpoint_revision bigint NOT NULL CHECK(checkpoint_revision>0),
 retention_expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,run_id),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE CASCADE,
 CHECK(status IN ('QUEUED','RUNNING','WAITING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELLED','EXPIRED','UNKNOWN')),
 CHECK((status IN ('COMPLETED','FAILED','CANCELLED','EXPIRED','UNKNOWN'))=(terminal_at IS NOT NULL)),
 CHECK(due_at IS NULL OR due_at<=deadline_at),
 CHECK(retention_expires_at<=COALESCE(terminal_at,deadline_at)+interval '7 days')
);
CREATE FUNCTION sync_automation_execution_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior automation_execution_observations%ROWTYPE; due timestamptz; first_terminal timestamptz; at_time timestamptz:=clock_timestamp();
BEGIN
 IF NEW.execution_observation_expires_at<=at_time THEN
  UPDATE automation_execution_observations SET retention_expires_at=LEAST(retention_expires_at,NEW.execution_observation_expires_at)
  WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND run_id=NEW.id;
  RETURN NEW;
 END IF;
 SELECT * INTO prior FROM automation_execution_observations WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND run_id=NEW.id;
 first_terminal:=COALESCE(prior.terminal_at,NEW.ended_at);
 IF NEW.status='QUEUED' THEN
  IF TG_OP='INSERT' THEN due:=NEW.started_at;
  ELSIF OLD.status<>'QUEUED' THEN due:=at_time;
  ELSE due:=prior.due_at; END IF;
 ELSIF NEW.status IN ('WAITING','WAITING_APPROVAL') THEN due:=NEW.wake_at;
 ELSE due:=NULL; END IF;
 INSERT INTO automation_execution_observations(organization_id,guild_id,run_id,revision,status,due_at,deadline_at,terminal_at,heartbeat_at,observed_at,checkpoint_revision,retention_expires_at)
 VALUES(NEW.organization_id,NEW.guild_id,NEW.id,NEW.revision,NEW.status,due,NEW.deadline_at,first_terminal,prior.heartbeat_at,at_time,COALESCE(prior.checkpoint_revision,0)+1,LEAST(NEW.execution_observation_expires_at,COALESCE(first_terminal,NEW.deadline_at)+interval '7 days'))
 ON CONFLICT(organization_id,guild_id,run_id) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,due_at=EXCLUDED.due_at,deadline_at=EXCLUDED.deadline_at,terminal_at=EXCLUDED.terminal_at,observed_at=EXCLUDED.observed_at,checkpoint_revision=EXCLUDED.checkpoint_revision,retention_expires_at=LEAST(automation_execution_observations.retention_expires_at,EXCLUDED.retention_expires_at);
 RETURN NEW;
END $$;
CREATE TRIGGER automation_execution_observation AFTER INSERT OR UPDATE ON automation_runs FOR EACH ROW EXECUTE FUNCTION sync_automation_execution_observation();

-- One current configuration epoch, with no historical definitions, members,
-- grants, Runs or payloads. It invalidates an older capability snapshot rather
-- than blessing old observations as a new current permission assessment.
CREATE TABLE native_permission_requirement_epochs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
INSERT INTO native_permission_requirement_epochs(organization_id,guild_id) SELECT organization_id,guild_id FROM guilds;
CREATE FUNCTION bump_native_permission_requirement_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid; guild text;
BEGIN
 IF TG_OP='DELETE' THEN org:=OLD.organization_id;guild:=OLD.guild_id; ELSE org:=NEW.organization_id;guild:=NEW.guild_id; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-COALESCE(TG_ARGV,ARRAY[]::text[])) IS NOT DISTINCT FROM (to_jsonb(OLD)-COALESCE(TG_ARGV,ARRAY[]::text[])) THEN RETURN NEW; END IF;
 INSERT INTO native_permission_requirement_epochs(organization_id,guild_id,revision,changed_at)
 SELECT org,guild,1,clock_timestamp() WHERE EXISTS(SELECT 1 FROM guilds g WHERE g.organization_id=org AND g.guild_id=guild)
 ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=native_permission_requirement_epochs.revision+1,changed_at=clock_timestamp();
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER permission_epoch_guild AFTER INSERT ON guilds FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch();
CREATE TRIGGER permission_epoch_settings AFTER INSERT OR UPDATE OR DELETE ON guild_settings FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch();
CREATE TRIGGER permission_epoch_onboarding_versions AFTER INSERT OR DELETE ON flow_versions FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch();
CREATE TRIGGER permission_epoch_flows AFTER INSERT OR DELETE OR UPDATE OF active_revision,state,generation ON automation_flows FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch('updated_at','name','draft_revision','activator_hash','activator_ciphertext','beta_generation');
CREATE TRIGGER permission_epoch_destinations AFTER INSERT OR UPDATE OR DELETE ON integration_destinations FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch('updated_at');
CREATE TRIGGER permission_epoch_reports AFTER INSERT OR DELETE OR UPDATE OF destination_id,state,format,revision ON report_schedules FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch('next_at');
CREATE TRIGGER permission_epoch_playbooks AFTER INSERT OR DELETE OR UPDATE OF state,head_id,version ON playbooks FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch('last_evaluated_at');
CREATE TRIGGER permission_epoch_intake AFTER INSERT OR DELETE OR UPDATE OF state,destination_id,channel_id,version ON operations_intake_panels FOR EACH ROW EXECUTE FUNCTION bump_native_permission_requirement_epoch();
