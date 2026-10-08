import { ButtonStyle } from "discord-api-types/v10";
import {
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
    usage = data.analysis?.remaining ?? 0,
    latest = data.analysis?.latest;
  return nexusPanel({
    title: "NEXUS",
    subtitle: c(locale, "homeTitle"),
    children: [
      sectionWithAccessory(
        "⚠ " + c(locale, "needs"),
        daily?.ready
          ? t(locale, "polish.count", {
              count:
                (daily.attentionCount ?? 0) +
                (data.analysis?.attentionCount ?? 0),
            })
          : c(locale, "unknown"),
        await actionButton(issue, {
          label: c(locale, "see"),
          action: "controlNavigate",
          data: { page: "attention" },
          publicEntry: true,
          style:
            (daily?.attentionCount ?? 0) +
              (data.analysis?.attentionCount ?? 0) >
            0
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary,
        }),
      ),
      sectionWithAccessory(
        "📊 " + c(locale, "basicTitle"),
        `${c(locale, "basic")}\n${c(locale, "uses", { count: usage })}\n${c(locale, "recent", { time: latest ? `<t:${Math.floor(latest.getTime() / 1000)}:R>` : c(locale, "notYet") })}`,
        await actionButton(issue, {
          label: c(locale, "see"),
          action: "controlNavigate",
          data: { page: "analysis" },
          publicEntry: true,
        }),
      ),
      sectionWithAccessory(
        "👋 " + c(locale, "newMembers"),
        data.community?.arrivalCount !== undefined && daily?.ready
          ? c(locale, "weekJoined", { count: data.community.arrivalCount })
          : c(locale, "unknown"),
        await actionButton(issue, {
          label: c(locale, "see"),
          action: "controlNavigate",
          data: { page: "newMembers" },
          publicEntry: true,
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
        {
          label: c(locale, "settings"),
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
