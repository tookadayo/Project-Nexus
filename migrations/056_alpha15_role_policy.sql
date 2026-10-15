-- A digest of the exact native role/permission impact reviewed by the approver.
-- It follows the existing approval/run retention and contains no message data.
ALTER TABLE automation_approvals ADD COLUMN policy_fingerprint text;
ALTER TABLE automation_approvals ADD CONSTRAINT automation_approval_policy_digest
  CHECK (policy_fingerprint IS NULL OR policy_fingerprint ~ '^[0-9a-f]{64}$');
