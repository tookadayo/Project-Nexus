import {interventionSchema,type InterventionDefinition} from '../../lifecycle/src/interventions.js';
import type {ActionTemplateKey,ActionTemplatePresentation} from './types.js';

type TemplateInput={channelId?:string;eventId?:string;recommendedChannelIds?:string[];safetyMode?:'suggest'|'approval'|'auto'};
const snowflake=(value:string|undefined,name:string)=>{if(!value)throw new Error(`${name.toUpperCase()}_REQUIRED`);return value;};
export const actionTemplates:ActionTemplatePresentation[]=[
 {key:'reply_rescue',when:'A newcomer has not received a reply',wait:'1 hour after their first message',if:'They are still not connected',then:'Alert the community team',safety:'Suggestion only; re-check eligibility before delivery',requires:['channelId']},
 {key:'welcome_helper',when:'A newcomer joins',wait:'24 hours',if:'They have not activated',then:'Alert a welcome helper',safety:'Suggestion only; weekly contact cap applies',requires:['channelId']},
 {key:'inactive_follow_up',when:'A newcomer joins',wait:'3 days',if:'They have not activated',then:'Send one follow-up message',safety:'DM opt-in and daily/weekly caps apply',requires:[]},
 {key:'channel_recommendation',when:'A newcomer joins',wait:'24 hours',if:'They have not activated',then:'Recommend relevant channels',safety:'Suggestion only; at most five channels',requires:['channelId','recommendedChannelIds']},
 {key:'event_recommendation',when:'A newcomer joins',wait:'24 hours',if:'They have not activated',then:'Recommend an upcoming event',safety:'Suggestion only; event must still be available',requires:['channelId','eventId']}
];
export function compileActionTemplate(key:ActionTemplateKey,input:TemplateInput):InterventionDefinition{
 const safetyMode=input.safetyMode??'suggest',channelId=input.channelId;
 const common={trigger:'member.joined' as const,cooldownSeconds:604800,safetyMode,frequencyCaps:{dmPerDay:1 as const,contactsPerWeek:3 as const},massRoleOperation:false};
 const definitions:Record<ActionTemplateKey,unknown>={
  reply_rescue:{...common,name:'Reply Rescue',trigger:'message.sent',delaySeconds:3600,conditions:[{op:'connection_state',connected:false}],actions:[{type:'staff_alert',channelId:snowflake(channelId,'channelId'),text:'A newcomer is still waiting for their first reply.'}]},
  welcome_helper:{...common,name:'Welcome Helper',delaySeconds:86400,conditions:[{op:'activation_state',activated:false}],actions:[{type:'staff_alert',channelId:snowflake(channelId,'channelId'),text:'A newcomer may need help finding their first value.'}]},
  inactive_follow_up:{...common,name:'Inactive Newcomer Follow-up',delaySeconds:259200,conditions:[{op:'activation_state',activated:false}],actions:[{type:'send_dm',text:'Need help finding your next step in the community? The team is here to help.'}]},
  channel_recommendation:{...common,name:'Channel Recommendation',delaySeconds:86400,conditions:[{op:'activation_state',activated:false}],actions:[{type:'recommend_channels',channelId:snowflake(channelId,'channelId'),channels:input.recommendedChannelIds??[]}]},
  event_recommendation:{...common,name:'Event Recommendation',delaySeconds:86400,conditions:[{op:'activation_state',activated:false}],actions:[{type:'recommend_event',channelId:snowflake(channelId,'channelId'),eventId:snowflake(input.eventId,'eventId')}]}
 };
 return interventionSchema.parse(definitions[key]);
}
