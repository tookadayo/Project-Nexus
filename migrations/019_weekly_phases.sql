ALTER TABLE weekly_summary_deliveries DROP CONSTRAINT weekly_summary_deliveries_state_check;
ALTER TABLE weekly_summary_deliveries ADD CONSTRAINT weekly_summary_deliveries_state_check CHECK(state IN ('preparing','ready','sending','sent','unknown'));
ALTER TABLE weekly_summary_deliveries ALTER COLUMN attempted_at DROP NOT NULL;
