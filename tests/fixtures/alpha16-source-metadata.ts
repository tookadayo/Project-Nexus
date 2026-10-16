import type {Dispatch,Envelope} from "../../packages/events/src/index";
import {BOT_REPLY_REFERENCE_CONTRACT} from "../../packages/events/src/index";
import type {Scope} from "../../packages/shared/src/index";

export const metadataIds={guild:"911168100000000001",channel:"911168100000000002",message:"911168100000000003",parent:"911168100000000004",author:"911168100000000005",role:"911168100000000006",event:"911168100000000007"} as const;
export function botMessagePacket(extra:Record<string,unknown>={}):Dispatch{
 return {t:"MESSAGE_CREATE",s:1,d:{guild_id:metadataIds.guild,id:metadataIds.message,channel_id:metadataIds.channel,author:{id:metadataIds.author,bot:true},type:19,timestamp:"2026-10-16T00:00:00.000Z",message_reference:{message_id:metadataIds.parent,channel_id:metadataIds.channel,guild_id:metadataIds.guild,type:0},...extra}};
}
export function protocolHealth(s:Scope,at:Date,sequence:number,extra:Partial<Envelope>={}):Envelope{
 return {...s,shardId:0,gatewaySessionId:"fixture-protocol",sequence,context:"PRODUCTION",kind:"telemetry.heartbeat",at:at.toISOString(),requestedIntents:["members","messages","reactions","polls","voice","scheduledEvents","autoMod"],botReplyReferenceContract:BOT_REPLY_REFERENCE_CONTRACT,...extra};
}
