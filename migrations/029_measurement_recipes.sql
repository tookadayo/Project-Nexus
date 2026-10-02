CREATE TABLE measurement_recipe_versions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 revision integer NOT NULL,definition_version text NOT NULL,preset text NOT NULL,
 definition jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,revision),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TRIGGER immutable_recipe BEFORE UPDATE ON measurement_recipe_versions FOR EACH ROW EXECUTE FUNCTION reject_flow_update();
CREATE TABLE measurement_recipe_heads (
 organization_id uuid NOT NULL,guild_id text NOT NULL,recipe_version_id uuid NOT NULL,
 PRIMARY KEY(organization_id,guild_id),
 FOREIGN KEY(organization_id,guild_id,recipe_version_id) REFERENCES measurement_recipe_versions ON DELETE CASCADE
);
-- Preserve the old confirmed profile as its own definition, rather than applying alpha.5 defaults retroactively.
INSERT INTO measurement_recipe_versions(organization_id,guild_id,id,revision,definition_version,preset,definition)
 SELECT organization_id,guild_id,gen_random_uuid(),1,'alpha4-profile-v1','LEGACY_PROFILE',
 jsonb_build_object('schemaVersion',0,'profile',settings->'communityModel','scope',settings->'analysisScope','stages',settings->'memberStages')
 FROM guild_settings WHERE settings->'communityModel'->>'confirmed'='true';
INSERT INTO measurement_recipe_heads SELECT organization_id,guild_id,id FROM measurement_recipe_versions;
ALTER TABLE membership_episodes ADD COLUMN recipe_version_id uuid;
ALTER TABLE lifecycle_events ADD COLUMN recipe_version_id uuid;
ALTER TABLE adaptive_facts ADD COLUMN recipe_version_id uuid;
ALTER TABLE membership_episodes ADD FOREIGN KEY(organization_id,guild_id,recipe_version_id) REFERENCES measurement_recipe_versions ON DELETE SET NULL(recipe_version_id);
ALTER TABLE lifecycle_events ADD FOREIGN KEY(organization_id,guild_id,recipe_version_id) REFERENCES measurement_recipe_versions ON DELETE SET NULL(recipe_version_id);
ALTER TABLE adaptive_facts ADD FOREIGN KEY(organization_id,guild_id,recipe_version_id) REFERENCES measurement_recipe_versions ON DELETE SET NULL(recipe_version_id);
CREATE FUNCTION nexus_stamp_recipe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.recipe_version_id IS NULL THEN
  SELECT recipe_version_id INTO NEW.recipe_version_id FROM measurement_recipe_heads WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER member_recipe BEFORE INSERT ON membership_episodes FOR EACH ROW EXECUTE FUNCTION nexus_stamp_recipe();
CREATE TRIGGER lifecycle_recipe BEFORE INSERT ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION nexus_stamp_recipe();
CREATE TRIGGER adaptive_recipe BEFORE INSERT ON adaptive_facts FOR EACH ROW EXECUTE FUNCTION nexus_stamp_recipe();
