-- Per-run CT05 continuation metadata only. The sequence is a commit-fence
-- cursor, not an event history: it stores no ticket, actor or message data.
CREATE SEQUENCE automation_await_event_cursor;
CREATE TABLE automation_event_waits (
 organization_id uuid NOT NULL,guild_id text NOT NULL,run_id uuid NOT NULL,identity text NOT NULL CHECK(identity~'^[a-f0-9]{64}$'),
 revision integer NOT NULL,generation integer NOT NULL,fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 ticket_id text,event_kind text NOT NULL CHECK(event_kind='ticketUpdated'),states text[] NOT NULL,
 after_version integer NOT NULL CHECK(after_version>=0),registration_cursor bigint NOT NULL,
 registered_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','MATCHED','TIMED_OUT','CANCELLED')),
 matched_cursor bigint,matched_state text,matched_version integer,occurred_at timestamptz,consumed_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,run_id,identity),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE CASCADE,
 CHECK(expires_at>registered_at AND expires_at<=registered_at+interval '7 days'),
 CHECK(cardinality(states) BETWEEN 1 AND 6 AND states<@ARRAY['OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED']::text[]),
 CHECK((state IN ('PENDING','MATCHED'))=(ticket_id IS NOT NULL)),
 CHECK(ticket_id IS NULL OR ticket_id~'^intake:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 CHECK((state='MATCHED')=(matched_cursor IS NOT NULL AND matched_state IS NOT NULL AND matched_version IS NOT NULL AND occurred_at IS NOT NULL)),
 CHECK(matched_state IS NULL OR matched_state=ANY(states)),
 CHECK(matched_cursor IS NULL OR matched_cursor>registration_cursor),
 CHECK(matched_version IS NULL OR matched_version>after_version)
);
CREATE INDEX automation_event_wait_ticket ON automation_event_waits(organization_id,guild_id,ticket_id) WHERE state='PENDING';

CREATE FUNCTION nexus_automation_capture_wait() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_cursor bigint;captured_at timestamptz;
BEGIN
 IF NEW.event_type NOT IN ('attention.updated','attention.resolved') THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.data->'attentionKey') IS DISTINCT FROM 'string'
  OR (NEW.data->>'attentionKey')!~'^intake:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR NEW.data->>'state' IS NULL OR NEW.data->>'state' NOT IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED')
  OR jsonb_typeof(NEW.data->'version') IS DISTINCT FROM 'number' OR (NEW.data->>'version')!~'^[0-9]{1,9}$' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM attention_items a JOIN operations_requests r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.attention_key=a.message_id
  WHERE a.organization_id=NEW.organization_id AND a.guild_id=NEW.guild_id AND a.message_id=NEW.data->>'attentionKey'
   AND a.item_type='OPERATIONS_REQUEST' AND a.message_id='intake:'||r.id::text AND a.version>=(NEW.data->>'version')::integer) THEN RETURN NEW; END IF;
 -- Registration and the existing event-ingress trigger use these same fences.
 -- A concurrent source transaction becomes eligible when its deferred capture
 -- commits after registration, even if its transaction began earlier.
 PERFORM pg_advisory_xact_lock(763215);
 PERFORM pg_advisory_xact_lock(hashtextextended('automation:'||NEW.organization_id::text||':'||NEW.guild_id,0));
 IF COALESCE((SELECT COALESCE(g.settings->'enabled','true'::jsonb) FROM guild_settings g WHERE g.organization_id=NEW.organization_id AND g.guild_id=NEW.guild_id),'true'::jsonb) IS DISTINCT FROM 'true'::jsonb THEN RETURN NEW; END IF;
 event_cursor=nextval('automation_await_event_cursor');captured_at=clock_timestamp();
 UPDATE automation_event_waits w SET state='MATCHED',matched_cursor=event_cursor,
  matched_state=NEW.data->>'state',matched_version=(NEW.data->>'version')::integer,occurred_at=NEW.created_at
 FROM automation_runs r JOIN automation_flows f ON f.organization_id=r.organization_id AND f.guild_id=r.guild_id AND f.id=r.flow_id
 WHERE w.organization_id=NEW.organization_id AND w.guild_id=NEW.guild_id AND w.ticket_id=NEW.data->>'attentionKey'
  AND w.state='PENDING' AND w.expires_at>captured_at AND w.registration_cursor<event_cursor
  AND w.after_version<(NEW.data->>'version')::integer AND NEW.data->>'state'=ANY(w.states)
  AND r.organization_id=w.organization_id AND r.guild_id=w.guild_id AND r.id=w.run_id
  AND r.ended_at IS NULL AND r.cancel_requested_at IS NULL AND r.deadline_at>captured_at AND r.revision=w.revision
  AND f.state='ACTIVE';
 -- Wake only affected live runs. The run checkpoint trigger below closes the
 -- capture-before-WAITING-save race without a busy polling loop.
 UPDATE automation_runs r SET wake_at=LEAST(COALESCE(r.wake_at,captured_at),captured_at),updated_at=captured_at
 WHERE r.organization_id=NEW.organization_id AND r.guild_id=NEW.guild_id AND r.ended_at IS NULL AND r.cancel_requested_at IS NULL
  AND EXISTS(SELECT 1 FROM automation_event_waits w WHERE w.organization_id=r.organization_id AND w.guild_id=r.guild_id AND w.run_id=r.id AND w.matched_cursor=event_cursor AND w.state='MATCHED' AND w.consumed_at IS NULL);
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER automation_ticket_wait AFTER INSERT ON operations_domain_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nexus_automation_capture_wait();

