import {z} from 'zod';
const id=z.string().regex(/^\d{17,20}$/);
const empty=z.object({}).strict();
const flow=z.object({flowVersionId:z.uuid(),nodeId:z.string().optional(),optionId:z.string().optional()}).strict();
const message=z.object({messageId:id,channelId:id,messageType:z.number().int(),receivedExplicitReply:z.boolean().optional(),firstReplyLatencySeconds:z.number().nonnegative().optional()}).strict();
type Definition={schema:z.ZodType,source:'gateway'|'rest'|'interaction'|'projector',requiredIntent:string|null,retentionCategory:'detailed',metricEligible:boolean,active:boolean};
const def=(schema:z.ZodType,source:Definition['source'],requiredIntent:string|null,active=false):Definition=>({schema,source,requiredIntent,retentionCategory:'detailed',metricEligible:true,active});
export const signalRegistry={
 'member.joined':def(empty,'gateway','GuildMembers'),
 'member.rejoined':def(empty,'gateway','GuildMembers'),
 'member.left':def(empty,'gateway','GuildMembers'),
 'screening.passed':def(empty,'rest',null),
 'native_onboarding.observed_started':def(empty,'rest',null),
 'native_onboarding.observed_completed':def(empty,'rest',null),
 'home_actions.observed_started':def(empty,'rest',null),
 'home_actions.observed_completed':def(empty,'rest',null),
 'fallback.started':def(flow,'interaction',null),
 'fallback.completed':def(flow,'interaction',null),
 'fallback.answer':def(flow,'interaction',null,true),
 'interaction.used':def(z.object({action:z.string().max(100)}).strict(),'interaction',null,true),
 'message.sent':def(message,'gateway','GuildMessages',true),
 'reply.received':def(z.object({latencySeconds:z.number().nonnegative(),channelId:z.string().regex(/^\d{17,20}$/).optional()}).strict(),'projector','GuildMessages'),
 'reply.established':def(empty,'projector','GuildMessages'),
 'reaction.added':def(z.object({messageId:id,channelId:id}).strict(),'gateway','GuildMessageReactions',true),
 'voice.started':def(z.object({channelId:id}).strict(),'gateway','GuildVoiceStates'),
 'voice.ended':def(z.object({channelId:id.nullable()}).strict(),'gateway','GuildVoiceStates'),
 'voice.duration':def(z.object({channelId:id,seconds:z.number().nonnegative()}).strict(),'projector','GuildVoiceStates',true),
 'voice.connected':def(z.object({channelId:id}).strict(),'projector','GuildVoiceStates'),
 'scheduled_event.subscribed':def(z.object({eventId:id}).strict(),'gateway','GuildScheduledEvents',true),
 'scheduled_event.unsubscribed':def(z.object({eventId:id}).strict(),'gateway','GuildScheduledEvents'),
 'role.added':def(z.object({roleId:id}).strict(),'gateway','GuildMembers'),
 'role.removed':def(z.object({roleId:id}).strict(),'gateway','GuildMembers'),
 'activation.completed':def(z.object({definitionId:z.uuid().optional(),definitionVersion:z.number().int().optional()}).strict(),'projector',null)
} as const;
export type NexusSignal=keyof typeof signalRegistry;
export const signalSchema=z.enum(Object.keys(signalRegistry) as [NexusSignal,...NexusSignal[]]);
const aliases:Record<string,NexusSignal>={'nexus_onboarding.started':'fallback.started','nexus_onboarding.completed':'fallback.completed','nexus_onboarding.answered':'fallback.answer'};
export function canonicalSignal(kind:string):NexusSignal|undefined{return aliases[kind]??(kind in signalRegistry?kind as NexusSignal:undefined);}
export function validateSignal(kind:string,data:unknown){const key=canonicalSignal(kind);if(!key)throw new Error('UNKNOWN_SIGNAL');return signalRegistry[key].schema.parse(data);}
