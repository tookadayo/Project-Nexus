import type {APIModalInteractionResponseCallbackData} from 'discord-api-types/v10';
import {t,modalTextInput,nexusModal,type UiLocale} from '../../../packages/discord-panels/src/index.js';

export function notificationModal(id:string,locale:UiLocale,minutes:number,_legacyEnabled?:boolean):APIModalInteractionResponseCallbackData{
 return nexusModal(id,t(locale,'polish.editConditions'),[modalTextInput(t(locale,'control.afterMinutes'),'minutes',{value:String(minutes),minLength:1,maxLength:4})]);
}
