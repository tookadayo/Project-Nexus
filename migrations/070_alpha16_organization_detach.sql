-- Existing organization binding lifecycle only. No authorization grant, new
-- retention purpose, detach, reauthorization or data migration is performed.
ALTER TABLE operations_org_guilds DROP CONSTRAINT operations_org_guilds_state_check;
ALTER TABLE operations_org_guilds ADD CONSTRAINT operations_org_guilds_state_check
 CHECK(state IN ('ACTIVE','REQUIRES_REVIEW','PAUSED_PLAN_LIMIT','DETACHED'));
-- Legacy plan/review writers also invalidate the current binding revision.
CREATE FUNCTION nexus_org_guild_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state THEN
  NEW.revision:=GREATEST(NEW.revision,OLD.revision+1);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER operations_org_guild_revision BEFORE UPDATE ON operations_org_guilds
 FOR EACH ROW EXECUTE FUNCTION nexus_org_guild_revision();
