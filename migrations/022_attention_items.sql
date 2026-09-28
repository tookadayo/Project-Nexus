CREATE TABLE attention_items (
 organization_id uuid NOT NULL,
 guild_id text NOT NULL,
 channel_id text NOT NULL,
 message_id text NOT NULL,
 detected_at timestamptz NOT NULL,
 status text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED')),
 snooze_until timestamptz,
 resolved_at timestamptz,
 PRIMARY KEY (organization_id,guild_id,message_id),
 FOREIGN KEY (organization_id,guild_id) REFERENCES guilds(organization_id,guild_id) ON DELETE CASCADE
);
CREATE INDEX attention_items_due ON attention_items(organization_id,guild_id,status,snooze_until);
