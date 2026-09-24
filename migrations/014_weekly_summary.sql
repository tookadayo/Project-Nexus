CREATE TABLE weekly_summary_deliveries (
 organization_id uuid NOT NULL,
 guild_id text NOT NULL,
 week_start date NOT NULL,
 channel_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('sending','sent','unknown')),
 message_id text,
 attempted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,week_start),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
