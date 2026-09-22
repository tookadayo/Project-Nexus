CREATE TABLE experiment_outcomes (
 organization_id uuid NOT NULL,guild_id text NOT NULL,assignment_id uuid NOT NULL,
 success boolean NOT NULL,left_during_window boolean NOT NULL,coverage_ratio double precision NOT NULL CHECK(coverage_ratio BETWEEN 0 AND 1),
 metric_version integer NOT NULL,evaluated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,assignment_id),
 FOREIGN KEY(organization_id,guild_id,assignment_id) REFERENCES experiment_assignments ON DELETE CASCADE
);
