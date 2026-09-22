import {z} from 'zod';
import {scopeForGuild} from '../../security/src/index.js';
import type {IdentityVault} from '../../identity/src/index.js';
const id=z.string().regex(/^\d{17,20}$/);
export const eventSchema=z.object({organizationId:z.uuid(),guildId:id,shardId:z.number().int(),gatewaySessionId:z.string().min(1),sequence:z.number().int(),
 kind:z.enum(['member.joined','member.left','member.roles_updated','message.sent','reaction.added','voice.started','voice.ended','scheduled_event.subscribed','scheduled_event.unsubscribed','telemetry.connected','telemetry.disconnected','telemetry.heartbeat','telemetry.gap']),
 at:z.iso.datetime(),context:z.literal('PRODUCTION'),encryptedUserId:z.string().optional(),joinedAt:z.iso.datetime().optional(),
 messageId:id.optional(),channelId:id.nullable().optional(),messageType:z.number().int().optional(),referenceId:id.optional(),roles:z.array(id).optional(),gapStart:z.iso.datetime().optional(),eventId:id.optional(),pending:z.boolean().optional()}).strict();
export type Envelope=z.infer<typeof eventSchema>;
export type Dispatch={t:string|null,s:number|null,d:unknown};
export function normalize(packet:Dispatch,shardId:number,sessionId:string,vault:IdentityVault,now=new Date()):Envelope|null {
 const raw=z.object({guild_id:id}).passthrough().safeParse(packet.d);if(!raw.success||packet.s===null)return null;
 const s=scopeForGuild(raw.data.guild_id);const base={...s,shardId,gatewaySessionId:sessionId,sequence:packet.s,context:'PRODUCTION' as const};
 if(packet.t==='GUILD_MEMBER_ADD'||packet.t==='GUILD_MEMBER_REMOVE'||packet.t==='GUILD_MEMBER_UPDATE'){
  const data=z.object({user:z.object({id,bot:z.boolean().optional()}),joined_at:z.string().optional(),roles:z.array(id).optional()}).safeParse(packet.d);
  if(!data.success||data.data.user.bot)return null;
  return eventSchema.parse({...base,kind:packet.t==='GUILD_MEMBER_ADD'?'member.joined':packet.t==='GUILD_MEMBER_REMOVE'?'member.left':'member.roles_updated',
   at:packet.t==='GUILD_MEMBER_ADD'?data.data.joined_at:now.toISOString(),joinedAt:data.data.joined_at,roles:data.data.roles,encryptedUserId:vault.seal(s,data.data.user.id)});
 }
 if(packet.t==='MESSAGE_CREATE'){
  const data=z.object({id,channel_id:id,author:z.object({id,bot:z.boolean().optional()}),timestamp:z.string(),type:z.number().int(),message_reference:z.object({message_id:id.optional()}).optional(),webhook_id:z.string().optional()}).safeParse(packet.d);
  if(!data.success||data.data.author.bot||data.data.webhook_id||![0,19].includes(data.data.type))return null;
  return eventSchema.parse({...base,kind:'message.sent',at:data.data.timestamp,encryptedUserId:vault.seal(s,data.data.author.id),messageId:data.data.id,channelId:data.data.channel_id,messageType:data.data.type,referenceId:data.data.message_reference?.message_id});
 }
 if(packet.t==='GUILD_SCHEDULED_EVENT_USER_ADD'||packet.t==='GUILD_SCHEDULED_EVENT_USER_REMOVE'){
  const data=z.object({user_id:id,guild_scheduled_event_id:id}).safeParse(packet.d);if(!data.success)return null;
  return eventSchema.parse({...base,kind:packet.t.endsWith('ADD')?'scheduled_event.subscribed':'scheduled_event.unsubscribed',at:now.toISOString(),encryptedUserId:vault.seal(s,data.data.user_id),eventId:data.data.guild_scheduled_event_id});
 }
 if(packet.t==='MESSAGE_REACTION_ADD'){
  const data=z.object({user_id:id,message_id:id,channel_id:id,member:z.object({user:z.object({bot:z.boolean().optional()}).optional()}).optional()}).safeParse(packet.d);if(!data.success||data.data.member?.user?.bot)return null;
  return eventSchema.parse({...base,kind:'reaction.added',at:now.toISOString(),encryptedUserId:vault.seal(s,data.data.user_id),messageId:data.data.message_id,channelId:data.data.channel_id});
 }
 if(packet.t==='VOICE_STATE_UPDATE'){
  const data=z.object({user_id:id,channel_id:id.nullable(),member:z.object({user:z.object({bot:z.boolean().optional()}).optional()}).optional()}).safeParse(packet.d);if(!data.success||data.data.member?.user?.bot)return null;
  return eventSchema.parse({...base,kind:data.data.channel_id?'voice.started':'voice.ended',at:now.toISOString(),encryptedUserId:vault.seal(s,data.data.user_id),channelId:data.data.channel_id});
 }
 return null;
}
export function dedupeKey(e:Envelope){return `${e.shardId}:${e.gatewaySessionId}:${e.sequence}:${e.kind}:${e.guildId}`;}
