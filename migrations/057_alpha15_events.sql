-- Minimal trusted ingress. No message text, profiles, evidence, interaction
-- tokens, submitted fields, or variable values are copied into these tables.
CREATE TABLE automation_event_inbox (
 organization_id uuid NOT NULL,guild_id text NOT NULL,source text NOT NULL CHECK(source IN ('INTERNAL','INTERACTION')),
 event_id text NOT NULL CHECK(length(event_id) BETWEEN 1 AND 100),flow_id text NOT NULL,revision integer NOT NULL,generation integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ticketCreated','ticketUpdated','interaction')),
 ticket_id text,ticket_state text,ticket_version integer,channel_id text,
 actor_hash text,actor_ciphertext text,beta_generation integer,
 occurred_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),deadline_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','STARTED','SKIPPED')),run_id uuid,reason text,finished_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,source,event_id,flow_id,revision),
 FOREIGN KEY(organization_id,guild_id,flow_id) REFERENCES automation_flows ON DELETE CASCADE,
 CHECK(deadline_at<=created_at+interval '7 days'),
 CHECK((source='INTERNAL' AND kind<>'interaction' AND actor_hash IS NULL AND actor_ciphertext IS NULL) OR (source='INTERACTION' AND kind='interaction' AND actor_hash IS NOT NULL AND ((state='PENDING' AND actor_ciphertext IS NOT NULL) OR (state<>'PENDING' AND actor_ciphertext IS NULL)))),
 CHECK((state='PENDING')=(finished_at IS NULL))
);
CREATE INDEX automation_event_pending ON automation_event_inbox(created_at) WHERE state='PENDING';
-- Per-definition scheduling fence; this is stop metadata, not a new host setting.
ALTER TABLE automation_schedules ADD COLUMN admission_after timestamptz;
CREATE TABLE automation_interaction_instances (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,flow_id text NOT NULL,revision integer NOT NULL,generation integer NOT NULL,
 actor_hash text NOT NULL,channel_id text NOT NULL,application_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 interaction_id text,PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id,flow_id) REFERENCES automation_flows ON DELETE CASCADE,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
-- Additional transitions use the same domain outbox, independently of existing
-- consumers' expanded_at flag. Created/resolved retain their existing event IDs.
ALTER TABLE operations_domain_events DROP CONSTRAINT operations_domain_events_event_type_check;
ALTER TABLE operations_domain_events ADD CHECK(event_type IN ('attention.created','attention.updated','attention.resolved','playbook.executed','intervention.review_ready','coverage.changed','aggregate.export'));
CREATE FUNCTION nexus_attention_update_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.version IS DISTINCT FROM OLD.version)
  AND NOT(NEW.status='RESOLVED' AND NEW.status IS DISTINCT FROM OLD.status) THEN
  INSERT INTO operations_domain_events(organization_id,guild_id,event_type,dedupe_key,data)
  VALUES(NEW.organization_id,NEW.guild_id,'attention.updated','attention:'||NEW.message_id||':'||NEW.version,
   jsonb_build_object('attentionKey',NEW.message_id,'state',NEW.status,'version',NEW.version)) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attention_update_domain_event AFTER UPDATE ON attention_items FOR EACH ROW EXECUTE FUNCTION nexus_attention_update_event();
