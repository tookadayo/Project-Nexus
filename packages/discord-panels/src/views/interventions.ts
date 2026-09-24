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
 return nexusPanel({title:label('Enable Reply Rescue','返信レスキューを有効にする'),subtitle:label('NEXUS will confirm before sending','送信前に確認します'),children:[divider(),callout(label('What happens','実行内容'),label('If a newcomer waits 1 hour without a reply, NEXUS asks your team to review a notification in the selected channel.','新規メンバーが1時間返信を待つと、選択したチャンネルへの通知をチームに確認してもらいます。')),callout(label('Safety','安全設定'),label('Eligibility and contact limits are checked again before delivery.','配信前に対象条件と連絡上限を再確認します。'))],rows:[await actionRow(issue,[{label:label('Enable','有効にする'),action:'configPublish',data:publishData,style:ButtonStyle.Primary},{label:label('Back','戻る'),action:'interventions'}])]});
}
