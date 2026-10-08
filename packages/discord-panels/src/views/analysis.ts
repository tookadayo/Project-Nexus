import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import {
  nexusPanel,
  callout,
  actionRow,
  footer,
  sectionWithAccessory,
  actionButton,
  type PanelChild,
} from "../primitives";
import type { Issue } from "../types";
import type { UiLocale } from "../i18n";
import {
  analysisCopy as c,
  analysisNames,
  availabilityNames,
  qualityNames,
  metricNames,
  runStatusNames,
  localized,
  analysisEvidenceReason,
} from "../i18n/analysis";
import type {
  AnalysisService,
  AnalysisResult,
  AnalysisRun,
} from "../../../analysis/src/index";
const relative = (at: Date) => `<t:${Math.floor(at.getTime() / 1000)}:R>`;
const name = (locale: UiLocale, key: string) =>
  localized(locale, metricNames[key] ?? [key, key]);
export async function analysisMenuPanel(
  issue: Issue,
  data: Awaited<ReturnType<AnalysisService["menu"]>>,
  locale: UiLocale,
) {
  return nexusPanel({
    title: c(locale, "title"),
    children: [
      callout(
        c(locale, "menu"),
        c(locale, "uses", { count: data.usage.remaining }),
      ),
      footer(c(locale, "basic")),
    ],
    rows: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: await issue({
              action: "analysisPreview",
              days: data.days,
            }),
            placeholder: c(locale, "menu"),
            options: data.items.map((item) => ({
              label: localized(locale, analysisNames[item.type]),
              value: item.type,
              description: localized(
                locale,
                availabilityNames[item.availability],
              ),
            })),
          },
        ],
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: await issue({ action: "analysisMenu" }),
            placeholder: c(locale, "period"),
            options: [7, 30, 90].map((days) => ({
              label: c(locale, "days", { count: days }),
              value: String(days),
              default: data.days === days,
            })),
          },
        ],
      },
      await actionRow(issue, [
        { label: c(locale, "history"), action: "analysisHistory" },
        {
          label: c(locale, "back"),
          action: "controlNavigate",
          data: { page: "analysis" },
        },
      ]),
    ],
  });
}
export async function analysisPreviewPanel(
  issue: Issue,
  data: Awaited<ReturnType<AnalysisService["preview"]>>,
  locale: UiLocale,
) {
  const children: PanelChild[] = [
    callout(
      localized(locale, analysisNames[data.request.type]),
      c(locale, "periodWindow", {
        from: data.periodStart.toISOString().slice(0, 10),
        through: new Date(data.periodEnd.getTime() - 86400000)
          .toISOString()
          .slice(0, 10),
      }),
    ),
    callout(
      c(locale, "scope"),
      `${c(locale, data.scope.mode)}${data.scope.mode === "all" ? "" : "\n" + c(locale, "placesCount", { count: data.scope.channelIds.length })}`,
    ),
    callout(
      c(locale, "quality"),
      localized(locale, availabilityNames[data.availability]),
    ),
  ];
  for (const metric of data.metrics)
    children.push(
      callout(
        name(locale, metric.key),
        localized(locale, qualityNames[metric.quality]),
      ),
    );
  children.push(
    callout(
      c(locale, "uses", { count: data.usage.remaining }),
      c(locale, "effect", {
        before: data.usage.remaining,
        after: Math.max(0, data.usage.remaining - 1),
      }),
    ),
    footer(c(locale, "eta", { range: data.estimate })),
  );
  if (data.duplicate)
    children.push(
      callout(
        c(locale, "duplicate"),
        localized(locale, runStatusNames[data.duplicate.status]),
      ),
    );
  const intent = {
    type: data.request.type,
    days: data.request.days,
    revision: data.configRevision,
    fingerprint: data.inputFingerprint,
  };
  const buttons = data.duplicate
    ? [
        {
          label: c(locale, "view"),
          action: "analysisResult",
          data: { runId: data.duplicate.id },
          style: ButtonStyle.Primary as const,
        },
        {
          label: c(locale, "rerun"),
          action: "analysisRerun",
          data: intent,
          disabled: data.usage.remaining === 0,
        },
      ]
    : [
        {
          label: c(locale, "start"),
          action: "analysisStart",
          data: intent,
          style: ButtonStyle.Primary as const,
          disabled:
            !["AVAILABLE", "PARTIAL"].includes(data.availability) ||
            data.usage.remaining === 0,
        },
      ];
  if (data.usage.remaining === 0) children.push(footer(c(locale, "noUses")));
  return nexusPanel({
    title: c(locale, "preview"),
    children,
    rows: [
      await actionRow(issue, buttons),
      await actionRow(issue, [
        {
          label: c(locale, "back"),
          action: "analysisMenu",
          data: { days: data.request.days },
        },
        {
          label: c(locale, "settings"),
          action: "controlNavigate",
          data: { page: "settings" },
        },
      ]),
    ],
  });
}
export async function analysisHistoryPanel(
  issue: Issue,
  runs: AnalysisRun[],
  locale: UiLocale,
) {
  const children: PanelChild[] = runs.length
    ? []
    : [callout(c(locale, "empty"), c(locale, "basic"))];
  for (const run of runs.slice(0, 5))
    children.push(
      sectionWithAccessory(
        localized(locale, analysisNames[run.analysis_type]),
        `${localized(locale, runStatusNames[run.status])}\n${c(locale, "days", { count: run.period_days })} · ${relative(run.completed_at ?? run.requested_at)}`,
        await actionButton(issue, {
          label: c(locale, "view"),
          action: "analysisResult",
          data: { runId: run.id },
        }),
      ),
    );
  return nexusPanel({
    title: c(locale, "history"),
    children,
    rows: [
      await actionRow(issue, [
        { label: c(locale, "back"), action: "analysisMenu" },
        { label: c(locale, "refresh"), action: "analysisHistory" },
      ]),
    ],
  });
}
export async function analysisResultPanel(
  issue: Issue,
  data: { run: AnalysisRun; result: AnalysisResult | null },
  locale: UiLocale,
  notice?: string,
  showEvidence = false,
) {
  const { run, result } = data,
    children: PanelChild[] = [];
  if (notice) children.push(callout(notice, ""));
  children.push(
    callout(
      localized(locale, analysisNames[run.analysis_type]),
      `${localized(locale, runStatusNames[run.status])}\n${c(locale, "periodWindow", { from: run.period_start.toISOString().slice(0, 10), through: new Date(run.period_end.getTime() - 86400000).toISOString().slice(0, 10) })}`,
    ),
  );
  if (result) {
    for (const metric of result.metrics) {
      const measured =
        metric.evidence.value !== null &&
        ["COMPLETE", "PARTIAL"].includes(metric.quality);
      children.push(
        callout(
          name(locale, metric.key),
          `${measured ? String(Math.round(metric.evidence.value! * 100) / 100) + "\n" : ""}${localized(locale, qualityNames[metric.quality])}\n${c(locale, "sample", { count: metric.evidence.sampleSize })}`,
        ),
      );
    }
    if (showEvidence) {
      const reasons = [
        ...new Set(
          result.metrics
            .flatMap((m) => [
              ...m.evidence.coverageReasons,
              ...m.evidence.comparisonBlockers,
            ])
            .map((reason) => analysisEvidenceReason(locale, reason)),
        ),
      ];
      children.push(
        callout(
          c(locale, "evidence"),
          reasons.length
            ? reasons.slice(0, 6).join("\n")
            : c(locale, "reasonsNone"),
        ),
      );
    }
    children.push(footer(c(locale, "notes")));
  } else
    children.push(
      callout(
        ["FAILED", "CANCELED"].includes(run.status)
          ? c(locale, "failed")
          : c(locale, "queued"),
        c(locale, "basic"),
      ),
    );
  const buttons = result
    ? [
        {
          label: c(locale, "compare"),
          action: "analysisCompare",
          data: { runId: run.id },
        },
        {
          label: showEvidence ? c(locale, "view") : c(locale, "evidence"),
          action: showEvidence ? "analysisResult" : "analysisEvidence",
          data: { runId: run.id },
        },
        ...(result.concerns[0]
          ? [
              {
                label: c(locale, "attention"),
                action: "analysisAttention",
                data: { runId: run.id, concernKey: result.concerns[0].key },
                style: ButtonStyle.Primary as const,
              },
            ]
          : []),
      ]
    : [
        {
          label: c(locale, "refresh"),
          action: "analysisResult",
          data: { runId: run.id },
        },
      ];
  return nexusPanel({
    title: result ? c(locale, "completed") : c(locale, "title"),
    children,
    rows: [
      await actionRow(issue, buttons),
      await actionRow(issue, [
        { label: c(locale, "history"), action: "analysisHistory" },
        { label: c(locale, "back"), action: "analysisMenu" },
      ]),
    ],
  });
}
export async function analysisComparisonPanel(
  issue: Issue,
  id: string,
  data: Awaited<ReturnType<AnalysisService["compare"]>>,
  locale: UiLocale,
) {
  return nexusPanel({
    title: c(locale, "compare"),
    children: data.comparable
      ? data.changes.map((m) =>
          callout(name(locale, m.key), `${m.before} → ${m.after}`),
        )
      : [callout(c(locale, "incompatible"), c(locale, "notes"))],
    rows: [
      await actionRow(issue, [
        {
          label: c(locale, "back"),
          action: "analysisResult",
          data: { runId: id },
        },
      ]),
    ],
  });
}
export async function analysisAttentionListPanel(
  issue: Issue,
  items: Awaited<ReturnType<AnalysisService["attentionList"]>>,
  offset: number,
  locale: UiLocale,
) {
  const children: PanelChild[] = [];
  // Accessory IDs are issued by the same actor/scope policy as result controls.
  for (let index = 0; index < items.length; index++)
    children[index] = sectionWithAccessory(
      c(locale, "waiting", { count: items[index]!.evidence.value ?? 0 }),
      relative(items[index]!.detected_at),
      await actionButton(issue, {
        label: c(locale, "see"),
        action: "analysisAttentionItem",
        data: { key: items[index]!.message_id },
      }),
    );
  if (!items.length) children.push(callout(c(locale, "noReviews"), ""));
  return nexusPanel({
    title: c(locale, "analysisConcerns"),
    children,
    rows: [
      await actionRow(issue, [
        {
          label: c(locale, "back"),
          action: "analysisAttentionList",
          data: { offset: Math.max(0, offset - 5) },
          disabled: offset === 0,
        },
        {
          label: c(locale, "next"),
          action: "analysisAttentionList",
          data: { offset: offset + 5 },
          disabled: items.length < 5 || offset >= 995,
        },
        {
          label: c(locale, "home"),
          action: "controlNavigate",
          data: { page: "overview" },
        },
      ]),
    ],
  });
}
export async function analysisAttentionItemPanel(
  issue: Issue,
  item: Awaited<ReturnType<AnalysisService["attentionItem"]>>,
  locale: UiLocale,
) {
  return nexusPanel({
    title: c(locale, "analysisConcerns"),
    children: [
      callout(
        c(locale, "waiting", { count: item.evidence.value ?? 0 }),
        `${localized(locale, qualityNames[item.evidence.coverageState === "COMPLETE" ? "COMPLETE" : "PARTIAL"])}\n${item.evidence.windowStart.slice(0, 10)} – ${item.evidence.windowEnd.slice(0, 10)} UTC\n${c(locale, "sample", { count: item.evidence.sampleSize })}`,
      ),
    ],
    rows: [
      await actionRow(issue, [
        {
          label: c(locale, "acknowledge"),
          action: "analysisAttentionUpdate",
          data: {
            key: item.message_id,
            version: item.version,
            status: "ACKNOWLEDGED",
          },
          disabled: ["ACKNOWLEDGED", "RESOLVED", "DISMISSED"].includes(
            item.status,
          ),
        },
        {
          label: c(locale, "resolved"),
          action: "analysisAttentionUpdate",
          data: {
            key: item.message_id,
            version: item.version,
            status: "RESOLVED",
          },
          style: ButtonStyle.Primary,
          disabled: ["RESOLVED", "DISMISSED"].includes(item.status),
        },
      ]),
      await actionRow(issue, [
        { label: c(locale, "back"), action: "analysisAttentionList" },
      ]),
    ],
  });
}
