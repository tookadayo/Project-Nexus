CREATE TABLE member_interaction_pairs (
 organization_id uuid NOT NULL,
 guild_id text NOT NULL,
 episode_id uuid NOT NULL,
 peer_identity_id uuid NOT NULL,
 first_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,episode_id,peer_identity_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,peer_identity_id) REFERENCES member_identity_map ON DELETE CASCADE
);
CREATE INDEX member_interaction_pairs_time ON member_interaction_pairs(organization_id,guild_id,first_at);
