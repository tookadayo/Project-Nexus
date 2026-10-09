import {componentCopy} from '../i18n/components';
import {ButtonStyle} from 'discord-api-types/v10';
import {t,type UiLocale} from '../i18n/index.js';
import {failureCopy} from '../i18n/errors.js';
import {actionRow,callout,divider,nexusPanel,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
import type {UserFailure} from '../../../shared/src/error-types.js';
export type ErrorKind='revision'|'permission'|'entitlement'|'generic';
export type ErrorReturn={page?:'overview'|'newMembers'|'attention'|'analysis'|'settings'|'improve'|'results';retryRead?:boolean};
export async function errorPanel(issue:Issue,kind:ErrorKind|UserFailure='generic',locale:UiLocale='en',reference?:string,code?:string,context:ErrorReturn={}):Promise<Panel>{
 const legacy={revision:'REVISION_CONFLICT',permission:'PERMISSION',entitlement:'ENTITLEMENT',generic:'INTERNAL'} as const;
 const category=code==='CHANNEL_PERMISSION_MISSING'?'CHANNEL_PERMISSION':code==='COMPONENT_EXPIRED'||code==='PANEL_NOT_CONFIGURED'?'COMPONENT_EXPIRED':code==='EVENT_NOT_AVAILABLE'||code==='HELPER_CHANNEL_REQUIRED'||code==='INVALID_START_CHANNEL'?'VALIDATION':typeof kind==='string'?legacy[kind]:kind.category;
 const failure:UserFailure=typeof kind==='string'?{category,effect:'UNKNOWN',reference}:kind;
 const copy=failureCopy(locale==='en'?'en':'ja',failure),page=context.page??'overview',expired=category==='COMPONENT_EXPIRED';
 const read={action:'controlNavigate',data:{page}},back=expired?{action:'panel'}:read;
 const fix=category==='ANALYSIS_RESULT'?{action:'analysisHistory'}:category==='ANALYSIS_USAGE'?{action:'controlNavigate',data:{page:'analysis'}}:category==='CHANNEL_PERMISSION'?{action:'controlSettings',data:{section:'notifications'}}:category==='ENTITLEMENT'?{action:'billing'}:back;
 return nexusPanel({title:copy.title,subtitle:copy.detail,accent:'critical',children:[divider(),callout(componentCopy(locale,'operationResult'),copy.effect),...(failure.reference?[callout(t(locale,'error.ref'),`**${failure.reference}**`)]:[])],rows:[await actionRow(issue,[
  {label:expired||category==='ANALYSIS_RESULT'||category==='ANALYSIS_USAGE'||category==='CHANNEL_PERMISSION'||category==='ENTITLEMENT'?copy.action:context.retryRead?(componentCopy(locale,'retry')):(componentCopy(locale,'checkCurrentState')),...fix,style:ButtonStyle.Primary},
  {label:componentCopy(locale,'checkStatus'),action:'status'},
  {label:`${t(locale,`control.${page}`)}${componentCopy(locale,'back')}`,...back}
 ])]});
}
