CREATE TABLE suggestion_feedback (
 organization_id uuid NOT NULL,
 guild_id text NOT NULL,
 suggestion_type text NOT NULL,
 week_start date NOT NULL,
 reason text CHECK(reason IN ('not_relevant','already_handled','later')),
 dismissed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,suggestion_type,week_start),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
