import {describe,expect,it} from "vitest";
import {normalize,eventSchema,BOT_REPLY_REFERENCE_CONTRACT,MASS_MENTION_CONTRACT,SCHEDULED_EVENT_TIME_CONTRACT} from "../../packages/events/src/index";
import {IdentityVault} from "../../packages/identity/src/index";
import {botMessagePacket,metadataIds} from "../fixtures/alpha16-source-metadata";
import {withoutBotPostReference} from "../../packages/lifecycle/src/alpha16-reference-privacy";
const vault=new IdentityVault("aa".repeat(32),"bb".repeat(32)),now=new Date("2026-10-16T00:00:05Z");
const normal=(extra:Record<string,unknown>={})=>normalize(botMessagePacket(extra),0,"fixture",vault,now)!;
describe("alpha16 native metadata contracts (authored, not executed)",()=>{
 it("keeps a guarded direct Bot/Webhook reference without collecting identity or body",()=>{
  for(const extra of [{},{webhook_id:"fixture-webhook"}]){
   const e=normal({...extra,content:"PRIVATE_BODY",attachments:["PRIVATE_ATTACHMENT"],embeds:["PRIVATE_EMBED"]});
   expect(e).toMatchObject({kind:"channel.post_observed",referenceId:metadataIds.parent,referenceType:0,botReplyReferenceContract:BOT_REPLY_REFERENCE_CONTRACT});
   expect(e.encryptedUserId).toBeUndefined();expect(e.mentionHashes).toBeUndefined();
   const payload=JSON.stringify(e);for(const secret of [metadataIds.author,"PRIVATE_BODY","PRIVATE_ATTACHMENT","PRIVATE_EMBED","fixture-webhook"])expect(payload).not.toContain(secret);
  }
 });
 it("does not call forwarded/cross-guild/cross-channel references direct or certify a malformed Reply",()=>{
  for(const reference of [{message_id:metadataIds.parent,type:1},{message_id:metadataIds.parent,guild_id:"922268100000000001"},{message_id:metadataIds.parent,channel_id:"922268100000000002"}])expect(normal({message_reference:reference}).referenceId).toBeUndefined();
  expect(normal({message_reference:undefined}).botReplyReferenceContract).toBeUndefined();
  expect(normal({type:0,message_reference:undefined}).botReplyReferenceContract).toBe(BOT_REPLY_REFERENCE_CONTRACT);
 });
 it("preserves legacy queues as unstamped and rejects invented protocol versions",()=>{
  const e=normal(),legacy={...e};delete legacy.botReplyReferenceContract;
  expect(eventSchema.parse(legacy).botReplyReferenceContract).toBeUndefined();
  expect(eventSchema.safeParse({...e,botReplyReferenceContract:"ASSUMED"}).success).toBe(false);
 });
 it("removes only unverified Bot reference fields and preserves existing HUMAN reply behavior",()=>{
  const bot=normal({mention_everyone:true,mention_roles:[metadataIds.role]}),safe=withoutBotPostReference(bot);
  expect(safe.referenceId).toBeUndefined();expect(safe.referenceType).toBeUndefined();expect(safe.botReplyReferenceContract).toBeUndefined();
  expect(safe).toMatchObject({kind:bot.kind,messageId:bot.messageId,channelId:bot.channelId,authorKind:bot.authorKind,at:bot.at,mentionEveryone:true,roleMentionCount:1});
  const human={...bot,kind:"message.sent" as const,authorKind:undefined};expect(withoutBotPostReference(human)).toBe(human);expect(bot.referenceId).toBe(metadataIds.parent);
 });
 it("stores only confirmed mass mention counts and never supplies missing native zero",()=>{
  const e=normal({mention_everyone:true,mention_roles:[metadataIds.role,metadataIds.role]});
  expect(e).toMatchObject({mentionEveryone:true,roleMentionCount:1,massMentionContract:MASS_MENTION_CONTRACT});expect(JSON.stringify(e)).not.toContain(metadataIds.role);
  expect(normal({mention_everyone:false,mention_roles:[]})).toMatchObject({mentionEveryone:false,roleMentionCount:0,massMentionContract:MASS_MENTION_CONTRACT});
  for(const extra of [{},{mention_everyone:false},{mention_roles:[]}]){const unknown=normal(extra);expect(unknown.massMentionContract).toBeUndefined();expect(unknown.roleMentionCount).toBeUndefined();expect(unknown.mentionEveryone).toBeUndefined();}
  expect(normal({mention_everyone:"false",mention_roles:[]}).massMentionContract).toBeUndefined();
 });
 it("keeps scheduled UTC times separate from observed start and does not certify incomplete or reversed times",()=>{
  const raw={guild_id:metadataIds.guild,id:metadataIds.event,channel_id:metadataIds.channel,entity_type:2,status:1,scheduled_start_time:"2026-10-17T12:00:00+09:00",scheduled_end_time:null};
  const e=normalize({t:"GUILD_SCHEDULED_EVENT_CREATE",s:2,d:raw},0,"fixture",vault,now)!;
  expect(e).toMatchObject({scheduledStartAt:"2026-10-17T03:00:00.000Z",scheduledEndAt:null,scheduledMetadataObservedAt:now.toISOString(),eventScheduleContract:SCHEDULED_EVENT_TIME_CONTRACT});
  expect(e).not.toHaveProperty("activeSince");
  for(const extra of [{scheduled_end_time:undefined},{scheduled_end_time:"2026-10-16T00:00:00Z"}])expect(normalize({t:"GUILD_SCHEDULED_EVENT_UPDATE",s:3,d:{...raw,...extra}},0,"fixture",vault,now)?.eventScheduleContract).toBeUndefined();
 });
});
