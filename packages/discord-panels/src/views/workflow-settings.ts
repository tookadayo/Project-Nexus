import { componentEmoji } from "../../../shared/src/application-emoji";
import { ComponentType } from "discord-api-types/v10";
import { panelIconText, nexusPanel, callout, actionRow } from "../primitives";
import { analysisCopy as c } from "../i18n/analysis";
import type { UiLocale } from "../i18n";
import type { Issue } from "../types";
import type { ControlData } from "./control";
export async function workflowSettings(
  issue: Issue,
  data: ControlData,
  locale: UiLocale,
) {
  return nexusPanel({
    title: panelIconText("settings", c(locale, "settings")),
    children: [
      callout(
        c(locale, "scope"),
        c(
          locale,
          data.settings?.analysisScope.mode === "include"
            ? "include"
            : data.settings?.analysisScope.mode === "exclude"
              ? "exclude"
              : "all",
        ),
      ),
    ],
    rows: [
      await actionRow(
        issue,
        (["scope", "notifications", "team", "goals"] as const).map(
          (section) => ({
            label: c(locale, section),
            action: "controlSettings",
            data: { section, privateSettings: true },
            publicEntry: true,
          }),
        ),
      ),
      await actionRow(
        issue,
        (["connection", "privacy"] as const).map((section) => ({
          label: c(locale, section),
          action: "controlSettings",
          data: { section, privateSettings: true },
          publicEntry: true,
        })),
      ),
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: await issue(
              { action: "controlSettings", privateSettings: true },
              true,
            ),
            placeholder: c(locale, "more"),
            options: [
              {
                label: c(locale, "support"),
                value: "other",
                emoji: componentEmoji("help"),
              },
              { label: c(locale, "advanced"), value: "advanced" },
            ],
          },
        ],
      },
      await actionRow(issue, [
        { label: c(locale, "setup"), action: "setupWizard" },
        {
          label: c(locale, "home"),
          emojiKey: "overview",
          action: "controlNavigate",
          data: { page: "overview" },
          publicEntry: true,
        },
      ]),
    ],
  });
}
