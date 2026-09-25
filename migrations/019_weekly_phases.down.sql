UPDATE weekly_summary_deliveries SET state='unknown' WHERE state IN ('preparing','ready');
ALTER TABLE weekly_summary_deliveries DROP CONSTRAINT weekly_summary_deliveries_state_check;
ALTER TABLE weekly_summary_deliveries ADD CONSTRAINT weekly_summary_deliveries_state_check CHECK(state IN ('sending','sent','unknown'));
UPDATE weekly_summary_deliveries SET attempted_at=now() WHERE attempted_at IS NULL;
ALTER TABLE weekly_summary_deliveries ALTER COLUMN attempted_at SET NOT NULL;
