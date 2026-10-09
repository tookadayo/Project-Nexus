import { ButtonStyle } from "discord-api-types/v10";
import {
  panelIconText,
  nexusPanel,
  footer,
  sectionWithAccessory,
  actionButton,
  actionRow,
} from "../primitives";
import { t } from "../i18n";
import { analysisCopy as c } from "../i18n/analysis";
import type { UiLocale } from "../i18n";
import type { Issue } from "../types";
import type { ControlData } from "./control";
export async function workflowHome(
  issue: Issue,
  data: ControlData,
  locale: UiLocale,
) {
  const daily = data.community?.daily,
    usage = data.analysis?.remaining,
    latest = data.analysis?.latest;
  const profile = data.model?.profile ?? data.community?.adaptive?.profile,
    channels =
      data.model?.capabilities?.channels ??
      data.community?.adaptive?.capabilities?.channels ??
      [];
  const basicDescription =
    channels.filter((channel) => [2, 13].includes(channel.type)).length >
    channels.filter((channel) => [0, 5, 15, 16].includes(channel.type)).length
      ? c(locale, "basicVoiceDescription")
      : profile?.confirmed &&
          profile.channels.some((channel) => channel.purpose === "SHOWCASE") &&
          !profile.channels.some((channel) => channel.purpose === "SUPPORT")
        ? c(locale, "basicShowcaseDescription")
        : c(locale, "basicDescription");
  return nexusPanel({
    title: "NEXUS",
    subtitle:
      panelIconText("overview", c(locale, "homeTitle")) +
      (data.sharedEntry
        ? ""
        : `${data.community?.range ? ` · ${c(locale, "days", { count: data.community.range })}` : ""}${data.updatedAt ? ` · <t:${Math.floor(data.updatedAt.getTime() / 1000)}:R>` : ""}`),
    children: [
      sectionWithAccessory(
        c(locale, "basicTitle"),
        `${basicDescription}\n${c(locale, "basic")}`,
        await actionButton(issue, {
          label: c(locale, "basicAction"),
          emojiKey: "analysis",
          action: "controlNavigate",
          data: { page: "analysis" },
          publicEntry: true,
        }),
      ),
      sectionWithAccessory(
        c(locale, "needs"),
        data.sharedEntry
          ? c(locale, "reviewDescription")
          : daily?.ready &&
              daily.attentionCount !== null &&
              daily.attentionCount !== undefined
            ? daily.attentionCount + (data.analysis?.attentionCount ?? 0) > 0
              ? c(locale, "reviewNeeded")
              : c(locale, "reviewClear")
            : c(locale, "reviewUnknown"),
        await actionButton(issue, {
          label: c(locale, "reviewAction"),
          emojiKey: "attention",
          action: "controlNavigate",
          data: { page: "attention" },
          publicEntry: true,
        }),
      ),
      sectionWithAccessory(
        c(locale, "title"),
        c(locale, "detailedDescription") +
          (data.sharedEntry
            ? ""
            : "\n" +
              (usage === undefined
                ? c(locale, "usageUnknown")
                : c(locale, "uses", { count: usage })) +
              "\n" +
              c(locale, "recent", {
                time: latest
                  ? `<t:${Math.floor(latest.getTime() / 1000)}:R>`
                  : c(locale, "notYet"),
              })),
        await actionButton(issue, {
          label: c(locale, "detailedAction"),
          emojiKey: "analysis",
          action: "analysisMenu",
          publicEntry: true,
          style: ButtonStyle.Primary,
        }),
      ),
      ...(data.settings?.setupSteps &&
      !Object.values(data.settings.setupSteps).every(Boolean)
        ? [
            footer(
              t(locale, "control.setupProgress", {
                done: Object.values(data.settings.setupSteps).filter(Boolean)
                  .length,
              }),
            ),
          ]
        : []),
      footer(c(locale, "notes")),
    ],
    rows: [
      await actionRow(issue, [
        ...(!data.sharedEntry
          ? [
              {
                label: c(locale, "history"),
                action: "analysisHistory",
                emojiKey: "history" as const,
              },
            ]
          : []),
        {
          label: c(locale, "settings"),
          emojiKey: "settings",
          action: "controlNavigate",
          data: { page: "settings" },
          publicEntry: true,
        },
        {
          label: c(locale, "more"),
          action: "controlNavigate",
          data: { page: "settings", section: "other" },
          publicEntry: true,
        },
      ]),
    ],
  });
}
