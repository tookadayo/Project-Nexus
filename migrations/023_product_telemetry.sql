CREATE TABLE product_telemetry (
 id uuid PRIMARY KEY,
 guild_hash text NOT NULL,
 event text NOT NULL,
 duration_ms integer,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK (event IN ('guild_installed','setup_started','setup_scope_completed','setup_team_completed','setup_notification_completed','setup_goal_completed','setup_completed','panel_opened','attention_opened','analysis_opened','settings_opened','setting_saved','test_notification_sent','interaction_failed','interaction_latency','page_render_latency'))
);
CREATE INDEX product_telemetry_recent ON product_telemetry(occurred_at,event);
