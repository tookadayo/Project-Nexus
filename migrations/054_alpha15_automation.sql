-- alpha15 has its own usage/retention domain. Existing analytical history and
-- administrative audit records are deliberately not repurposed.
CREATE TABLE automation_flows (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 draft_revision integer NOT NULL DEFAULT 0 CHECK(draft_revision>=0),
 active_revision integer, state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','DISABLED','DELETED')),
 generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
 activator_hash text,activator_ciphertext text,beta_generation integer,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 CHECK((state='DELETED')=(deleted_at IS NOT NULL))
);
CREATE TABLE automation_revisions (
 organization_id uuid NOT NULL,guild_id text NOT NULL,flow_id text NOT NULL,revision integer NOT NULL CHECK(revision>0),
 definition jsonb NOT NULL,semantic_hash text NOT NULL CHECK(semantic_hash~'^[a-f0-9]{64}$'),
 complete boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,flow_id,revision),
 FOREIGN KEY(organization_id,guild_id,flow_id) REFERENCES automation_flows ON DELETE CASCADE,
 CHECK(pg_column_size(definition)<=1048576)
);
CREATE TABLE automation_checks (
 organization_id uuid NOT NULL,guild_id text NOT NULL,flow_id text NOT NULL,revision integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('VALIDATE','TEST','IMPACT')),semantic_hash text NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,flow_id,revision,kind),
 FOREIGN KEY(organization_id,guild_id,flow_id,revision) REFERENCES automation_revisions ON DELETE CASCADE
);
CREATE TABLE automation_requests (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 actor_hash text NOT NULL,fingerprint text NOT NULL,flow_id text NOT NULL,revision integer,run_id uuid,
 kind text NOT NULL CHECK(kind IN ('SAVE','ENABLE','DISABLE','DELETE','START','CANCEL')),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id,flow_id) REFERENCES automation_flows ON DELETE CASCADE
);
CREATE TABLE automation_runs (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 flow_id text NOT NULL,revision integer NOT NULL,semantic_hash text NOT NULL,
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 200),input_hash text NOT NULL,
 actor_hash text NOT NULL,actor_ciphertext text NOT NULL,beta_generation integer,
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','WAITING','WAITING_APPROVAL','COMPLETED','FAILED','CANCELLED','EXPIRED','UNKNOWN')),
 usage_state text NOT NULL DEFAULT 'RESERVED' CHECK(usage_state IN ('RESERVED','CONSUMED','RELEASED')),
 usage_month date NOT NULL,
 started_at timestamptz NOT NULL,deadline_at timestamptz NOT NULL,wake_at timestamptz,
 resume jsonb NOT NULL,steps integer NOT NULL DEFAULT 0,evaluations integer NOT NULL DEFAULT 0,external_actions integer NOT NULL DEFAULT 0,
 cancel_requested_at timestamptz,ended_at timestamptz,reason text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,dedupe_key),
 FOREIGN KEY(organization_id,guild_id,flow_id,revision) REFERENCES automation_revisions,
 CHECK(deadline_at>=started_at AND deadline_at<=started_at+interval '7 days'),
 CHECK(wake_at IS NULL OR wake_at<=deadline_at),CHECK(steps>=0 AND evaluations>=0 AND external_actions>=0),
 CHECK(pg_column_size(resume)<=1048576)
);
-- Numeric monthly accounting outlives the seven-day execution records; deleting
-- a run must not refill its quota. No inputs, identities or run IDs are kept here.
CREATE TABLE automation_usage_months (
 organization_id uuid NOT NULL,guild_id text NOT NULL,month date NOT NULL,
 reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0),consumed integer NOT NULL DEFAULT 0 CHECK(consumed>=0),
 PRIMARY KEY(organization_id,guild_id,month),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds
);
CREATE INDEX automation_due_runs ON automation_runs(wake_at,created_at) WHERE ended_at IS NULL;
CREATE TABLE automation_random_results (
 organization_id uuid NOT NULL,guild_id text NOT NULL,run_id uuid NOT NULL,identity text NOT NULL,
 fingerprint text NOT NULL,input jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,run_id,identity),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE CASCADE
);
CREATE TABLE automation_operations (
 organization_id uuid NOT NULL,guild_id text NOT NULL,run_id uuid NOT NULL,identity text NOT NULL,
 operation text NOT NULL,fingerprint text NOT NULL,
 state text NOT NULL CHECK(state IN ('STARTED','SUCCEEDED','FAILED','NOT_STARTED','UNKNOWN')),
 result jsonb,reason text,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,run_id,identity),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE CASCADE
);
-- This table contains status/IDs only. It must never contain message content,
-- input values, variable values, tokens, or connector responses.
CREATE TABLE automation_run_events (
 organization_id uuid NOT NULL,guild_id text NOT NULL,run_id uuid NOT NULL,sequence integer NOT NULL,
 block_id text,state text NOT NULL,code text,occurred_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,run_id,sequence),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE CASCADE
);
CREATE TABLE automation_approvals (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,run_id uuid NOT NULL,
 revision integer NOT NULL,identity text NOT NULL,operation text NOT NULL,
 fingerprint text NOT NULL,inputs jsonb NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
 requested_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 approver_hash text,approver_ciphertext text,decided_at timestamptz,request_id uuid,
 PRIMARY KEY(organization_id,guild_id,id),UNIQUE(organization_id,guild_id,run_id,identity),
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE CASCADE,
 CHECK(operation IN ('discord.addRole','discord.removeRole')),
 CHECK(pg_column_size(inputs)<=16384)
);
CREATE TABLE automation_schedules (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id text NOT NULL,flow_id text NOT NULL,
 revision integer NOT NULL,generation integer NOT NULL CHECK(generation>0),rule_hash text NOT NULL,
 enabled boolean NOT NULL,next_at timestamptz,deleted_at timestamptz,
 PRIMARY KEY(organization_id,guild_id,id),
 FOREIGN KEY(organization_id,guild_id,flow_id,revision) REFERENCES automation_revisions
);
CREATE TABLE automation_occurrences (
 organization_id uuid NOT NULL,guild_id text NOT NULL,schedule_id text NOT NULL,generation integer NOT NULL,
 occurrence_key text NOT NULL,scheduled_at timestamptz NOT NULL,run_id uuid,
 state text NOT NULL CHECK(state IN ('STARTED','SKIPPED','CANCELLED')),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,guild_id,schedule_id,generation,occurrence_key),
 FOREIGN KEY(organization_id,guild_id,schedule_id) REFERENCES automation_schedules ON DELETE CASCADE,
 FOREIGN KEY(organization_id,guild_id,run_id) REFERENCES automation_runs ON DELETE SET NULL (run_id)
);
