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
    title: ja ? "コミュニティの目的と用途" : "Community purposes",
    components: [
      {
        type: ComponentType.Label,
        label: ja ? "運営目的（複数選択）" : "Community purposes (multiple)",
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
        label: ja
          ? "用途を設定するチャンネル（任意）"
          : "Channel to map (optional)",
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
        label: ja
          ? "選んだチャンネルの用途"
          : "Purpose of the selected channel",
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
        label: ja
          ? "ボイス同席の基準（分、1〜60）"
          : "Voice co-presence (minutes, 1–60)",
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
