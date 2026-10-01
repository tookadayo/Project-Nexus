import { sql } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Settings } from "../../settings/src/index";

// Shared by the queue and delivery worker: purpose changes never alter the configured delay.
export function attentionEligibility(s: Scope, cfg: Settings, now: Date) {
  const mapped = sql`EXISTS(SELECT 1 FROM discord_surface_state ch JOIN jsonb_array_elements(${JSON.stringify(cfg.communityModel.channels)}::jsonb) mapping ON mapping->>'channelId'=ch.parent_id WHERE ch.organization_id=f.organization_id AND ch.guild_id=f.guild_id AND ch.channel_id=f.data->>'channelId' AND mapping->>'purpose' IN ('SUPPORT','LFG') AND ${cfg.communityModel.confirmed})`;
  const observedOwner = sql`EXISTS(SELECT 1 FROM discord_surface_state ch JOIN member_identity_map m ON m.organization_id=ch.organization_id AND m.guild_id=ch.guild_id AND m.lookup_hash=ch.owner_hash WHERE ch.organization_id=${s.organizationId}::uuid AND ch.guild_id=${s.guildId} AND ch.channel_id=f.data->>'channelId' AND m.id=e.identity_id AND ch.creation_observed AND ch.created_at>=${new Date(now.getTime() - 86400000)} AND f.occurred_at>=ch.created_at)`;
  return sql`CASE WHEN ${mapped} THEN ${observedOwner} AND f.data->>'receivedHumanParticipant' IS DISTINCT FROM 'true' ELSE COALESCE(e.engagement_started_at,e.joined_at)>=${new Date(now.getTime() - 3 * 86400000)} AND f.occurred_at>=COALESCE(e.engagement_started_at,e.joined_at) AND f.occurred_at<COALESCE(e.engagement_started_at,e.joined_at)+interval '72 hours' END`;
}
