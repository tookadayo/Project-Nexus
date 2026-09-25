CREATE TABLE helper_alerts (
 organization_id uuid NOT NULL,
 guild_id text NOT NULL,
 message_id text NOT NULL,
 channel_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('sending','sent','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 discord_message_id text,
 PRIMARY KEY(organization_id,guild_id,message_id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX helper_alerts_recent ON helper_alerts(organization_id,guild_id,created_at);
