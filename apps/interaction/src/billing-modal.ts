import {componentCopy} from '../../../packages/discord-panels/src/i18n/components';
import {modalTextInput,nexusModal,type UiLocale} from '../../../packages/discord-panels/src/index.js';
export function promotionModal(customId: string, locale: UiLocale) {
  return nexusModal(customId,componentCopy(locale,'promotionCode'),[modalTextInput(componentCopy(locale,'code'),'promotionCode',{maxLength:128})]);
}
