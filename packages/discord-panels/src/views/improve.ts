import {ButtonStyle} from 'discord-api-types/v10';
import {formatPercentage} from '../formatting.js';
import {actionRow,callout,divider,nexusPanel,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
import type {UiLocale} from '../i18n/index.js';
import type {Opportunity} from '../../../presentation/src/types.js';
import {diagnosisLabel} from '../status.js';

export async function improvePanel(issue:Issue,opportunity:Opportunity|null,locale:UiLocale='en'):Promise<Panel>{
 const ja=locale!=='en',label=(en:string,jp:string)=>ja?jp:en;
 const children=[divider()];
 if(opportunity){
  children.push(callout(label('Needs attention','今見るべきこと'),diagnosisLabel(opportunity.type,locale)));
  children.push(callout(label('What we observed','観測したこと'),`${label('Current','現在')}: ${formatPercentage(opportunity.current,0,locale)}\n${label('Previous comparable period','比較できる前期間')}: ${formatPercentage(opportunity.previous,0,locale)}\n${label('Newcomers evaluated','評価した新規メンバー')}: ${opportunity.sampleSize}\n${label('This is an observed change, not proof of cause.','観測された変化であり、原因を証明するものではありません。')}`));
 }else children.push(callout(label('No suggested improvement needs attention yet','今すぐ対応が必要な改善候補はありません'),label('You can still enable a recommended improvement below.','下の推奨改善策は有効にできます。')));
 children.push(callout(label('Suggested improvement','提案する改善策'),label('Help newcomers waiting for a reply. After 1 hour without a reply, notify your community team. Confirm before sending.','返信を待つ新規メンバーを支援します。1時間返信がなければチームに通知します。送信前に確認します。')));
 return nexusPanel({title:label('NEXUS · Improve','NEXUS · 改善'),subtitle:label('Understand what needs attention and enable an improvement','今見るべきことと改善策'),accent:opportunity?'warning':'nexus',children,rows:[await actionRow(issue,[{label:label('Improve this','改善する'),action:'interventions',style:ButtonStyle.Primary},{label:label('Results','結果'),action:'experiments'}])]});
}
