-- Minimal introduction delivery evidence. No message body, user identity or token.
-- Expiry is independent of plan and of existing audit/analysis retention.
CREATE TABLE install_notices (
 organization_id uuid NOT NULL,guild_id text NOT NULL,
 generation text NOT NULL CHECK(generation~'^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('SETUP','DASHBOARD')),
 state text NOT NULL CHECK(state IN ('UNSENT','SENDING','SUCCEEDED','FAILED','UNKNOWN','WEB_ONLY')),
 channel_id text,message_id text,action_id uuid,
 destination_kind text CHECK(destination_kind IN ('ADMIN','SYSTEM')),
 observed_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 PRIMARY KEY(organization_id,guild_id,generation,kind),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(expires_at<=observed_at+interval '7 days')
);
CREATE INDEX install_notices_expiry ON install_notices(expires_at);
