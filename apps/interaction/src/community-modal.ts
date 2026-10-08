import {componentCopy} from '../../../packages/discord-panels/src/i18n/components';
import {
  ComponentType,
  TextInputStyle,
  type APIModalInteractionResponseCallbackData,
} from "discord-api-types/v10";
import {
  communityModes,
  channelPurposes,
  type CommunityModel,
} from "../../../packages/shared/src/community-model";
import {
  modeNames,
  purposeNames,
} from "../../../packages/shared/src/community-copy";
export function communityModal(
  customId: string,
  locale: string,
  profile: CommunityModel,
): APIModalInteractionResponseCallbackData {
  const ja = locale === "ja";
  return {
    custom_id: customId,
    title: componentCopy(locale==='ja'?'ja':'en','communityPurposesLabel'),
    components: [
      {
        type: ComponentType.Label,
        label: componentCopy(locale==='ja'?'ja':'en','communityPurposesMultiple'),
        component: {
          type: ComponentType.CheckboxGroup,
          custom_id: "modes",
          min_values: 1,
          max_values: 8,
          options: communityModes.map((m) => ({
            value: m,
            label: modeNames[m][ja ? 0 : 1],
            default: profile.modes.includes(m),
          })),
        },
      },
      {
        type: ComponentType.Label,
        label: componentCopy(locale==='ja'?'ja':'en','channelToMapOptional'),
        component: {
          type: ComponentType.ChannelSelect,
          custom_id: "channel",
          channel_types: [0, 2, 5, 13, 15, 16],
          min_values: 0,
          max_values: 1,
          required: false,
        },
      },
      {
        type: ComponentType.Label,
        label: componentCopy(locale==='ja'?'ja':'en','purposeOfTheSelectedChannel'),
        component: {
          type: ComponentType.RadioGroup,
          custom_id: "purpose",
          required: false,
          options: channelPurposes.map((p) => ({
            value: p,
            label: purposeNames[p][ja ? 0 : 1],
            default: p === "OTHER",
          })),
        },
      },
      {
        type: ComponentType.Label,
        label: componentCopy(locale==='ja'?'ja':'en','voiceCopresenceMinutes160'),
        component: {
          type: ComponentType.TextInput,
          style: TextInputStyle.Short,
          custom_id: "threshold",
          value: String(profile.voiceThresholdSeconds / 60),
          required: true,
          min_length: 1,
          max_length: 2,
        },
      },
    ],
  };
}
export type ModalField = {
  custom_id: string;
  value?: string;
  values?: string[];
  component?: ModalField;
  components?: ModalField[];
};
export function modalFields(components: ModalField[]): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (field: ModalField) => {
    if (field.component) visit(field.component);
    for (const child of field.components ?? []) visit(child);
    if (
      field.custom_id &&
      (field.value !== undefined || field.values !== undefined)
    )
      result[field.custom_id] = field.value ?? JSON.stringify(field.values);
  };
  for (const field of components) visit(field);
  return result;
}
