-- Scoped operational cohorts, never a cross-guild person segment.
CREATE TABLE operational_segments (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 filters jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,actor_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,name),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE saved_metric_views (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 metric_key text NOT NULL CHECK(metric_key IN ('reply','forum','voice','event','reaction','poll')),
 range_days integer NOT NULL CHECK(range_days IN (7,30,90)),timezone text NOT NULL,comparison boolean NOT NULL DEFAULT false,
 segment_id uuid NOT NULL,revision integer NOT NULL DEFAULT 1,shortcut text CHECK(shortcut IN ('support-health','newcomer-flow')),
 actor_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,name),UNIQUE(organization_id,guild_id,shortcut),
 FOREIGN KEY(organization_id,guild_id,segment_id) REFERENCES operational_segments ON DELETE CASCADE
);
CREATE INDEX saved_metric_views_scope ON saved_metric_views(organization_id,guild_id,updated_at);
