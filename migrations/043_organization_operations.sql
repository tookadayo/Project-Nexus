-- Staff governance is explicit NEXUS membership, separate from Discord roles.
CREATE TABLE operations_organizations (
 id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),home_guild_id text NOT NULL,
 FOREIGN KEY(id,home_guild_id) REFERENCES guilds(organization_id,guild_id) ON DELETE CASCADE
);
CREATE TABLE operations_org_guilds (
 root_organization_id uuid NOT NULL REFERENCES operations_organizations ON DELETE CASCADE,organization_id uuid NOT NULL,guild_id text NOT NULL,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','REQUIRES_REVIEW','PAUSED_PLAN_LIMIT')),linked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(root_organization_id,organization_id,guild_id),UNIQUE(organization_id,guild_id),FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE TABLE operations_org_members (
 organization_id uuid NOT NULL REFERENCES operations_organizations ON DELETE CASCADE,id uuid NOT NULL DEFAULT gen_random_uuid(),user_digest text NOT NULL,user_ciphertext text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),role text NOT NULL CHECK(role IN ('OWNER','ADMIN','OPERATOR','ANALYST','VIEWER')),state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','REVOKED')),revision integer NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,user_digest)
);
CREATE TABLE operations_role_bindings (
 organization_id uuid NOT NULL,guild_id text NOT NULL,root_organization_id uuid NOT NULL,member_id uuid NOT NULL,actor_hash text NOT NULL,
 PRIMARY KEY(organization_id,guild_id,actor_hash),FOREIGN KEY(root_organization_id,organization_id,guild_id) REFERENCES operations_org_guilds ON DELETE CASCADE,
 FOREIGN KEY(root_organization_id,member_id) REFERENCES operations_org_members(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE operations_teams (
 organization_id uuid NOT NULL REFERENCES operations_organizations ON DELETE CASCADE,id uuid NOT NULL DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,name)
);
CREATE TABLE operations_team_members (
 organization_id uuid NOT NULL,team_id uuid NOT NULL,member_id uuid NOT NULL,
 PRIMARY KEY(organization_id,team_id,member_id),FOREIGN KEY(organization_id,team_id) REFERENCES operations_teams ON DELETE CASCADE,FOREIGN KEY(organization_id,member_id) REFERENCES operations_org_members ON DELETE CASCADE
);
CREATE TABLE operations_team_bindings (
 organization_id uuid NOT NULL,guild_id text NOT NULL,team_id uuid NOT NULL,root_organization_id uuid NOT NULL,
 PRIMARY KEY(organization_id,guild_id,team_id),FOREIGN KEY(root_organization_id,organization_id,guild_id) REFERENCES operations_org_guilds ON DELETE CASCADE,
 FOREIGN KEY(root_organization_id,team_id) REFERENCES operations_teams(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE attention_items ADD FOREIGN KEY(organization_id,guild_id,assigned_team_id) REFERENCES operations_team_bindings ON DELETE SET NULL(assigned_team_id);
ALTER TABLE operations_interventions ADD FOREIGN KEY(organization_id,guild_id,assigned_team_id) REFERENCES operations_team_bindings ON DELETE SET NULL(assigned_team_id);
ALTER TABLE integration_destinations ADD FOREIGN KEY(organization_id,guild_id,team_id) REFERENCES operations_team_bindings ON DELETE CASCADE;
ALTER TABLE playbooks ADD COLUMN review_team_id uuid;
ALTER TABLE playbooks ADD FOREIGN KEY(organization_id,guild_id,review_team_id) REFERENCES operations_team_bindings ON DELETE SET NULL(review_team_id);
