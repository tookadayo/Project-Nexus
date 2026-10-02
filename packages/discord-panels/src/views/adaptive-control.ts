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
      ? ja
        ? "サーバー概要"
        : "Server overview"
      : page === "newMembers"
        ? ja
          ? "新しいメンバー"
          : "New members"
        : page === "analysis"
          ? ja
            ? "分析"
            : "Insights"
          : ja
            ? "計測方法"
            : "Measurement method";
  const intentsAvailable =
    !m.integration || m.integration.intents.members === "AVAILABLE";
  if (m.integration?.severe)
    children.push(
      callout(
        ja ? "計測を一部停止しています" : "Some measurements are paused",
        intentsAvailable
          ? ja
            ? "Discordとの接続を確認できません。この期間は比較に使用しません。"
            : "The Discord connection is unavailable. This period is excluded from comparisons."
          : ja
            ? "必要なメンバー情報を正常に受信できていません。この期間は比較に使用しません。"
            : "Required member information is unavailable. This period is excluded from comparisons.",
      ),
    );
  if (page === "overview") {
    const count = c.daily.attentionCount,
      oldest = c.attention[0]?.waitingMinutes;
    children.push(
      callout(
        ja ? "対応待ち" : "Attention",
        count === null || count === undefined
          ? ja
            ? "新しい対応対象を確認できません"
            : "New attention items cannot be observed"
          : `${count} ${ja ? "件" : "items"}${oldest !== undefined ? ` · ${ja ? "最長" : "Oldest"} ${oldest} ${ja ? "分" : "min"}` : ""}`,
      ),
    );
    if (!large)
      children.push(
        metricGrid([
          {
            label: ja ? "今日、新しく参加" : "Joined today",
            value:
              intentsAvailable &&
              c.daily.todayJoined !== null &&
              c.daily.todayJoined !== undefined
                ? String(c.daily.todayJoined)
                : ja
                  ? "確認できません"
                  : "Unknown",
          },
          {
            label: ja
              ? "今日、最初の交流を確認"
              : "First connection observed today",
            value:
              intentsAvailable &&
              c.daily.todayConnected !== null &&
              c.daily.todayConnected !== undefined
                ? String(c.daily.todayConnected)
                : ja
                  ? "確認できません"
                  : "Unknown",
          },
        ]),
      );
    else if (c.operations)
      children.push(
        metricGrid([
          {
            label: ja ? "登録済みの対応" : "Saved open backlog",
            value: String(c.operations.openBacklog),
          },
          {
            label: ja ? "対応完了時間の中央値" : "Median resolution time",
            value:
              c.operations.medianResolutionSeconds === null
                ? ja
                  ? "まだ比較できません"
                  : "Not ready"
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
    const copy = metricCopy(metric, ja ? "ja" : "en");
    children.push(
      callout(
        copy.label,
        `${(large && ["directReplies", "postResponse"].includes(metric.key) ? evidenceFraction(metric.evidence, ja ? "ja" : "en") : undefined) ?? evidenceValue(metric.evidence, ja ? "ja" : "en")}${metric.evidence?.value !== null && metric.evidence?.value !== undefined ? copy.unit : ""}${large && metric.evidence?.sampleSize && metric.evidence.sampleSize >= 5 && metric.medianMinutes !== null && metric.medianMinutes !== undefined ? ` · ${ja ? "中央値" : "Median"} ${Math.round(metric.medianMinutes)} min${metric.p75Minutes !== null && metric.p75Minutes !== undefined ? ` · p75 ${Math.round(metric.p75Minutes)} min` : ""}` : ""}\n${evidenceNote(metric.evidence, ja ? "ja" : "en")}${page === "analysis" ? `\n${copy.definition}` : ""}`,
      ),
    );
  }
  if (page === "newMembers") {
    const journeys = m.journeys?.transitions ?? [];
    for (const row of journeys.slice(0, 4))
      children.push(
        callout(
          `${row.fromLabel[ja ? 0 : 1]} → ${row.toLabel[ja ? 0 : 1]}`,
          `${evidenceValue(row.evidence, ja ? "ja" : "en", true)}${row.evidence.denominator !== null && row.evidence.numerator !== null ? ` · ${row.evidence.numerator} / ${row.evidence.denominator}` : ""}\n${evidenceNote(row.evidence, ja ? "ja" : "en")}`,
        ),
      );
    if (!journeys.length)
      children.push(
        callout(
          ja ? "計測方法を確認してください" : "Choose a measurement recipe",
          ja
            ? "Dashboardでサーバーの目的を確認すると、参加後の変化を表示できます。"
            : "Confirm the community purpose in Dashboard to see participation transitions.",
        ),
      );
  }
  if (page === "community")
    children.push(
      callout(
        ja ? "このサーバーで確認すること" : "What this server measures",
        m.recipe?.definition
          ? (recipeNames[m.recipe.definition.preset]?.[ja ? 0 : 1] ??
              m.recipe.preset)
          : m.profile.modes
              .map((mode) => modeNames[mode][ja ? 0 : 1])
              .join(" · "),
      ),
      callout(
        ja ? "確認しないもの" : "Not observed",
        ja
          ? "メッセージ本文・DM・Voice音声・オンライン状態"
          : "Message content, DMs, voice audio, and online status",
      ),
    );
  const total = m.capabilities?.coverage;
  children.push(
    footer(
      `${m.window.from.slice(0, 10)} — ${m.window.through.slice(0, 10)} · ${ja ? "確認できるチャンネル" : "Observed channels"} ${total?.observableChannels ?? "—"}${total?.totalState === "KNOWN" ? ` / ${total.knownTotalChannels}` : ja ? " · サーバー全体の数は確認できません" : " · Server-wide total unavailable"}`,
    ),
  );
  const rows: ActionRow[] = [
    await actionRow(issue, [
      {
        label: ja ? "対応を見る" : "Attention",
        action: "controlNavigate",
        data: { page: "attention" },
        publicEntry: true,
        emoji: "📥",
        style: ButtonStyle.Primary,
      },
      {
        label: ja ? "新規メンバー" : "New members",
        action: "controlNavigate",
        data: { page: "newMembers" },
        publicEntry: true,
      },
      {
        label: ja ? "分析" : "Insights",
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
            "results",
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
      label: "Dashboard",
      url: data.dashboardUrl,
    });
  rows.push(links);
  return nexusPanel({
    title,
    accent: m.integration?.severe ? "warning" : large ? "nexus" : "healthy",
    children,
    rows,
  });
}
