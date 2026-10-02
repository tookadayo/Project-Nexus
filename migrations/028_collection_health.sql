-- All durable domains use the composite tenant key. Discord guild IDs are not an organization boundary.
ALTER TABLE guilds DROP CONSTRAINT guilds_guild_id_key;
CREATE TABLE collection_epochs (
 organization_id uuid NOT NULL, guild_id text NOT NULL, id uuid NOT NULL,
 source text NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz,
 start_reason text NOT NULL, end_reason text, capability_snapshot_id uuid,
 metadata jsonb NOT NULL DEFAULT '{"version":1}',
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,capability_snapshot_id) REFERENCES guild_capability_snapshots ON DELETE SET NULL (capability_snapshot_id),
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX collection_epoch_open ON collection_epochs(organization_id,guild_id,source) WHERE ended_at IS NULL;
CREATE INDEX collection_epoch_window ON collection_epochs(organization_id,guild_id,started_at,ended_at);
CREATE TABLE discord_integration_health (
 organization_id uuid NOT NULL,guild_id text NOT NULL,
 gateway_state text NOT NULL DEFAULT 'UNKNOWN',last_gateway_at timestamptz,
 intents jsonb NOT NULL DEFAULT '{}',rest_state text NOT NULL DEFAULT 'UNKNOWN',
 last_refresh_at timestamptz,last_refresh_failure_at timestamptz,
 last_error_category text,updated_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
ALTER TABLE discord_surface_state ADD COLUMN visibility_state text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE discord_surface_state ADD COLUMN visibility_observed_at timestamptz;
ALTER TABLE lifecycle_events ADD COLUMN collection_epoch_id uuid;
ALTER TABLE adaptive_facts ADD COLUMN collection_epoch_id uuid;
ALTER TABLE lifecycle_events ADD COLUMN definition_version text NOT NULL DEFAULT 'alpha4-v1';
ALTER TABLE adaptive_facts ADD COLUMN definition_version text NOT NULL DEFAULT 'alpha4-v1';
ALTER TABLE lifecycle_events ADD FOREIGN KEY(organization_id,guild_id,collection_epoch_id) REFERENCES collection_epochs ON DELETE SET NULL (collection_epoch_id);
ALTER TABLE adaptive_facts ADD FOREIGN KEY(organization_id,guild_id,collection_epoch_id) REFERENCES collection_epochs ON DELETE SET NULL (collection_epoch_id);
-- Existing rows stay unattributed. A timestamp alone cannot prove historical collection.
CREATE FUNCTION nexus_stamp_collection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.collection_epoch_id IS NULL THEN
  SELECT id INTO NEW.collection_epoch_id FROM collection_epochs
   WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND source='GATEWAY'
   AND started_at<=NEW.occurred_at AND (ended_at IS NULL OR ended_at>NEW.occurred_at)
   ORDER BY started_at DESC LIMIT 1;
 END IF;
 IF NEW.definition_version='alpha4-v1' THEN NEW.definition_version='observation-v3'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_collection BEFORE INSERT ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION nexus_stamp_collection();
CREATE TRIGGER adaptive_collection BEFORE INSERT ON adaptive_facts FOR EACH ROW EXECUTE FUNCTION nexus_stamp_collection();
