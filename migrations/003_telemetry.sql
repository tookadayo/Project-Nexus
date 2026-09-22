CREATE TABLE telemetry_cursor (organization_id uuid NOT NULL, guild_id text NOT NULL, first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE);
CREATE TABLE membership_departures (organization_id uuid NOT NULL, guild_id text NOT NULL, identity_id uuid NOT NULL, departed_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,identity_id,departed_at), FOREIGN KEY(organization_id,guild_id,identity_id) REFERENCES member_identity_map ON DELETE CASCADE);
ALTER TABLE deletion_requests ADD COLUMN lookup_hash text;
