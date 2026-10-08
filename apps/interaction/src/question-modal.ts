import {
  modalTextInput,
  nexusModal,
  t,
  type UiLocale,
} from "../../../packages/discord-panels/src/index.js";
export function questionModal(
  customId: string,
  locale: UiLocale,
  intent: Record<string, unknown>,
) {
  return nexusModal(customId, t(locale, "modal.title").slice(0, 45), [
    modalTextInput(t(locale, "modal.question").slice(0, 45), "question", {
      value: String(intent.question),
      maxLength: 500,
    }),
    modalTextInput(t(locale, "modal.options").slice(0, 45), "options", {
      value: String(intent.options),
      paragraph: true,
      maxLength: 2000,
    }),
  ]);
}
