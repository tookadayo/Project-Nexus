-- Legacy anonymous counters cannot prove member eligibility. Preserve them as
-- historical compatibility data, and build v3 counters only from observed proof.
CREATE TABLE eligible_retention_cohorts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,cohort_day date NOT NULL,
 members integer NOT NULL DEFAULT 0,d30_active integer NOT NULL DEFAULT 0,
 definition_version text NOT NULL DEFAULT 'eligible-retention-v3',
 PRIMARY KEY(organization_id,guild_id,cohort_day),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE,
 CHECK(members>=0 AND d30_active>=0 AND d30_active<=members)
);
CREATE TABLE episode_eligible_retention (
 organization_id uuid NOT NULL,guild_id text NOT NULL,episode_id uuid NOT NULL,
 started_at timestamptz NOT NULL,d30_active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,guild_id,episode_id),
 FOREIGN KEY(organization_id,guild_id,episode_id) REFERENCES membership_episodes ON DELETE CASCADE
);
CREATE FUNCTION nexus_observed_retention_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior episode_eligible_retention%ROWTYPE; started timestamptz; eligible boolean;
BEGIN
 eligible:=NEW.context='PRODUCTION' AND NEW.screening_observed_at IS NOT NULL AND NEW.guest_observed_at IS NOT NULL AND NOT NEW.screening_pending AND NOT NEW.is_guest;
 started:=GREATEST(NEW.joined_at,COALESCE(NEW.engagement_started_at,NEW.screening_observed_at,NEW.joined_at),COALESCE(NEW.engagement_started_at,NEW.guest_observed_at,NEW.joined_at));
 SELECT * INTO prior FROM episode_eligible_retention WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND episode_id=NEW.id FOR UPDATE;
 IF FOUND AND (NOT eligible OR prior.started_at<>started) THEN
  UPDATE eligible_retention_cohorts SET members=members-1,d30_active=d30_active-prior.d30_active::integer WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND cohort_day=(prior.started_at AT TIME ZONE 'UTC')::date;
  DELETE FROM episode_eligible_retention WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND episode_id=NEW.id;
 ELSIF FOUND THEN RETURN NEW;
 END IF;
 IF eligible THEN
  INSERT INTO episode_eligible_retention VALUES(NEW.organization_id,NEW.guild_id,NEW.id,started,false);
  INSERT INTO eligible_retention_cohorts(organization_id,guild_id,cohort_day,members) VALUES(NEW.organization_id,NEW.guild_id,(started AT TIME ZONE 'UTC')::date,1)
  ON CONFLICT(organization_id,guild_id,cohort_day) DO UPDATE SET members=eligible_retention_cohorts.members+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER observed_retention_member AFTER INSERT OR UPDATE OF screening_observed_at,guest_observed_at,screening_pending,is_guest,engagement_started_at ON membership_episodes FOR EACH ROW EXECUTE FUNCTION nexus_observed_retention_member();
CREATE FUNCTION nexus_observed_retention_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE started timestamptz; changed integer;
BEGIN
 IF NEW.context<>'PRODUCTION' OR NEW.definition_version<>'observation-v3' OR NEW.kind NOT IN ('message.sent','reaction.added','voice.duration','scheduled_event.subscribed','fallback.answer','nexus_onboarding.answered','interaction.used','thread.response_received','poll.participated','voice.connected','scheduled_event.attended') THEN RETURN NEW; END IF;
 SELECT started_at INTO started FROM episode_eligible_retention WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND episode_id=NEW.episode_id;
 IF started IS NOT NULL AND NEW.occurred_at>=started+interval '30 days' AND NEW.occurred_at<started+interval '31 days' THEN
  UPDATE episode_eligible_retention SET d30_active=true WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND episode_id=NEW.episode_id AND NOT d30_active;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed>0 THEN UPDATE eligible_retention_cohorts SET d30_active=d30_active+1 WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND cohort_day=(started AT TIME ZONE 'UTC')::date; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER observed_retention_activity AFTER INSERT ON lifecycle_events FOR EACH ROW EXECUTE FUNCTION nexus_observed_retention_activity();
INSERT INTO episode_eligible_retention
 SELECT organization_id,guild_id,id,GREATEST(joined_at,COALESCE(engagement_started_at,screening_observed_at),COALESCE(engagement_started_at,guest_observed_at)),false FROM membership_episodes
 WHERE context='PRODUCTION' AND screening_observed_at IS NOT NULL AND guest_observed_at IS NOT NULL AND NOT screening_pending AND NOT is_guest;
UPDATE episode_eligible_retention r SET d30_active=EXISTS(SELECT 1 FROM lifecycle_events f WHERE f.organization_id=r.organization_id AND f.guild_id=r.guild_id AND f.episode_id=r.episode_id AND f.context='PRODUCTION' AND f.definition_version='observation-v3' AND f.kind IN ('message.sent','reaction.added','voice.duration','scheduled_event.subscribed','fallback.answer','nexus_onboarding.answered','interaction.used','thread.response_received','poll.participated','voice.connected','scheduled_event.attended') AND f.occurred_at>=r.started_at+interval '30 days' AND f.occurred_at<r.started_at+interval '31 days');
INSERT INTO eligible_retention_cohorts(organization_id,guild_id,cohort_day,members,d30_active) SELECT organization_id,guild_id,(started_at AT TIME ZONE 'UTC')::date,count(*)::integer,count(*) FILTER(WHERE d30_active)::integer FROM episode_eligible_retention GROUP BY organization_id,guild_id,(started_at AT TIME ZONE 'UTC')::date;
