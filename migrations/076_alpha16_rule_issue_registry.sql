-- Explicit resource configuration, not a second evaluation/history store.
-- A census declaration is usable for at most 48h; reading never renews it.
CREATE TABLE rule_issue_registry (
 organization_id uuid NOT NULL,guild_id text NOT NULL,id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),issue_code text NOT NULL,base_rule_id text NOT NULL,
 base_target_type text NOT NULL,base_target_id text NOT NULL,base_live_version text NOT NULL,
 experiment_ids uuid[] NOT NULL,playbook_ids uuid[] NOT NULL,
 experiments_complete boolean NOT NULL,playbooks_complete boolean NOT NULL,
 experiment_inventory_hash text NOT NULL,playbook_inventory_hash text NOT NULL,
 declared_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,guild_id,id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds,
 UNIQUE(organization_id,guild_id,issue_code,base_target_type,base_target_id),
 CHECK(base_rule_id IN ('ONB-001','HELP-001','RET-001','ENG-001','EVENT-001','REPORT-001','AUTO-001','AUTO-002','PERM-001')),
 CHECK(char_length(base_target_type) BETWEEN 1 AND 128 AND char_length(base_target_id) BETWEEN 1 AND 128 AND char_length(base_live_version) BETWEEN 1 AND 128),
 CHECK(cardinality(experiment_ids)<=100 AND cardinality(playbook_ids)<=100),
 CHECK(experiment_inventory_hash~'^[a-f0-9]{64}$' AND playbook_inventory_hash~'^[a-f0-9]{64}$'),
 CHECK(expires_at>declared_at AND expires_at<=declared_at+interval '48 hours')
);
CREATE INDEX rule_issue_registry_expiry ON rule_issue_registry(expires_at);
