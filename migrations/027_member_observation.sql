-- Independent proof clocks: alpha.4 defaults and mixed flags_observed_at cannot
-- prove that pending or guest=false was actually delivered. No legacy backfill.
ALTER TABLE membership_episodes ADD COLUMN screening_observed_at timestamptz;
ALTER TABLE membership_episodes ADD COLUMN guest_observed_at timestamptz;
ALTER TABLE membership_episodes ADD COLUMN observation_source text;
CREATE INDEX member_observation_eligible ON membership_episodes(organization_id,guild_id,joined_at)
 WHERE screening_observed_at IS NOT NULL AND guest_observed_at IS NOT NULL AND NOT screening_pending AND NOT is_guest AND context='PRODUCTION';
