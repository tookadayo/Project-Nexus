CREATE TABLE promotion_campaigns (
 id uuid PRIMARY KEY, name text NOT NULL, benefit_type text NOT NULL CHECK(benefit_type IN ('DISCOUNT','TRIAL','PLAN_GRANT','FEATURE_GRANT','PARTNER_GRANT','DEBUG_GRANT')),
 target_plan text REFERENCES plans(key), features jsonb NOT NULL DEFAULT '[]',
 discount_type text CHECK(discount_type IN ('PERCENT','FIXED')), discount_value integer,
 duration_days integer CHECK(duration_days BETWEEN 1 AND 3650), until_revoked boolean NOT NULL DEFAULT false,
 valid_from timestamptz NOT NULL, valid_until timestamptz,
 max_redemptions integer CHECK(max_redemptions>0), max_redemptions_per_guild integer NOT NULL DEFAULT 1 CHECK(max_redemptions_per_guild>0),
 redeemed_count integer NOT NULL DEFAULT 0 CHECK(redeemed_count>=0),
 target_guild_id text, target_organization_id uuid REFERENCES organizations(id),
 allowed_plans jsonb NOT NULL, allowed_providers jsonb NOT NULL,
 stacking_policy text NOT NULL CHECK(stacking_policy IN ('DENY','MAX')),
 created_by text, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 activated_at timestamptz,
 CHECK(valid_until IS NULL OR valid_until>valid_from),
 CHECK(benefit_type<>'DEBUG_GRANT' OR duration_days IS NOT NULL AND NOT until_revoked)
);
CREATE TABLE promotion_codes (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES promotion_campaigns(id),
 code_prefix text NOT NULL, code_hmac text NOT NULL UNIQUE, expires_at timestamptz,
 revoked_at timestamptz, max_redemptions integer NOT NULL DEFAULT 1 CHECK(max_redemptions>0),
 redeemed_count integer NOT NULL DEFAULT 0 CHECK(redeemed_count>=0),
 target_guild_id text, target_organization_id uuid REFERENCES organizations(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE promotion_redemptions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, guild_id text NOT NULL,
 actor_hash text, code_id uuid NOT NULL REFERENCES promotion_codes(id), campaign_id uuid NOT NULL REFERENCES promotion_campaigns(id),
 redeemed_at timestamptz NOT NULL DEFAULT now(), benefit_start timestamptz NOT NULL, benefit_end timestamptz,
 created_grant uuid REFERENCES entitlement_grants(id) ON DELETE SET NULL,
 provider_discount_ref text,
 request_digest text, result_plan text REFERENCES plans(key),
 FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
CREATE INDEX promotion_redemption_campaign ON promotion_redemptions(campaign_id,guild_id);
CREATE UNIQUE INDEX promotion_redemption_request ON promotion_redemptions(organization_id,guild_id,request_digest) WHERE request_digest IS NOT NULL;
CREATE TABLE promotion_attempt_limits (
 organization_id uuid NOT NULL, guild_id text NOT NULL, actor_hash text NOT NULL,
 window_start timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,guild_id,actor_hash), FOREIGN KEY(organization_id,guild_id) REFERENCES guilds ON DELETE CASCADE
);
