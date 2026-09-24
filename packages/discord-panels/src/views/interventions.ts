import {ButtonStyle,ComponentType,type APIChannelSelectComponent,type APIStringSelectComponent} from 'discord-api-types/v10';
import {shortId} from '../formatting.js';
import type {UiLocale} from '../i18n/index.js';
import {actionRow,callout,divider,nexusPanel,type ActionRow,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
export type InterventionRunView={id:string;state:string};
export async function interventionsPanel(issue:Issue,runs:InterventionRunView[],locale:UiLocale='en'):Promise<Panel>{
 const ja=locale!=='en',label=(en:string,jp:string)=>ja?jp:en,pending=runs.filter(run=>run.state==='suggested'||run.state==='approval'),rows:ActionRow[]=[];
 if(pending.length)rows.push({type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:'interventionApprove'}),placeholder:label('Choose a notification to approve','確認する通知を選ぶ'),options:pending.slice(0,25).map(run=>({label:label('Waiting for confirmation','確認待ち')+` · ${shortId(run.id)}`,value:run.id}))} satisfies APIStringSelectComponent]});
 rows.push({type:ComponentType.ActionRow,components:[{type:ComponentType.ChannelSelect,custom_id:await issue({action:'interventionDraft'}),placeholder:label('Notify your team in a channel','チームに通知するチャンネルを選ぶ'),channel_types:[0],min_values:1,max_values:1} satisfies APIChannelSelectComponent]});
 rows.push(await actionRow(issue,[{label:label('Results','結果'),action:'experiments'},{label:label('Back to Improve','改善に戻る'),action:'improve'}]));
 const recent=runs.length?`${label('Recent notifications','最近の通知')}: ${runs.length}`:label('No notifications yet.','通知はまだありません。');
 return nexusPanel({title:label('Help newcomers waiting for a reply','返信を待つ新規メンバーを支援'),subtitle:label('Choose where NEXUS should notify your team','通知先を選ぶ'),children:[divider(),callout(label('Recommended settings','推奨設定'),label('Wait 1 hour after a first message. Notify staff only if no reply arrives. Confirm before sending. At most once every 7 days per newcomer.','最初のメッセージから1時間待ち、返信がなければスタッフに通知します。送信前に確認します。新規メンバーごとに7日間で最大1回です。')),callout(label('Activity','活動'),recent)],rows});
}
export async function interventionPreviewPanel(issue:Issue,publishData:Record<string,unknown>,locale:UiLocale='en'):Promise<Panel>{
 const ja=locale!=='en',label=(en:string,jp:string)=>ja?jp:en;
 return nexusPanel({title:label('Notify staff when someone has no reply','返信がない人をスタッフに知らせる'),subtitle:label('NEXUS will confirm before sending','送信前に確認します'),children:[divider(),callout(label('What happens','実行内容'),label('Newcomer sends a message → wait 1 hour → still no reply → staff reviews → NEXUS notifies the selected channel.','新規メンバーが投稿 → 1時間待つ → 返信がない → スタッフが確認 → 選択したチャンネルに通知。')),callout(label('Safety','安全設定'),label('The need for help and contact limits are checked again before sending.','送信前に支援の必要性と連絡上限を再確認します。'))],rows:[await actionRow(issue,[{label:label('Enable','有効にする'),action:'configPublish',data:publishData,style:ButtonStyle.Primary},{label:label('Back','戻る'),action:'interventions'}])]});
}
