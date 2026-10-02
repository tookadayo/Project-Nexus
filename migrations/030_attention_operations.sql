ALTER TABLE attention_items ADD COLUMN item_type text NOT NULL DEFAULT 'TEXT_NEWCOMER';
ALTER TABLE attention_items ADD COLUMN target_surface text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE attention_items ADD COLUMN reason text NOT NULL DEFAULT 'LEGACY_UNSPECIFIED';
ALTER TABLE attention_items ADD COLUMN opened_at timestamptz;
ALTER TABLE attention_items ADD COLUMN acknowledged_at timestamptz;
ALTER TABLE attention_items ADD COLUMN threshold_seconds integer;
ALTER TABLE attention_items ADD COLUMN evidence jsonb;
ALTER TABLE attention_items ADD COLUMN resolution_reason text;
ALTER TABLE attention_items ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE attention_items ADD COLUMN updated_at timestamptz;
CREATE INDEX attention_operations_window ON attention_items(organization_id,guild_id,opened_at,item_type,status);
ALTER TABLE action_outbox ADD COLUMN lease_token uuid;
ALTER TABLE action_outbox ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE action_outbox ADD COLUMN completed_at timestamptz;
ALTER TABLE action_outbox ADD COLUMN error_category text;
CREATE FUNCTION nexus_touch_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.updated_at=now();
 IF NEW.state IN ('SUCCEEDED','FAILED','UNKNOWN') AND OLD.state IS DISTINCT FROM NEW.state THEN NEW.completed_at=now(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER action_outbox_timestamps BEFORE UPDATE ON action_outbox FOR EACH ROW EXECUTE FUNCTION nexus_touch_outbox();
