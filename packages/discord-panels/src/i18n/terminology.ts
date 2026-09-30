import type {Measurement} from '../../../presentation/src/measurement';
import {t,type UiLocale} from './index';
export function connectionStateLabel(locale:'ja'|'en',state:'VERIFIED'|'INSTALLED_NOT_VERIFIED'|'VERIFICATION_PENDING'|'NOT_INSTALLED'){
 const labels={VERIFIED:['接続済み','Connected'],INSTALLED_NOT_VERIFIED:['NEXUS導入済み・Web未接続','NEXUS installed · Web not connected'],VERIFICATION_PENDING:['接続コード発行済み','Connection code issued'],NOT_INSTALLED:['NEXUS未導入','NEXUS not installed']};
 return labels[state][locale==='ja'?0:1]!;
}
export function measurementLabel(metric:Measurement|undefined,locale:UiLocale,minutes=false){
 if(!metric)return t(locale,'polish.unavailable');
 if(metric.value!==null)return minutes?t(locale,'control.minutes',{count:metric.value}):`${metric.value}%`;
 if(metric.state==='UNAVAILABLE')return t(locale,'polish.unavailable');
 if(metric.state==='NO_ELIGIBLE_MEMBERS')return t(locale,'polish.noMembers');
 if(minutes&&metric.state==='INSUFFICIENT_SAMPLE'&&metric.sample===0)return t(locale,'polish.noReplies');
 if(metric.state==='INSUFFICIENT_SAMPLE')return minutes?(locale==='en'?`Need ${metric.needed} more members with replies`:`返信を受けた対象者があと${metric.needed}人必要です`):t(locale,'polish.moreSample',{count:metric.needed});
 return t(locale,'experience.pending');
}
export const activityWindow=(locale:'ja'|'en',from=7,through=14)=>locale==='ja'?`参加後${from}〜${through}日目の活動`:`Activity ${from}–${through} days after joining`;
export const replyDenominator=(locale:'ja'|'en',metric:Measurement)=>locale==='ja'?`返信あり ${metric.responded} / ${metric.eligible}人 · 参加後${metric.observationDays}日間の観測を完了`:`Replied ${metric.responded} / ${metric.eligible} members · ${metric.observationDays}-day observation complete`;
