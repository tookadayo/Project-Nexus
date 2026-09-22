-- Anonymous cohort counters survive detailed-event expiry and member deletion.
CREATE TABLE retention_tracking (
 organization_id uuid NOT NULL,guild_id text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE retention_cohorts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,cohort_day date NOT NULL,
 members integer NOT NULL DEFAULT 0,d30_active integer NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,guild_id,cohort_day),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE episode_retention (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,d30_active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,guild_id,episode_id),FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
INSERT INTO retention_tracking SELECT organization_id,guild_id,now() FROM guilds;
INSERT INTO episode_retention
 SELECT e.organization_id,e.guild_id,e.id,EXISTS(SELECT 1 FROM lifecycle_events f
 WHERE f.organization_id=e.organization_id AND f.guild_id=e.guild_id AND f.episode_id=e.id AND f.context='PRODUCTION'
 AND f.kind IN ('message.sent','reaction.added','voice.duration','scheduled_event.subscribed','fallback.answer','nexus_onboarding.answered','interaction.used')
 AND f.occurred_at>=e.joined_at+interval '30 days' AND f.occurred_at<e.joined_at+interval '31 days')
 FROM membership_episodes e WHERE e.context='PRODUCTION';
INSERT INTO retention_cohorts
 SELECT e.organization_id,e.guild_id,(e.joined_at AT TIME ZONE 'UTC')::date,count(*)::integer,count(*) FILTER(WHERE r.d30_active)::integer
 FROM membership_episodes e JOIN episode_retention r ON r.organization_id=e.organization_id AND r.guild_id=e.guild_id AND r.episode_id=e.id
 GROUP BY e.organization_id,e.guild_id,(e.joined_at AT TIME ZONE 'UTC')::date;
CREATE FUNCTION nexus_retention_join() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.context<>'PRODUCTION' THEN RETURN NEW; END IF;
 INSERT INTO retention_tracking(organization_id,guild_id) VALUES(NEW.organization_id,NEW.guild_id) ON CONFLICT DO NOTHING;
 INSERT INTO episode_retention(organization_id,guild_id,episode_id) VALUES(NEW.organization_id,NEW.guild_id,NEW.id);
 INSERT INTO retention_cohorts VALUES(NEW.organization_id,NEW.guild_id,(NEW.joined_at AT TIME ZONE 'UTC')::date,1,0)
 ON CONFLICT(organization_id,guild_id,cohort_day) DO UPDATE SET members=retention_cohorts.members+1;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_join AFTER INSERT ON membership_episodes FOR EACH ROW EXECUTE FUNCTION nexus_retention_join();
-- Active signals match signalRegistry v2; changing eligibility requires a new metric version.
CREATE FUNCTION nexus_retention_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE joined timestamptz; changed integer;
BEGIN
 IF NEW.context<>'PRODUCTION' OR NEW.kind NOT IN ('message.sent','reaction.added','voice.duration','scheduled_event.subscribed','fallback.answer','nexus_onboarding.answered','interaction.used') THEN RETURN NEW; END IF;
 SELECT joined_at INTO joined FROM membership_episodes WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND id=NEW.episode_id;
 IF NEW.occurred_at>=joined+interval '30 days' AND NEW.occurred_at<joined+interval '31 days' THEN
  UPDATE episode_retention SET d30_active=true WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND episode_id=NEW.episode_id AND NOT d30_active;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed>0 THEN UPDATE retention_cohorts SET d30_active=d30_active+1 WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND cohort_day=(joined AT TIME ZONE 'UTC')::date; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retention_activity AFTER INSERT ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION nexus_retention_activity();
