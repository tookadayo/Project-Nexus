import type {APIModalInteractionResponseCallbackData} from 'discord-api-types/v10';
import {t,type UiLocale} from '../../../packages/discord-panels/src/index.js';

export function notificationModal(id:string,locale:UiLocale,minutes:number,_legacyEnabled?:boolean):APIModalInteractionResponseCallbackData{
 return {title:t(locale,'polish.editConditions'),custom_id:id,components:[
  {type:1,components:[{type:4,style:1,custom_id:'minutes',label:t(locale,'control.afterMinutes'),value:String(minutes),required:true,min_length:1,max_length:4}]},

 ]};
}
