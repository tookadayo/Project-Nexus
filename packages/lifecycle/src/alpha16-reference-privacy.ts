import {z} from "zod";
import {MessageType,MessageReferenceType} from "discord-api-types/v10";
import {sql,tenant,privacyReadLock,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {SettingsService} from "../../settings/src/index";
import type {Envelope} from "../../events/src/index";

/** Counts/type/time survive; an unverified reply is never a known no-reply. */
export function withoutBotPostReference(event:Envelope):Envelope {
 if(event.kind!=="channel.post_observed"||!event.referenceId)return event;
 const safe={...event};delete safe.referenceId;delete safe.referenceType;delete safe.botReplyReferenceContract;
 return safe;
}

/** Called in the existing privacy-read transaction before ingress persistence
 * and again before projection. No actor/message correspondence is retained. */
export async function sanitizeBotPostReference(tx:Tx,s:Scope,event:Envelope):Promise<Envelope>{
 if(event.kind!=="channel.post_observed"||!event.referenceId)return event;
 assert(tx.isTransaction,"REFERENCE_PRIVACY_TRANSACTION_REQUIRED",500);
 assert(event.organizationId===s.organizationId&&event.guildId===s.guildId,"REFERENCE_SCOPE_MISMATCH",403);
 await privacyReadLock(tx,s);
 const stripped=()=>withoutBotPostReference(event);
 if(!["BOT","WEBHOOK"].includes(event.authorKind??"")||!event.channelId||event.messageId===event.referenceId||event.messageType!==MessageType.Reply||event.referenceType!==undefined&&event.referenceType!==MessageReferenceType.Default)return stripped();
 const settings=await new SettingsService(tx).get(s,tx),clock=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now,
  cutoff=new Date(clock.getTime()-settings.detailedRetentionDays*86400000),replyAt=new Date(event.at);
 if(!Number.isFinite(replyAt.getTime())||replyAt>clock)return stripped();
 const source=(await sql<{present:boolean;allowed:boolean}>`SELECT
  EXISTS(SELECT 1 FROM location_post_observations p WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.message_id=${event.referenceId}) AS present,
  EXISTS(SELECT 1 FROM location_post_observations p WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.message_id=${event.referenceId} AND p.channel_id=${event.channelId}
   AND p.sent_at>${cutoff} AND p.sent_at<=${replyAt} AND (p.author_kind IN ('BOT','WEBHOOK') OR p.author_kind='HUMAN' AND p.subject_hash IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=p.organization_id AND d.guild_id=p.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=p.subject_hash))) AS allowed`.execute(tx)).rows[0]!;
 if(source.present)return source.allowed?event:stripped();
 // Only minimal typed metadata of a not-yet-projected original is selected.
 // A projected-but-missing source cannot be recovered from an old ingress copy.
 const originals=(await sql<{kind:string;author_kind:string|null;at:string|null;subject_hash:string|null;deleted:boolean}>`SELECT i.payload->>'kind' AS kind,i.payload->>'authorKind' AS author_kind,i.payload->>'at' AS at,i.subject_hash,
  EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=i.organization_id AND d.guild_id=i.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.subject_hash)) AS deleted
  FROM gateway_ingest i WHERE i.organization_id=${s.organizationId}::uuid AND i.guild_id=${s.guildId} AND i.projected_at IS NULL
  AND i.received_at>${cutoff} AND i.received_at<=${clock} AND i.payload->>'messageId'=${event.referenceId} AND i.payload->>'channelId'=${event.channelId}
  AND i.payload->>'kind' IN ('message.sent','channel.post_observed') ORDER BY i.received_at,i.dedupe_key LIMIT 2`.execute(tx)).rows;
 if(originals.length!==1)return stripped();
 const original=originals[0]!,parsed=z.iso.datetime().safeParse(original.at),originalAt=parsed.success?new Date(parsed.data):null;
 if(original.deleted||!originalAt||originalAt<=cutoff||originalAt>replyAt||originalAt>clock)return stripped();
 const known=original.kind==="message.sent"?original.subject_hash!==null:["BOT","WEBHOOK"].includes(original.author_kind??"");
 return known?event:stripped();
}

function ownedPosts(s:Scope,actorHash:string){return sql`SELECT message_id,channel_id,sent_at,reference_id FROM location_post_observations WHERE ${tenant(s)} AND subject_hash=${actorHash}
 UNION SELECT payload->>'messageId',payload->>'channelId',NULL::timestamptz,NULL::text FROM gateway_ingest WHERE ${tenant(s)} AND subject_hash=${actorHash} AND projected_at IS NULL AND payload->>'kind'='message.sent' AND payload->>'messageId' IS NOT NULL AND payload->>'channelId' IS NOT NULL`;}
function affectedQuestions(s:Scope,actorHash:string){return sql`SELECT q.message_id,q.channel_id FROM location_post_observations q WHERE q.organization_id=${s.organizationId}::uuid AND q.guild_id=${s.guildId} AND q.subject_hash IS DISTINCT FROM ${actorHash}
 AND EXISTS(SELECT 1 FROM owned r WHERE r.channel_id=q.channel_id AND r.sent_at>=q.sent_at AND (r.reference_id=q.message_id OR q.message_id=q.channel_id))`;}

/** Parent PrivacyService calls this under its canonical scope + exclusive
 * privacy fence, before it removes this actor's native source rows. */
export async function scrubStoredPostReferences(tx:Tx,s:Scope,actorHash:string):Promise<void>{
 assert(tx.isTransaction,"REFERENCE_PRIVACY_TRANSACTION_REQUIRED",500);
 assert(/^[a-f\d]{64}$/.test(actorHash),"REFERENCE_ACTOR_HASH_INVALID",400);
 // Remove only the derived clock. Existing anonymous response Boolean flags
 // retain their original native meaning; new consumers use the quality bit.
 // The 033 trigger/rebuild can therefore never restore the erased latency.
 await sql`WITH owned AS (${ownedPosts(s,actorHash)}),affected AS (${affectedQuestions(s,actorHash)})
  UPDATE lifecycle_events f SET data=f.data-'firstReplyLatencySeconds' WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='message.sent'
  AND EXISTS(SELECT 1 FROM affected q WHERE q.message_id=f.data->>'messageId' AND q.channel_id=f.data->>'channelId')`.execute(tx);
 await sql`WITH owned AS (${ownedPosts(s,actorHash)}),affected AS (${affectedQuestions(s,actorHash)})
  UPDATE message_observations m SET first_reply_seconds=NULL WHERE m.organization_id=${s.organizationId}::uuid AND m.guild_id=${s.guildId}
  AND EXISTS(SELECT 1 FROM affected q WHERE q.message_id=m.message_id AND q.channel_id=m.channel_id)`.execute(tx);
 await sql`WITH owned AS (${ownedPosts(s,actorHash)}),affected AS (${affectedQuestions(s,actorHash)})
  UPDATE location_post_observations p SET first_reply_seconds=NULL,reply_source=NULL,reply_provenance_erased=true WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId}
  AND EXISTS(SELECT 1 FROM affected q WHERE q.message_id=p.message_id AND q.channel_id=p.channel_id)`.execute(tx);
 await sql`WITH owned AS (${ownedPosts(s,actorHash)}) UPDATE location_post_observations p SET reference_id=NULL,reference_contract_version=NULL,reply_provenance_erased=true
  WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.reference_id IN (SELECT message_id FROM owned)`.execute(tx);
 // Bot identity is deliberately unavailable, so erase every queued Bot post
 // reference in this scope rather than guess which one relates to this actor.
 await sql`DELETE FROM gateway_ingest WHERE ${tenant(s)} AND payload->>'kind'='channel.post_observed' AND payload->>'referenceId' IS NOT NULL`.execute(tx);
 await sql`UPDATE location_population_collection SET bot_reference_started_at=NULL,bot_reference_observed_at=NULL WHERE ${tenant(s)}`.execute(tx);
}
