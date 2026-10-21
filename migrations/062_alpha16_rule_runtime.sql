-- Structural only: this migration grants no runtime/retention approval and
-- starts no dispatch. The existing automation_runs remains the Run authority.
CREATE TABLE rule_runtime_intents (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 run_id uuid,target_type text NOT NULL,target_id text NOT NULL,live_version text NOT NULL,
 safety_epoch bigint NOT NULL CHECK(safety_epoch>0),action_class text NOT NULL,
 suggestion_id uuid NOT NULL,suggestion_version integer NOT NULL CHECK(suggestion_version>0),
 draft_id text NOT NULL,immutable_revision_id text NOT NULL,draft_content_hash text NOT NULL,
 approval_id text NOT NULL,approval_hash text NOT NULL,effect_descriptor_hash text NOT NULL,
 actor_hash text NOT NULL,operation_token_hash text NOT NULL,operation_binding jsonb NOT NULL,
 operation_binding_hash text NOT NULL,token_expires_at timestamptz NOT NULL,
 runtime_policy_revision text NOT NULL,target_policy_revision text NOT NULL,
 state text NOT NULL CHECK(state IN ('READY','CLAIMED','EXECUTING','CANCEL_REQUESTED','SUCCEEDED','FAILED_PRE_EFFECT','FAILED_CONFIRMED','CANCELLED','RESULT_UNKNOWN')),
 state_version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL,
 send_admitted_at timestamptz,cancel_requested_at timestamptz,terminal_at timestamptz,
 unknown_resolution_deadline_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 retention_class text NOT NULL CHECK(retention_class IN ('RUN_TERMINAL','OPERATION_INTENT')),
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE CASCADE,
 CHECK((retention_class='RUN_TERMINAL')=(run_id IS NOT NULL)),
 CHECK(token_expires_at>created_at),CHECK(expires_at>created_at),
 CHECK(unknown_resolution_deadline_at>created_at),
 CHECK(draft_content_hash~'^[a-f0-9]{64}$'),CHECK(effect_descriptor_hash~'^[a-f0-9]{64}$'),
 CHECK(operation_token_hash~'^[a-f0-9]{64}$'),CHECK(operation_binding_hash~'^[a-f0-9]{64}$'),
 CHECK((terminal_at IS NOT NULL)=(state IN ('SUCCEEDED','FAILED_PRE_EFFECT','FAILED_CONFIRMED','CANCELLED') OR (state='RESULT_UNKNOWN' AND terminal_at IS NOT NULL)))
);
CREATE UNIQUE INDEX rule_runtime_effect_guard ON rule_runtime_intents(organization_id,guild_id,target_type,target_id,action_class)
 WHERE state IN ('READY','CLAIMED','EXECUTING','CANCEL_REQUESTED','RESULT_UNKNOWN');
CREATE TABLE rule_runtime_attempts (
 organization_id uuid NOT NULL,guild_id text NOT NULL,intent_id uuid NOT NULL,id uuid NOT NULL,
 attempt_no integer NOT NULL CHECK(attempt_no>0),worker_id text NOT NULL,fence_token bigint NOT NULL CHECK(fence_token>0),
 state text NOT NULL CHECK(state IN ('CLAIMED','EXECUTING','SUCCEEDED','FAILED_PRE_EFFECT','FAILED_CONFIRMED','CANCELLED','RESULT_UNKNOWN')),
 effect_descriptor_hash text NOT NULL,claimed_at timestamptz NOT NULL,send_admitted_at timestamptz,
 request_deadline_at timestamptz,completed_at timestamptz,
 result_state text CHECK(result_state IN ('CONFIRMED_SUCCESS','CONFIRMED_NO_EFFECT','UNKNOWN')),
 result_digest text,reconcile_method text,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,intent_id,attempt_no),
 FOREIGN KEY(organization_id,guild_id,intent_id) REFERENCES rule_runtime_intents ON DELETE CASCADE,
 CHECK(effect_descriptor_hash~'^[a-f0-9]{64}$'),CHECK(result_digest IS NULL OR result_digest~'^[a-f0-9]{64}$')
);
CREATE TABLE rule_runtime_leases (
 organization_id uuid NOT NULL,guild_id text NOT NULL,intent_id uuid NOT NULL,
 worker_id text NOT NULL,fence_token bigint NOT NULL CHECK(fence_token>0),
 state text NOT NULL CHECK(state IN ('HELD','RELEASED')),heartbeat_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,intent_id),
 FOREIGN KEY(organization_id,guild_id,intent_id) REFERENCES rule_runtime_intents ON DELETE CASCADE
);
CREATE TABLE rule_runtime_request_keys (
 organization_id uuid NOT NULL,guild_id text NOT NULL,scope_hash text NOT NULL,key_hash text NOT NULL,
 body_hash text NOT NULL,intent_id uuid NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,scope_hash,key_hash),
 FOREIGN KEY(organization_id,guild_id,intent_id) REFERENCES rule_runtime_intents ON DELETE CASCADE,
 CHECK(scope_hash~'^[a-f0-9]{64}$'),CHECK(key_hash~'^[a-f0-9]{64}$'),CHECK(body_hash~'^[a-f0-9]{64}$')
);
CREATE TABLE rule_runtime_outbox (
 organization_id uuid NOT NULL,guild_id text NOT NULL,intent_id uuid NOT NULL,
 event_version bigint NOT NULL DEFAULT 1,state text NOT NULL CHECK(state IN ('PENDING','PUBLISHED','BLOCKED')),
 available_at timestamptz NOT NULL,published_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,intent_id),
 FOREIGN KEY(organization_id,guild_id,intent_id) REFERENCES rule_runtime_intents ON DELETE CASCADE
);
-- Reservation/guard expires with its operation, never retains a Run history.
ALTER TABLE rule_apply_reservations ADD CONSTRAINT rule_reservation_intent_fk
 FOREIGN KEY(organization_id,guild_id,operation_id) REFERENCES rule_runtime_intents ON DELETE CASCADE
 DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX rule_runtime_recovery ON rule_runtime_intents(state,unknown_resolution_deadline_at);
CREATE INDEX rule_runtime_retention ON rule_runtime_intents(expires_at);
CREATE TRIGGER rule_runtime_intent_immutable BEFORE UPDATE ON rule_runtime_intents FOR EACH ROW
 EXECUTE FUNCTION rule_immutable_payload('state','state_version','send_admitted_at','cancel_requested_at','terminal_at');

-- The old Run worker may not bypass target fencing by cascading its parent.
-- Canonical purge must first terminalize/fence and remove all derived runtime
-- rows in the existing scope transaction. This trigger only rejects; it does
-- not acquire advisory/root locks in a reverse order under a Run row lock.
CREATE FUNCTION nexus_rule_run_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM rule_runtime_intents WHERE organization_id=OLD.organization_id
    AND guild_id=OLD.guild_id AND run_id=OLD.id) THEN
    RAISE EXCEPTION 'RULE_RUNTIME_PURGE_REQUIRED';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER rule_run_delete_guard BEFORE DELETE ON automation_runs
 FOR EACH ROW EXECUTE FUNCTION nexus_rule_run_delete_guard();
