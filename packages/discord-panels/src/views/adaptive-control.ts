import {componentCopy} from '../i18n/components';
import {
  ButtonStyle,
  ComponentType,
  type APIStringSelectComponent,
} from "discord-api-types/v10";
import {
  nexusPanel,
  callout,
  footer,
  metricGrid,
  actionRow,
  type Panel,
  type ActionRow,
  type PanelChild,
} from "../primitives";
import type { Issue } from "../types";
import type { ControlData, ControlPage } from "./control";
import { t, type UiLocale } from "../i18n";
import { metricCopy, modeNames } from "../../../shared/src/community-copy";
import {
  evidenceValue,
  evidenceFraction,
  evidenceNote,
} from "../../../shared/src/measurement-view";
import {analysisCopy} from '../i18n/analysis';
import { recipeNames } from "../../../shared/src/operations-copy";
export async function adaptiveControlPanel(
  issue: Issue,
  page: ControlPage,
  data: ControlData,
  locale: UiLocale,
): Promise<Panel> {
  const m = data.community!.adaptive!,
    c = data.community!,
    ja = locale === "ja",
    large = m.volume === "HIGH_VOLUME",
    children: PanelChild[] = [];
  const title =
    page === "overview"
      ? componentCopy(locale,'serverOverview')
      : page === "newMembers"
        ? componentCopy(locale,'newMembers')
        : page === "analysis"
          ? componentCopy(locale,'analysis')
          : componentCopy(locale,'measurementMethod');
  const intentsAvailable =
    !m.integration || m.integration.intents.members === "AVAILABLE";
  if(m.caveats.some(caveat=>caveat.startsWith("Conflicting administrator-mapped status tags")))children.push(callout(analysisCopy(locale,"needs"),analysisCopy(locale,"tagConflict")));
  if (m.integration?.severe)
    children.push(
      callout(
        componentCopy(locale,'someMeasurementsArePaused'),
        intentsAvailable
          ? componentCopy(locale,'theDiscordConnectionIsUnavailableThisPeriod')
          : componentCopy(locale,'requiredMemberInformationIsUnavailableThisPeriod'),
      ),
    );
  if (page === "overview") {
    const count = c.daily.attentionCount,
      oldest = c.attention[0]?.waitingMinutes;
    children.push(
      callout(
        componentCopy(locale,'attention'),
        count === null || count === undefined
          ? componentCopy(locale,'newAttentionItemsCannotBeObserved')
          : `${count} ${componentCopy(locale,'items')}${oldest !== undefined ? ` · ${componentCopy(locale,'oldest')} ${oldest} ${componentCopy(locale,'min')}` : ""}`,
      ),
    );
    if (!large)
      children.push(
        metricGrid([
          {
            label: componentCopy(locale,'joinedToday'),
            value:
              intentsAvailable &&
              c.daily.todayJoined !== null &&
              c.daily.todayJoined !== undefined
                ? String(c.daily.todayJoined)
                : componentCopy(locale,'unknown'),
          },
          {
            label: componentCopy(locale,'firstConnectionObservedToday'),
            value:
              intentsAvailable &&
              c.daily.todayConnected !== null &&
              c.daily.todayConnected !== undefined
                ? String(c.daily.todayConnected)
                : componentCopy(locale,'unknown'),
          },
        ]),
      );
    else if (c.operations)
      children.push(
        metricGrid([
          {
            label: componentCopy(locale,'savedOpenBacklog'),
            value: String(c.operations.openBacklog),
          },
          {
            label: componentCopy(locale,'medianResolutionTime'),
            value:
              c.operations.medianResolutionSeconds === null
                ? componentCopy(locale,'notReady')
                : `${Math.round(c.operations.medianResolutionSeconds / 60)} min`,
          },
          {
            label: "p75",
            value:
              c.operations.p75ResolutionSeconds === null
                ? "—"
                : `${Math.round(c.operations.p75ResolutionSeconds / 60)} min`,
          },
        ]),
      );
  }
  const selected = m.metrics
    .filter(
      (metric) =>
        page !== "overview" ||
        [
          "directReplies",
          "postResponse",
          "voiceCopresence",
          "eventAttendance",
          "activeReactions",
          "pollParticipants",
        ].includes(metric.key),
    )
    .slice(0, page === "overview" ? (large ? 3 : 2) : 5);
  for (const metric of selected) {
    const copy = metricCopy(metric, (locale==='ja'?'ja':'en'));
    children.push(
      callout(
        copy.label,
        `${(large && ["directReplies", "postResponse"].includes(metric.key) ? evidenceFraction(metric.evidence, (locale==='ja'?'ja':'en')) : undefined) ?? evidenceValue(metric.evidence, (locale==='ja'?'ja':'en'))}${metric.evidence?.value !== null && metric.evidence?.value !== undefined ? copy.unit : ""}${large && metric.evidence?.sampleSize && metric.evidence.sampleSize >= 5 && metric.medianMinutes !== null && metric.medianMinutes !== undefined ? ` · ${componentCopy(locale,'median')} ${Math.round(metric.medianMinutes)} min${metric.p75Minutes !== null && metric.p75Minutes !== undefined ? ` · p75 ${Math.round(metric.p75Minutes)} min` : ""}` : ""}\n${evidenceNote(metric.evidence, (locale==='ja'?'ja':'en'))}${page === "analysis" ? `\n${copy.definition}` : ""}`,
      ),
    );
  }
  if (page === "newMembers") {
    const journeys = m.journeys?.transitions ?? [];
    for (const row of journeys.slice(0, 4))
      children.push(
        callout(
          `${row.fromLabel[ja ? 0 : 1]} → ${row.toLabel[ja ? 0 : 1]}`,
          `${evidenceValue(row.evidence, (locale==='ja'?'ja':'en'), true)}${row.evidence.denominator !== null && row.evidence.numerator !== null ? ` · ${row.evidence.numerator} / ${row.evidence.denominator}` : ""}\n${evidenceNote(row.evidence, (locale==='ja'?'ja':'en'))}`,
        ),
      );
    if (!journeys.length)
      children.push(
        callout(
          componentCopy(locale,'chooseAMeasurementRecipe'),
          componentCopy(locale,'confirmTheCommunityPurposeInWebScreen'),
        ),
      );
  }
  if (page === "community")
    children.push(
      callout(
        componentCopy(locale,'whatThisServerMeasures'),
        m.recipe?.definition
          ? (recipeNames[m.recipe.definition.preset]?.[ja ? 0 : 1] ??
              componentCopy(locale,'chooseAMeasurementRecipe'))
          : m.profile.modes
              .map((mode) => modeNames[mode][ja ? 0 : 1])
              .join(" · "),
      ),
      callout(
        componentCopy(locale,'notObserved'),
        componentCopy(locale,'messageContentDmsVoiceAudioAndOnline'),
      ),
    );
  const total = m.capabilities?.coverage;
  children.push(
    footer(
      `${m.window.from.slice(0, 10)} — ${m.window.through.slice(0, 10)} · ${componentCopy(locale,'observedChannels')} ${total?.observableChannels ?? "—"}${total?.totalState === "KNOWN" ? ` / ${total.knownTotalChannels}` : componentCopy(locale,'serverwideTotalUnavailable')}`,
    ),
  );
  const rows: ActionRow[] = [
    await actionRow(issue, [
      {
        label: componentCopy(locale,'attentionLabel'),
        action: "controlNavigate",
        data: { page: "attention" },
        publicEntry: true,
        emoji: "📥",
        style: ButtonStyle.Primary,
      },
      {
        label: componentCopy(locale,'newMembersLabel'),
        action: "controlNavigate",
        data: { page: "newMembers" },
        publicEntry: true,
      },
      {
        label: componentCopy(locale,'analysis'),
        action: "controlNavigate",
        data: { page: "analysis" },
        publicEntry: true,
      },
    ]),
  ];
  const navigation: ActionRow = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        custom_id: await issue({ action: "controlNavigate" }, true),
        placeholder: t(locale, "control.choosePage"),
        options: (
          [
            "overview",
            "newMembers",
            "attention",
            "analysis",
            "settings",
          ] as const
        ).map((value) => ({
          label: t(locale, `control.${value}`),
          value,
          default: page === value,
        })),
      } satisfies APIStringSelectComponent,
    ],
  };
  rows.push(navigation);
  const links = await actionRow(issue, [
    {
      label: t(locale, "control.model"),
      action: "controlSettings",
      data: { section: "model", privateSettings: true },
      publicEntry: true,
    },
    {
      label: t(locale, "control.refresh"),
      action: "controlRefresh",
      data: { page },
      publicEntry: true,
    },
  ]);
  if (data.dashboardUrl)
    links.components.push({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: t(locale,"control.openWeb"),
      url: data.dashboardUrl,
    });
  rows.push(links);
  if(page==='analysis')rows.push(await actionRow(issue,[{label:analysisCopy(locale,'detailedAction'),action:'analysisMenu',publicEntry:true,style:ButtonStyle.Primary}]));
  return nexusPanel({
    title,
    accent: m.integration?.severe ? "warning" : large ? "nexus" : "healthy",
    children,
    rows,
  });
}
