CREATE TABLE optimization_checks (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,checked_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,episode_id),FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
