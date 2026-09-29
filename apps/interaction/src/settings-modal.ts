import type {APIModalInteractionResponseCallbackData} from 'discord-api-types/v10';
import {t,type UiLocale} from '../../../packages/discord-panels/src/index.js';

export function notificationModal(id:string,locale:UiLocale,minutes:number,enabled:boolean):APIModalInteractionResponseCallbackData{
 return {title:t(locale,'polish.editConditions'),custom_id:id,components:[
  {type:1,components:[{type:4,style:1,custom_id:'minutes',label:t(locale,'control.afterMinutes'),value:String(minutes),required:true,min_length:1,max_length:4}]},
  {type:1,components:[{type:4,style:1,custom_id:'enabled',label:locale==='ja'?'返信待ち通知（ON / OFF）':'Reply alerts (ON / OFF)',value:enabled?'ON':'OFF',required:true,min_length:2,max_length:3}]}
 ]};
}
