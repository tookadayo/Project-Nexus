-- Pin the actual v0.1 start-channel definition instead of relabeling historical activation.
INSERT INTO guild_config_revisions(organization_id,guild_id,id,domain,version,definition,hash,author,state,published_at)
SELECT s.organization_id,s.guild_id,gen_random_uuid(),'activation',1,d.definition,
 encode(sha256(convert_to(d.definition::text,'UTF8')),'hex'),'migration:v01','published',g.created_at
FROM guild_settings s JOIN guilds g USING(organization_id,guild_id)
CROSS JOIN LATERAL (SELECT jsonb_build_object('name','Legacy start-channel activation','windowSeconds',COALESCE((s.settings->>'activationWindowHours')::integer,168)*3600,'rule',jsonb_build_object('op','channel_activity','channelId',s.settings->>'startChannelId','gte',1,'withinSeconds',COALESCE((s.settings->>'activationWindowHours')::integer,168)*3600)) AS definition) d
WHERE s.settings->>'startChannelId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM guild_config_revisions r WHERE r.organization_id=s.organization_id AND r.guild_id=s.guild_id AND r.domain='activation');
INSERT INTO guild_config_heads
SELECT organization_id,guild_id,'activation',id FROM guild_config_revisions WHERE author='migration:v01' AND domain='activation'
ON CONFLICT DO NOTHING;
INSERT INTO activation_members
SELECT e.organization_id,e.guild_id,e.id,r.id,m.activated_at FROM membership_episodes e
JOIN guild_config_revisions r ON r.organization_id=e.organization_id AND r.guild_id=e.guild_id AND r.author='migration:v01' AND r.domain='activation'
LEFT JOIN member_lifecycle_state m ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.episode_id=e.id
WHERE e.context='PRODUCTION' ON CONFLICT DO NOTHING;
