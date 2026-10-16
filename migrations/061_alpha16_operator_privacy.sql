-- Expand-only Operator/Privacy integration. No policy, permission, TTL, secret,
-- session, deletion, public listener or dispatch activation is installed here.
-- deletion_requests remains the existing scoped member tombstone canonical row.
ALTER TABLE deletion_requests ADD COLUMN alpha16_expires_at timestamptz;
ALTER TABLE operator_audit ADD COLUMN retention_class text CHECK(retention_class IS NULL OR retention_class='ALPHA16');
ALTER TABLE operator_audit ADD COLUMN expires_at timestamptz;
ALTER TABLE operator_audit ADD CONSTRAINT alpha16_operator_audit_expiry CHECK((retention_class IS NULL)=(expires_at IS NULL));
CREATE TABLE alpha16_privacy_jobs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, guild_id text NOT NULL,
 tombstone_id uuid NOT NULL,
 subject_hash text NOT NULL CHECK(subject_hash~'^[a-f0-9]{64}$'),
 subject_ciphertext text, scope_kind text NOT NULL CHECK(scope_kind='GUILD'),
 preview_hash text NOT NULL CHECK(preview_hash~'^[a-f0-9]{64}$'),
 plan_revision text NOT NULL,
 state text NOT NULL CHECK(state IN ('QUEUED','RUNNING','PARTIAL_FAILURE','LIVE_COMPLETED','FAILED')),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>0),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 worker_owner uuid, lease_until timestamptz,
 failure_code text CHECK(failure_code IS NULL OR failure_code IN ('PURGE_INCOMPLETE','DEPENDENCY_UNAVAILABLE')),
 backup_state text NOT NULL DEFAULT 'UNKNOWN' CHECK(backup_state IN ('PENDING_EXPIRY','EXPIRED','UNKNOWN')),
 backup_expiry_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 live_completed_at timestamptz, expires_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,guild_id,tombstone_id) REFERENCES deletion_requests ON DELETE RESTRICT,
 UNIQUE(organization_id,guild_id,subject_hash),
 CHECK((worker_owner IS NULL)=(lease_until IS NULL)),
 CHECK((state='LIVE_COMPLETED')=(live_completed_at IS NOT NULL))
);
CREATE TABLE alpha16_deletion_receipts (
 id uuid PRIMARY KEY, job_id uuid REFERENCES alpha16_privacy_jobs ON DELETE SET NULL,
 secret_hash text NOT NULL UNIQUE CHECK(secret_hash~'^[a-f0-9]{64}$'),
 scope_hash text NOT NULL CHECK(scope_hash~'^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 last_used_at timestamptz, use_count integer NOT NULL DEFAULT 0 CHECK(use_count>=0),
 window_start timestamptz NOT NULL DEFAULT now(), window_uses integer NOT NULL DEFAULT 0 CHECK(window_uses>=0),
 CHECK(expires_at>issued_at)
);
CREATE TABLE alpha16_operator_previews (
 id uuid PRIMARY KEY, session_digest text NOT NULL REFERENCES operator_sessions(digest) ON DELETE CASCADE,
 command_kind text NOT NULL CHECK(command_kind IN ('PRIVACY_DELETE','CONTROL','ADMISSION','BETA_LIFECYCLE','ANNOUNCEMENT','LEGAL_SETTINGS')),
 fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 preview_hash text NOT NULL CHECK(preview_hash~'^[a-f0-9]{64}$'),
 typed_payload jsonb NOT NULL CHECK(jsonb_typeof(typed_payload)='object'),
 policy_revision text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, CHECK(expires_at>created_at)
);
CREATE TABLE alpha16_operator_challenges (
 id uuid PRIMARY KEY, preview_id uuid NOT NULL REFERENCES alpha16_operator_previews ON DELETE CASCADE,
 session_digest text NOT NULL REFERENCES operator_sessions(digest) ON DELETE CASCADE,
 challenge_hash text NOT NULL UNIQUE CHECK(challenge_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz,
 CHECK(expires_at>created_at), UNIQUE(preview_id)
);
CREATE TABLE alpha16_operator_stepups (
 token_hash text PRIMARY KEY CHECK(token_hash~'^[a-f0-9]{64}$'),
 preview_id uuid NOT NULL REFERENCES alpha16_operator_previews ON DELETE CASCADE,
 session_digest text NOT NULL REFERENCES operator_sessions(digest) ON DELETE CASCADE,
 credential_epoch uuid NOT NULL, preview_hash text NOT NULL CHECK(preview_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, consumed_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE TABLE alpha16_operator_controls (
 scope_key text PRIMARY KEY,
 scope_kind text NOT NULL CHECK(scope_kind IN ('GLOBAL','GUILD','FLOW','RULE')),
 organization_id uuid, guild_id text, target_id text,
 state text NOT NULL CHECK(state IN ('STOPPED','RUNNING')),
 revision bigint NOT NULL CHECK(revision>0),
 reason_code text NOT NULL CHECK(reason_code IN ('MAINTENANCE','INCIDENT_REVIEW','CONFIG_REVIEW','OPERATOR_REQUEST')),
 updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CHECK((scope_kind='GLOBAL' AND organization_id IS NULL AND guild_id IS NULL AND target_id IS NULL)
    OR (scope_kind='GUILD' AND organization_id IS NOT NULL AND guild_id IS NOT NULL AND target_id IS NULL)
    OR (scope_kind IN ('FLOW','RULE') AND organization_id IS NOT NULL AND guild_id IS NOT NULL AND target_id IS NOT NULL))
);
CREATE TABLE alpha16_operator_commands (
 idempotency_hash text PRIMARY KEY CHECK(idempotency_hash~'^[a-f0-9]{64}$'),
 session_digest text NOT NULL REFERENCES operator_sessions(digest) ON DELETE CASCADE,
 fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 preview_id uuid NOT NULL REFERENCES alpha16_operator_previews ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX alpha16_privacy_job_pending ON alpha16_privacy_jobs(state,created_at) WHERE state IN ('QUEUED','PARTIAL_FAILURE');
CREATE INDEX alpha16_operator_preview_expiry ON alpha16_operator_previews(expires_at);
CREATE INDEX alpha16_receipt_expiry ON alpha16_deletion_receipts(expires_at);