-- Capture recipients and the active revision atomically with the trusted source
-- INSERT. Enabling/re-enabling cannot replay old events after a worker outage.
CREATE FUNCTION nexus_automation_ticket_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trigger_kind text;
BEGIN
 IF NEW.event_type NOT IN ('attention.created','attention.updated','attention.resolved') THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.data->'attentionKey') IS DISTINCT FROM 'string' OR length(NEW.data->>'attentionKey') NOT BETWEEN 1 AND 128
  OR NEW.data->>'state' IS NULL
  OR NEW.data->>'state' NOT IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED')
  OR jsonb_typeof(NEW.data->'version') IS DISTINCT FROM 'number' OR (NEW.data->>'version')!~'^[0-9]{1,9}$' THEN RETURN NEW; END IF;
 trigger_kind=CASE WHEN NEW.event_type='attention.created' THEN 'ticketCreated' ELSE 'ticketUpdated' END;
 IF NOT EXISTS(SELECT 1 FROM attention_items a JOIN operations_requests r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.attention_key=a.message_id
  WHERE a.organization_id=NEW.organization_id AND a.guild_id=NEW.guild_id AND a.message_id=NEW.data->>'attentionKey'
  AND a.item_type='OPERATIONS_REQUEST' AND a.message_id='intake:'||r.id::text) THEN RETURN NEW; END IF;
 -- Share the normal host/guild admission fence. These hard capture ceilings
 -- bound minimal metadata storage; they do not authorize catch-up/retries.
 PERFORM pg_advisory_xact_lock(763215);
 PERFORM pg_advisory_xact_lock(hashtextextended('automation:'||NEW.organization_id::text||':'||NEW.guild_id,0));
 -- Match SettingsService's effective default. An absent row/field is true;
 -- an explicit false or malformed JSON value is never positive authorization.
 IF COALESCE((SELECT COALESCE(g.settings->'enabled','true'::jsonb) FROM guild_settings g WHERE g.organization_id=NEW.organization_id AND g.guild_id=NEW.guild_id),'true'::jsonb) IS DISTINCT FROM 'true'::jsonb THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM automation_event_inbox)>=10000 OR (SELECT count(*) FROM automation_event_inbox WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id)>=1000 THEN RETURN NEW; END IF;
 INSERT INTO automation_event_inbox(organization_id,guild_id,source,event_id,flow_id,revision,generation,kind,ticket_id,ticket_state,ticket_version,beta_generation,occurred_at,deadline_at)
 SELECT f.organization_id,f.guild_id,'INTERNAL',NEW.id::text,f.id,f.active_revision,f.generation,trigger_kind,
  NEW.data->>'attentionKey',NEW.data->>'state',(NEW.data->>'version')::integer,f.beta_generation,NEW.created_at,now()+interval '7 days'
 FROM automation_flows f JOIN automation_revisions r ON r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.flow_id=f.id AND r.revision=f.active_revision
 WHERE f.organization_id=NEW.organization_id AND f.guild_id=NEW.guild_id AND f.state='ACTIVE'
  AND r.definition->'trigger'->>'kind'='internal' AND r.definition->'trigger'->>'event'=trigger_kind
  AND (SELECT count(*) FROM automation_event_inbox WHERE state='PENDING')<100
  AND (SELECT count(*) FROM automation_event_inbox WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND state='PENDING')<20
 ORDER BY f.id LIMIT LEAST(
  100-(SELECT count(*) FROM automation_event_inbox WHERE state='PENDING'),
  20-(SELECT count(*) FROM automation_event_inbox WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND state='PENDING'),
  10000-(SELECT count(*) FROM automation_event_inbox),
  1000-(SELECT count(*) FROM automation_event_inbox WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id))
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
-- Intake inserts attention/outbox before its request row in the same transaction.
-- Verify the completed trusted record at commit; rolled-back/incomplete intake
-- and analytical/ordinary attention events cannot become ticket triggers.
CREATE CONSTRAINT TRIGGER automation_ticket_event AFTER INSERT ON operations_domain_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nexus_automation_ticket_event();

-- Global stop remains effective even if false -> true happens entirely between
-- worker passes. Keep active definitions for future events after explicit resume,
-- while fencing every old run, source receipt, schedule occurrence and native click.
CREATE FUNCTION nexus_automation_global_stop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was_enabled boolean;is_enabled boolean;fenced_at timestamptz;
BEGIN
 is_enabled=COALESCE(NEW.settings->'enabled','true'::jsonb)='true'::jsonb;
 IF TG_OP='INSERT' THEN was_enabled=true;
 ELSE was_enabled=COALESCE(OLD.settings->'enabled','true'::jsonb)='true'::jsonb; END IF;
 IF was_enabled=is_enabled THEN RETURN NEW; END IF;
 -- SettingsService already owns privacy, Beta and its settings fence. The
 -- connector holds flow FOR SHARE, but never seeks this automation fence while
 -- owning that row lock; this wait therefore cannot reverse the dispatch order.
 PERFORM pg_advisory_xact_lock(763215);
 PERFORM pg_advisory_xact_lock(hashtextextended('automation:'||NEW.organization_id::text||':'||NEW.guild_id,0));
 fenced_at=clock_timestamp();
 IF NOT is_enabled THEN
  UPDATE automation_flows SET generation=generation+1,updated_at=fenced_at
   WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND state='ACTIVE';
  UPDATE automation_runs SET cancel_requested_at=COALESCE(cancel_requested_at,fenced_at),updated_at=fenced_at
   WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND ended_at IS NULL;
  UPDATE automation_approvals a SET state='EXPIRED'
   FROM automation_runs r WHERE a.organization_id=NEW.organization_id AND a.guild_id=NEW.guild_id
    AND r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.id=a.run_id
    AND r.ended_at IS NULL AND a.state IN ('PENDING','APPROVED');
  UPDATE automation_event_inbox SET state='SKIPPED',reason='AUTOMATION_STOPPED',finished_at=fenced_at,
   ticket_id=NULL,ticket_state=NULL,ticket_version=NULL,channel_id=NULL,actor_ciphertext=NULL
   WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND state='PENDING';
  DELETE FROM component_tokens WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND intent->>'action'='automationTrigger';
  DELETE FROM automation_interaction_instances WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id;
 END IF;
 -- Both stop and resume advance the scheduling cutoff. Even an old occurrence
 -- within the ordinary lateness tolerance must be skipped after resume.
 UPDATE automation_schedules s SET generation=f.generation,admission_after=fenced_at
  FROM automation_flows f WHERE s.organization_id=NEW.organization_id AND s.guild_id=NEW.guild_id
   AND f.organization_id=s.organization_id AND f.guild_id=s.guild_id AND f.id=s.flow_id AND f.state='ACTIVE';
 RETURN NEW;
END $$;
CREATE TRIGGER automation_global_stop AFTER INSERT OR UPDATE OF settings ON guild_settings FOR EACH ROW EXECUTE FUNCTION nexus_automation_global_stop();