CREATE FUNCTION nexus_automation_wait_run_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.ended_at IS NOT NULL OR NEW.cancel_requested_at IS NOT NULL THEN
  UPDATE automation_event_waits SET state='CANCELLED',ticket_id=NULL,matched_cursor=NULL,matched_state=NULL,matched_version=NULL,occurred_at=NULL
   WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND run_id=NEW.id AND state IN ('PENDING','MATCHED');
 ELSIF NEW.status IN ('WAITING','WAITING_APPROVAL') AND EXISTS(SELECT 1 FROM automation_event_waits WHERE organization_id=NEW.organization_id AND guild_id=NEW.guild_id AND run_id=NEW.id AND state='MATCHED' AND consumed_at IS NULL) THEN
  NEW.wake_at=LEAST(COALESCE(NEW.wake_at,clock_timestamp()),COALESCE(OLD.wake_at,clock_timestamp()),clock_timestamp());
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_wait_run_fence BEFORE UPDATE OF ended_at,cancel_requested_at,status,wake_at ON automation_runs FOR EACH ROW EXECUTE FUNCTION nexus_automation_wait_run_fence();
CREATE FUNCTION nexus_automation_wait_flow_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- New revisions apply only to new Runs; a live Run keeps its fixed revision.
 -- A stop/delete, including restored state, fences its existing continuations.
 IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state<>'ACTIVE' THEN
  UPDATE automation_event_waits w SET state='CANCELLED',ticket_id=NULL,matched_cursor=NULL,matched_state=NULL,matched_version=NULL,occurred_at=NULL
   FROM automation_runs r WHERE w.organization_id=NEW.organization_id AND w.guild_id=NEW.guild_id
    AND r.organization_id=w.organization_id AND r.guild_id=w.guild_id AND r.id=w.run_id AND r.flow_id=NEW.id AND w.state IN ('PENDING','MATCHED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_wait_flow_fence AFTER UPDATE OF state,generation,active_revision ON automation_flows FOR EACH ROW EXECUTE FUNCTION nexus_automation_wait_flow_fence();
-- Request/member retention erases the correlation immediately, including when
-- attention erasure cascades through the existing operations request table.
CREATE FUNCTION nexus_automation_wait_ticket_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE automation_event_waits SET state='CANCELLED',ticket_id=NULL,matched_cursor=NULL,matched_state=NULL,matched_version=NULL,occurred_at=NULL
  WHERE organization_id=OLD.organization_id AND guild_id=OLD.guild_id AND ticket_id='intake:'||OLD.id::text AND state IN ('PENDING','MATCHED');
 RETURN OLD;
END $$;
CREATE TRIGGER automation_wait_ticket_erasure AFTER DELETE ON operations_requests FOR EACH ROW EXECUTE FUNCTION nexus_automation_wait_ticket_erasure();
