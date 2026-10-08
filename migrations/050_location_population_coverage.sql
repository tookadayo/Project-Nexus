-- Existing participant projections do not prove staff/Bot/Webhook coverage.
-- Keep 047-049 and immutable analysis results unchanged.
ALTER TABLE location_post_observations ADD COLUMN population_source text NOT NULL DEFAULT 'LEGACY_PARTICIPANT_ONLY'
 CHECK(population_source IN ('LEGACY_PARTICIPANT_ONLY','LOCATION_STREAM_V1'));
ALTER TABLE location_post_observations ALTER COLUMN population_source SET DEFAULT 'LOCATION_STREAM_V1';

-- A row-free guild still needs durable proof of when the collector existed.
-- Bootstrap only inserts; reconnects/late packets never move this boundary.
CREATE TABLE location_population_collection (
 organization_id uuid NOT NULL,guild_id text NOT NULL,
 collector_version text NOT NULL DEFAULT 'LOCATION_STREAM_V1' CHECK(collector_version='LOCATION_STREAM_V1'),
 introduced_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 PRIMARY KEY(organization_id,guild_id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
INSERT INTO location_population_collection(organization_id,guild_id)
 SELECT organization_id,guild_id FROM guilds;
-- Stop old Gateway producers and workers before migration; start the new
-- runtime afterward. An old epoch cannot certify collection across activation.
UPDATE collection_epochs SET ended_at=GREATEST(started_at,transaction_timestamp()),
 end_reason='LOCATION_POPULATION_COLLECTOR_UPGRADE'
 WHERE source='GATEWAY' AND ended_at IS NULL;
CREATE FUNCTION nexus_bootstrap_location_population() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO location_population_collection(organization_id,guild_id)
 VALUES(NEW.organization_id,NEW.guild_id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER nexus_location_population_bootstrap AFTER INSERT ON guilds
 FOR EACH ROW EXECUTE FUNCTION nexus_bootstrap_location_population();
