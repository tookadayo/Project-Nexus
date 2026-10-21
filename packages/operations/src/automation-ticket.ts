import {z} from 'zod';
import {sql,tenant,type Tx} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';
import {SettingsService,type Actor} from '../../settings/src/index';
import {analysisChannelScope} from '../../lifecycle/src/discovery';
import {operationsAccess} from './policy';

export const automationTicketStates=['OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED','RESOLVED','DISMISSED'] as const;
type Status={state:typeof automationTicketStates[number];version:number};
/** Minimal existing attention state only: never selects request fields, post
 * text, evidence, personal identity, title, or resolution contents. */
export async function readAutomationTicketStatus(tx:Tx,s:Scope,actor:Actor,id:string,readable:(channelId:string)=>Promise<boolean>,now=new Date()):Promise<{status:Status;allowedChannelIds:string[]}>{
  const entitlements=await operationsAccess(tx,s,actor,'READ'),settings=await new SettingsService(tx).get(s),cutoff=new Date(now.getTime()-Math.min(settings.detailedRetentionDays,entitlements.limits.historyDays??settings.detailedRetentionDays)*86400000);
  assert(/^(?:\d{17,20}|intake:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id),'AUTOMATION_TICKET_INVALID');
  let row:{status:string;version:number}|undefined;
  let allowedChannelIds:string[]=[];
  if(id.startsWith('intake:')){
    row=(await sql<{status:string;version:number}>`SELECT a.status,a.version FROM attention_items a JOIN operations_requests r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.attention_key=a.message_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.message_id=${id} AND a.item_type='OPERATIONS_REQUEST' AND a.detected_at>=${cutoff}`.execute(tx)).rows[0];
  }else{
    await operationsAccess(tx,s,actor,'READ','basic_attention');const scope=await analysisChannelScope(tx,s,settings);
    const item=(await sql<{channel_id:string}>`SELECT channel_id FROM attention_items WHERE ${tenant(s)} AND message_id=${id} AND item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE') AND detected_at>=${cutoff}`.execute(tx)).rows[0];
    assert(item&&scope.actualChannelIds.includes(item.channel_id)&&await readable(item.channel_id),'AUTOMATION_TICKET_NOT_AVAILABLE',404);
    allowedChannelIds=[item.channel_id];
    row=(await sql<{status:string;version:number}>`SELECT status,version FROM attention_items WHERE ${tenant(s)} AND message_id=${id} AND channel_id=${item.channel_id} AND item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE') AND detected_at>=${cutoff}`.execute(tx)).rows[0];
  }
  assert(row,'AUTOMATION_TICKET_NOT_AVAILABLE',404);
  const parsed=z.object({status:z.enum(automationTicketStates),version:z.number().int().nonnegative()}).parse(row);
  return {status:{state:parsed.status,version:parsed.version},allowedChannelIds};
}
