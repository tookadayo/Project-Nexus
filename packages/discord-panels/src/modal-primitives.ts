import {
  ComponentType,
  TextInputStyle,
  type APILabelComponent,
  type APIComponentInLabel,
  type APIModalInteractionResponseCallbackData,
} from "discord-api-types/v10";

export function modalLabel(
  label: string,
  component: APIComponentInLabel,
  description?: string,
): APILabelComponent {
  if (!label.length || label.length > 45 || (description?.length ?? 0) > 100)
    throw new Error("DISCORD_MODAL_LABEL_LIMIT");
  return {
    type: ComponentType.Label,
    label,
    component,
    ...(description ? { description } : {}),
  };
}
export function modalTextInput(
  label: string,
  customId: string,
  options: {
    value?: string;
    paragraph?: boolean;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
  } = {},
) {
  return modalLabel(label, {
    type: ComponentType.TextInput,
    custom_id: customId,
    style: options.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short,
    required: options.required ?? true,
    value: options.value,
    min_length: options.minLength,
    max_length: options.maxLength,
  });
}
export function nexusModal(
  customId: string,
  title: string,
  components: APILabelComponent[],
): APIModalInteractionResponseCallbackData {
  if (
    !customId.length ||
    customId.length > 100 ||
    !title.length ||
    title.length > 45 ||
    !components.length ||
    components.length > 5
  )
    throw new Error("DISCORD_MODAL_LIMIT");
  return { custom_id: customId, title, components };
}
