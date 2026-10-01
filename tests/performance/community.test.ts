import {beforeAll,afterAll,it,expect} from 'vitest';
import {infrastructure} from '../fixtures/infrastructure.js';
import {connect,migrate,ensureGuild,sql,json,type Database} from '../../packages/db/src/index.js';
import {scopeForGuild,apiToken} from '../../packages/security/src/index.js';
import {AnalyticsService} from '../../packages/analytics/src/index.js';
import {SettingsService} from '../../packages/settings/src/index.js';
import {createApi} from '../../apps/api/src/server.js';
import {buildCapabilitySnapshot} from '../../packages/discord/src/discovery';
import {representativeSource} from '../fixtures/community-profiles';

let infra:Awaited<ReturnType<typeof infrastructure>>,db:Database;
let tenThousandDuration=0;
beforeAll(async()=>{infra=await infrastructure();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
for(const size of [10000,50000])it(`serves overview, comparison and channels for ${size.toLocaleString()} members`,async()=>{
 const s=scopeForGuild(String(901000000000000000n+BigInt(size)));await ensureGuild(db,s);
 if(size===50000){
  await new SettingsService(db).update(s,{key:'fixture',permissions:'8',roles:[],source:'SYSTEM',requestId:'performance'},0,{communityModel:{modes:['SOCIAL','SUPPORT_QA','VOICE','EVENTS','CREATOR_FAN'],confirmed:true,channels:[],forumTags:[],voiceThresholdSeconds:300}});
  await sql`INSERT INTO guild_capability_snapshots VALUES(${s.organizationId}::uuid,${s.guildId},gen_random_uuid(),${json(buildCapabilitySnapshot(representativeSource(4),new Date(),null,{reaction:100000,poll:10000}))},now())`.execute(db);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,parent_id,channel_type,owner_hash,archived,locked,created_at,tag_ids,observed_at,creation_observed) SELECT ${s.organizationId}::uuid,${s.guildId},(960000000000000000::bigint+n)::text,'933333333333333334',11,NULL,false,false,now()-interval '1 hour','{}',now(),true FROM generate_series(1,10000) n`.execute(db);
  await sql`INSERT INTO adaptive_states SELECT ${s.organizationId}::uuid,${s.guildId},domain,(970000000000000000::bigint+n)::text,lpad(to_hex(n%10000),64,'0'),CASE WHEN domain='reaction' THEN lpad(to_hex(1000000+n),64,'0') ELSE NULL END,jsonb_build_object('messageId',(970000000000000000::bigint+n)::text,'channelId','933333333333333330','active',true),now() FROM generate_series(1,100000) n CROSS JOIN (VALUES('reaction'),('poll')) d(domain)`.execute(db);
  await sql`INSERT INTO adaptive_facts SELECT ${s.organizationId}::uuid,${s.guildId},gen_random_uuid(),'thread.response_received',lpad(to_hex(n),64,'0'),NULL,NULL,now(),jsonb_build_object('channelId',(960000000000000000::bigint+n)::text,'parentId','933333333333333334','surface','FORUM_POST','purpose','SUPPORT','latencySeconds',600+n%300) FROM generate_series(1,10000) n`.execute(db);
  await sql`INSERT INTO adaptive_facts SELECT ${s.organizationId}::uuid,${s.guildId},gen_random_uuid(),'voice.copresence',lpad(to_hex(n),64,'0'),NULL,NULL,now(),jsonb_build_object('channelId','933333333333333331','seconds',600) FROM generate_series(1,10000) n`.execute(db);
 }
 // The fixture measures dashboard reads, so bypass write-time retention projections.
 await sql`ALTER TABLE membership_episodes DISABLE TRIGGER ALL`.execute(db);
 try{
  await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id)
   SELECT ${s.organizationId}::uuid,${s.guildId},gen_random_uuid(),md5(${s.guildId}||':'||n::text),'synthetic' FROM generate_series(1,${size}) n`.execute(db);
  await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context)
   SELECT ${s.organizationId}::uuid,${s.guildId},gen_random_uuid(),id,now()-interval '20 days','PRODUCTION' FROM member_identity_map WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`.execute(db);
 }finally{await sql`ALTER TABLE membership_episodes ENABLE TRIGGER ALL`.execute(db);}
 // Synthetic fixtures skip the ingestion trigger; only read-path latency is measured.
 await sql`ALTER TABLE lifecycle_events DISABLE TRIGGER ALL`.execute(db);
 try{await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data)
 SELECT e.organization_id,e.guild_id,gen_random_uuid(),e.id,event.kind,e.joined_at+event.offset_time,'PRODUCTION',
  jsonb_build_object('channelId',CASE WHEN event.kind='voice.started' THEN '933333333333333339' ELSE CASE e.n % 3 WHEN 0 THEN '933333333333333333' WHEN 1 THEN '933333333333333334' ELSE '933333333333333335' END END,'latencySeconds',600)
 FROM (SELECT episode.*,row_number() OVER(ORDER BY episode.id) AS n FROM membership_episodes episode WHERE episode.organization_id=${s.organizationId}::uuid AND episode.guild_id=${s.guildId}) e
 CROSS JOIN (VALUES('message.sent',interval '1 hour'),('reaction.added',interval '8 days'),('reply.received',interval '2 hours'),('voice.started',interval '3 hours')) event(kind,offset_time)
 WHERE event.kind NOT IN ('reply.received','voice.started') OR event.kind='reply.received' AND e.n % 4=0 OR event.kind='voice.started' AND e.n % 5=0`.execute(db);}finally{await sql`ALTER TABLE lifecycle_events ENABLE TRIGGER ALL`.execute(db);}
 await sql`WITH numbered AS (SELECT episode.*,row_number() OVER(ORDER BY episode.id) AS n FROM membership_episodes episode WHERE episode.organization_id=${s.organizationId}::uuid AND episode.guild_id=${s.guildId})
  INSERT INTO member_interaction_pairs(organization_id,guild_id,episode_id,peer_identity_id,first_at)
  SELECT a.organization_id,a.guild_id,a.id,b.identity_id,a.joined_at+interval '2 hours' FROM numbered a JOIN numbered b ON b.n=a.n+1 WHERE a.n % 10=0`.execute(db);
 await sql`INSERT INTO telemetry_cursor VALUES(${s.organizationId}::uuid,${s.guildId},now()-interval '21 days',now())`.execute(db);
 const key='synthetic-performance',api=createApi(new AnalyticsService(db,new SettingsService(db)),key,db),path=`/v3/organizations/${s.organizationId}/guilds/${s.guildId}/community?range=30`;
 const started=performance.now(),result=await api.inject({method:'GET',url:path,headers:{authorization:`Bearer ${apiToken(key,s)}`}}),duration=performance.now()-started;
 expect(result.statusCode).toBe(200);
 const body=result.json();expect(body.eligibleMembers).toBe(size);expect(body.channels.length).toBeGreaterThanOrEqual(3);expect(body.channels[0].newcomers).toBeGreaterThan(0);expect(body.compare).toBeDefined();
 if(size===50000){expect(body.adaptive.volume).toBe('HIGH_VOLUME');expect(body.adaptive.metrics.find((m:{key:string})=>m.key==='postResponse').sample).toBe(10000);expect(body.adaptive.metrics.find((m:{key:string})=>m.key==='pollParticipants').count).toBe(100000);}
 if(size===10000){tenThousandDuration=duration;expect(duration).toBeLessThan(7000);}else expect(duration).toBeLessThan(Math.max(18000,tenThousandDuration*3));
 process.stdout.write(`Community ${size}: ${Math.round(duration)} ms\n`);
 await api.close();
},120000);
