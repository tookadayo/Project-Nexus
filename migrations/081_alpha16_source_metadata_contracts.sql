-- Existing metadata purpose only: no body, Bot identity or new personal data.
-- NULL deliberately distinguishes legacy producers, queues and projected rows.
ALTER TABLE location_post_observations ADD COLUMN reference_contract_version text
 CHECK(reference_contract_version IS NULL OR reference_contract_version='DIRECT_REPLY_V1');
ALTER TABLE location_post_observations ADD CONSTRAINT location_reference_contract_author
 CHECK(reference_contract_version IS NULL OR author_kind IN ('BOT','WEBHOOK'));

-- These are actual protocol observations, never migration/installation clocks.
-- New guild bootstrap inserts inherit NULL; existing guilds are not backfilled.
ALTER TABLE location_population_collection
 ADD COLUMN bot_reference_started_at timestamptz,
 ADD COLUMN bot_reference_observed_at timestamptz,
 ADD CONSTRAINT bot_reference_collection_clock CHECK(bot_reference_started_at IS NULL OR
  (bot_reference_observed_at IS NOT NULL AND bot_reference_started_at<=bot_reference_observed_at));

-- Confirmed mass-mention target metadata only; this is not a count of all
-- individual/text mentions. An absent native field stays NULL, never zero.
ALTER TABLE location_post_observations
 ADD COLUMN mention_everyone boolean,
 ADD COLUMN role_mention_count integer CHECK(role_mention_count BETWEEN 0 AND 1000),
 ADD COLUMN mention_contract_version text CHECK(mention_contract_version IS NULL OR mention_contract_version='ROLE_EVERYONE_V1'),
 ADD CONSTRAINT location_mention_contract_values CHECK(mention_contract_version IS NULL OR
  (mention_everyone IS NOT NULL AND role_mention_count IS NOT NULL));

-- Erasure can invalidate a surviving question's derived first-reply clock.
-- This quality bit is not an answered/unanswered status and never means zero.
ALTER TABLE location_post_observations ADD COLUMN reply_provenance_erased boolean NOT NULL DEFAULT false;
