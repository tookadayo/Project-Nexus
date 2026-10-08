import { communityModelSchema, type CommunityModel } from "../../packages/shared/src/community-model";
import type { AnalysisScope } from "../../packages/shared/src/channel-scope";
import { buildCapabilitySnapshot, type DiscoverySource } from "../../packages/discord/src/discovery";
import { representativeUi } from "./community-profiles";
export type StabilizationServer = { id:string;label:string; source:DiscoverySource;model:CommunityModel;scope:AnalysisScope;expectations:{basic:string[];detailed:string[];attention:string[];excludedAttention:string[];ui:string[]};changes?:string[] };
const channelId = (server:number,index:number) => String(800000000000000000n+BigInt(server*10000+index));
function server(index:number,label:string,types:number[],purposes:CommunityModel["channels"][number]["purpose"][]):StabilizationServer {
  const channels=types.map((type,i)=>({id:channelId(index,i),type,parentId:type!==4 && types.includes(4)?channelId(index,types.indexOf(4)):null,observable:true,tagIds:type===15?[channelId(index,900)]:[],name:i%3===0?"🌙":i%3===1?"同じ名前":"Very long fictitious channel name ".repeat(3)}));
  return {id:`S${index}`,label,source:{channelCensus:"FULL",features:[],memberCount:30,afkChannelId:null,incidents:{},channels,threads:[],onboarding:null,endpointStatus:{channels:"AVAILABLE",threads:"AVAILABLE",events:"AVAILABLE",onboarding:"UNAVAILABLE"},ruleCount:null,welcomeCount:null,scheduledEvents:[]},model:communityModelSchema.parse({modes:[],confirmed:true,channels:channels.flatMap((c,i)=>purposes[i]?[{channelId:c.id,purpose:purposes[i]}]:[])}),scope:{mode:"include",channelIds:channels.filter(c=>c.type!==4).map(c=>c.id)},expectations:{basic:["observed_posts","observed_replies"],detailed:["OVERALL"],attention:purposes.filter(p=>["SUPPORT","BUG_REPORT","LFG"].includes(p)),excludedAttention:purposes.filter(p=>!["SUPPORT","BUG_REPORT","LFG"].includes(p)),ui:["confirmed purpose by ID","explicit collection limits"]}};
}
const s1=server(1,"Small social / no category",[0,2],["GENERAL_CONVERSATION","OTHER"]);
const s2=server(2,"Official mixed community",[4,0,0,5,0,15,15],["OTHER","ONBOARDING","ONBOARDING","ANNOUNCEMENT","GENERAL_CONVERSATION","SUPPORT","SHOWCASE"]);
const s3=server(3,"Creator and reference posts",[4,15,15],["OTHER","SHOWCASE","SHOWCASE"]);
s3.expectations.excludedAttention.push("zero comments","pinned guide","unchanged reference post");
const s4=server(4,"Support and bug reports",[4,15,15,0],["OTHER","SUPPORT","BUG_REPORT","SUPPORT"]);
s4.model.forumTags=[{channelId:s4.source.channels[1]!.id,tagId:channelId(4,900),meaning:"RESOLVED"}];
s4.expectations.excludedAttention.push("archived is not resolved","locked is not resolved");
const s5=server(5,"Voice, recruitment and AFK",[4,2,2,2,0],["OTHER","OTHER","OTHER","OTHER","LFG"]);
s5.source.afkChannelId=s5.source.channels[3]!.id;s5.expectations.basic.push("voiceParticipants","voiceCopresence");s5.expectations.ui.push("co-presence is not conversation","AFK excluded from social voice");
const s6=server(6,"Event and Stage",[13,2],["OTHER","OTHER"]);
s6.source.scheduledEvents=[{id:channelId(6,901),channelId:s6.source.channels[0]!.id,entityType:1,status:2},{id:channelId(6,902),channelId:null,entityType:3,status:2},{id:channelId(6,903),channelId:s6.source.channels[1]!.id,entityType:2,status:1}];s6.expectations.basic.push("eventSubscriptions","eventAttendance");s6.expectations.ui.push("external attendance unknown","signup distinct from attendance","partially observed participation");
const s7=server(7,"Hundreds of mixed channels",Array.from({length:330},(_,i)=>i%30===0?4:i%7===0?15:i%5===0?2:0),Array.from({length:330},(_,i)=>i%7===0?"SHOWCASE":i%11===0?"SUPPORT":"GENERAL_CONVERSATION"));
for(let i=0;i<s7.source.channels.length;i++){const c=s7.source.channels[i]!;c.parentId=c.type===4?null:s7.source.channels[Math.floor(i/30)*30]!.id;if(i%23===1)c.observable=false;}
s7.source.threads=[{id:channelId(7,800),parentId:s7.source.channels[1]!.id,type:12,ownerHash:null,archived:false,locked:false,createdAt:null,tagIds:[]}];s7.expectations.ui.push("permission missing","private thread excluded","names never determine purpose");
const s8=server(8,"Changing server",[4,0,15],["OTHER","GENERAL_CONVERSATION","SUPPORT"]);
s8.changes=["name changes retain IDs","category move retains explicit purpose","new channel requires selection","tag rename retains mapping","tag deletion does not remap same name","permission loss","owner change does not transfer billing","Bot gap and reconnect"];
export const stabilizationServers=[s1,s2,s3,s4,s5,s6,s7,s8];
export function stabilizationUi(index:number){const f=stabilizationServers[index]!,ui=representativeUi(0),snapshot=buildCapabilitySnapshot(f.source,new Date("2026-10-08T00:00:00Z"));return {...ui,profile:f.model,capabilities:snapshot,coverage:{...snapshot.coverage,partial:snapshot.coverage.ratio!==1},metrics:ui.metrics.filter(m=>!f.expectations.excludedAttention.includes(m.purpose??"")),caveats:["Fictitious fixture; no live user content.",...f.expectations.ui]};}
