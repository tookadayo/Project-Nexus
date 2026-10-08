import {
  ButtonStyle,
  ComponentType,
  type APIStringSelectComponent,
} from "discord-api-types/v10";
import { nexusPanel, callout, actionRow, type ActionRow } from "../primitives";
import { analysisCopy as c } from "../i18n/analysis";
import { t, type UiLocale } from "../i18n";
import type { Issue } from "../types";
import type { SetupDraft } from "../../../operations/src/setup-wizard";
export async function setupWizardPanel(
  issue: Issue,
  state: SetupDraft,
  locale: UiLocale,
) {
  const { draft, step } = state,
    base = { draftId: state.id, version: state.version },
    rows: ActionRow[] = [],
    titles = ["scope", "notifications", "team", "goals"] as const;
  const children = [
    callout(
      step < 4
        ? `${step + 1} / 4 · ${c(locale, titles[step]!)}`
        : c(locale, "review"),
      step < 4 ? c(locale, "review") : "",
    ),
  ];
  const issueField = (field: string) =>
    issue({ action: "setupWizardChange", ...base, field });
  if (step === 0) {
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: await issueField("mode"),
          placeholder: c(locale, "scope"),
          options: ["all", "include", "exclude"].map((mode) => ({
            label: c(locale, mode as "all"),
            value: mode,
            default: draft.analysisScope.mode === mode,
          })),
        } satisfies APIStringSelectComponent,
      ],
    });
    if (draft.analysisScope.mode !== "all")
      rows.push({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.ChannelSelect,
            custom_id: await issueField("channels"),
            channel_types: [0, 5, 15, 16],
            min_values: 1,
            max_values: 25,
            placeholder: c(locale, "chooseChannels"),
          },
        ],
      });
  }
  if (step === 1)
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.ChannelSelect,
          custom_id: await issueField("notifications"),
          channel_types: [0],
          min_values: 1,
          max_values: 1,
          placeholder: c(locale, "notifications"),
        },
      ],
    });
  if (step === 2)
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.RoleSelect,
          custom_id: await issueField("team"),
          min_values: 0,
          max_values: 20,
          placeholder: c(locale, "chooseRoles"),
        },
      ],
    });
  if (step === 3)
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: await issueField("goals"),
          min_values: 0,
          max_values: 7,
          placeholder: c(locale, "chooseGoals"),
          options: [
            "reply",
            "lfg",
            "voice",
            "event",
            "feedback",
            "bug",
            "playtest",
          ].map((value) => ({
            label: t(
              locale,
              `control.goal${value[0]!.toUpperCase() + value.slice(1)}` as "control.goalReply",
            ),
            value,
            default: draft.newMemberGoals.includes(value as "reply"),
          })),
        },
      ],
    });
  if (step === 4) {
    children.push(
      callout(
        c(locale, "scope"),
        c(locale, draft.analysisScope.mode) +
          (draft.analysisScope.channelIds.length
            ? "\n" +
              c(locale, "placesCount", {
                count: draft.analysisScope.channelIds.length,
              }) +
              "\n" +
              draft.analysisScope.channelIds
                .slice(0, 5)
                .map((id) => `<#${id}>`)
                .join("\n") +
              (draft.analysisScope.channelIds.length > 5
                ? "\n" +
                  c(locale, "additionalPlaces", {
                    count: draft.analysisScope.channelIds.length - 5,
                  })
                : "")
            : ""),
      ),
      callout(
        c(locale, "notifications"),
        `${t(locale, draft.helperEnabled ? "control.on" : "control.off")}\n${draft.helperChannelId ? `<#${draft.helperChannelId}>` : c(locale, "notConfigured")}`,
      ),
      callout(
        c(locale, "team"),
        draft.managerRoleIds.map((id) => `<@&${id}>`).join("\n") ||
          c(locale, "notConfigured"),
      ),
      callout(
        c(locale, "goals"),
        draft.newMemberGoals
          .map((value) =>
            t(
              locale,
              `control.goal${value[0]!.toUpperCase() + value.slice(1)}` as "control.goalReply",
            ),
          )
          .join("\n") || c(locale, "notConfigured"),
      ),
    );
    for (const skipped of draft.skipped)
      children.push(callout(c(locale, skipped), c(locale, "skipped")));
  }
  rows.push(
    await actionRow(issue, [
      {
        label: c(locale, step === 4 ? "confirm" : "next"),
        action: step === 4 ? "setupWizardConfirm" : "setupWizardNext",
        data: base,
        style: ButtonStyle.Primary,
      },
      ...(step > 0
        ? [{ label: c(locale, "back"), action: "setupWizardBack", data: base }]
        : []),
      ...(step > 0 && step < 4
        ? [
            {
              label: c(locale, "skip"),
              action: "setupWizardNext",
              data: { ...base, skip: true },
            },
          ]
        : []),
    ]),
  );
  return nexusPanel({ title: c(locale, "setup"), children, rows });
}
