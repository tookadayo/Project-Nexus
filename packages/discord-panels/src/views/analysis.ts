import { componentEmoji } from "../../../shared/src/application-emoji";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import {
  panelIconText,
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
  analysisDescriptions,
  runStatusNames,
  localized,
  analysisEvidenceReason,
  hasHistoricalPostCoverage,
} from "../i18n/analysis";
import type {
  AnalysisService,
  AnalysisResult,
  AnalysisRun,
  AnalysisComparison,
} from "../../../analysis/src/index";
import {
  detailPageSize,
  placePageSize,
  evidencePeriod,
  evidenceState,
  hasObservedValue,
  evidenceReasons,
  metricDescription,
  evidenceDetails,
  savedPlaces,
  recordState,
} from "./analysis-evidence";
const relative = (at: Date) => `<t:${Math.floor(at.getTime() / 1000)}:R>`;
const renewal = (locale: UiLocale) => {
  const now = new Date(),
    next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return c(locale, "monthlyRenewal", {
    time: `<t:${Math.floor(next.getTime() / 1000)}:f>`,
  });
};
const name = (locale: UiLocale, key: string) =>
  localized(
    locale,
    metricNames[key] ?? [
      c(locale, "unknownMetric"),
      c(locale, "unknownMetric"),
    ],
  );
export const metricValue = (
  locale: UiLocale,
  key: string,
  value: number,
  unit?: "COUNT" | "SECONDS",
) => {
  const count = Math.round(value * 100) / 100;
  return c(
    locale,
    unit === "SECONDS" || (!unit && key === "first_reply_seconds")
      ? "seconds"
      : ["new_members", "voice_copresence", "poll_participants"].includes(key)
        ? "people"
        : "items",
    { count },
  );
};
export async function analysisMenuPanel(
  issue: Issue,
  data: Awaited<ReturnType<AnalysisService["menu"]>>,
  locale: UiLocale,
) {
  return nexusPanel({
    title: panelIconText("analysis", c(locale, "title")),
    children: [
      callout(
        c(locale, "menu"),
        c(locale, "uses", { count: data.usage.remaining }),
      ),
      footer(c(locale, "basic")),
      footer(renewal(locale)),
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
              emoji: componentEmoji("analysis"),
              value: item.type,
              description: localized(locale, analysisDescriptions[item.type]),
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
        {
          label: c(locale, "history"),
          action: "analysisHistory",
          emojiKey: "history",
        },
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
  const cost = data.consumeCount;
  const children: PanelChild[] = [
    ...(data.correctionOf
      ? [callout(c(locale, "correctionReview"), c(locale, "correctionFree"))]
      : []),
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
      `${c(locale, data.scope.mode)}\n${c(locale, "placesCount", { count: data.targetChannelCount })}`,
    ),
    callout(
      c(locale, "quality"),
      localized(locale, availabilityNames[data.availability]),
    ),
  ];
  if (hasHistoricalPostCoverage(data.metrics))
    children.push(
      callout(
        c(locale, "historicalPostsTitle"),
        c(locale, "reasonHistoricalPosts"),
      ),
    );
  for (const metric of data.metrics
    .filter((m) => m.quality !== "NOT_APPLICABLE")
    .slice(0, 3))
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
        after: Math.max(0, data.usage.remaining - cost),
      }),
    ),
    footer(
      data.estimate
        ? c(locale, "eta", { range: data.estimate })
        : c(locale, "estimateUnknown"),
    ),
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
    periodStart: data.periodStart.toISOString(),
    periodEnd: data.periodEnd.toISOString(),
    revision: data.configRevision,
    fingerprint: data.inputFingerprint,
    correctionOf: data.correctionOf ?? undefined,
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
          disabled: data.usage.remaining < cost,
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
            data.usage.remaining < cost,
        },
      ];
  if (data.usage.remaining === 0 && cost > 0)
    children.push(footer(c(locale, "noUses")));
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
          emojiKey: "settings",
          action: "controlNavigate",
          data: { page: "settings" },
        },
      ]),
    ],
  });
}
export async function analysisHistoryPanel(
  issue: Issue,
  history:
    | AnalysisRun[]
    | {
        runs: AnalysisRun[];
        nextCursor: string | null;
        previousCursor: string | null;
      },
  locale: UiLocale,
  filter: { type?: string; status?: string } = {},
) {
  const page = Array.isArray(history)
    ? { runs: history, nextCursor: null, previousCursor: null }
    : history;
  if (page.runs.length > 5) throw new Error("DISCORD_HISTORY_PAGE_LIMIT");
  const children: PanelChild[] = page.runs.length
    ? []
    : [callout(c(locale, "empty"), c(locale, "basic"))];
  for (const run of page.runs)
    children.push(
      sectionWithAccessory(
        localized(locale, analysisNames[run.analysis_type]),
        `${run.invalidated_at ? c(locale, "removedData") : localized(locale, runStatusNames[run.status])}\n${/^(v1|analysis-observation-v1)/.test(run.recipe_version) ? c(locale, "oldDefinition") + "\n" : ""}${c(locale, "periodWindow", { from: run.period_start.toISOString().slice(0, 10), through: new Date(run.period_end.getTime() - 1).toISOString().slice(0, 10) })} · ${relative(run.requested_at)}`,
        await actionButton(issue, {
          label: c(locale, "view"),
          action: "analysisResult",
          data: { runId: run.id },
          disabled: Boolean(run.invalidated_at),
        }),
      ),
    );
  return nexusPanel({
    title: panelIconText("history", c(locale, "history")),
    children,
    rows: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: await issue({
              action: "analysisHistory",
              field: "type",
              status: filter.status,
            }),
            placeholder: c(locale, "menu"),
            options: [
              {
                label: c(locale, "history"),
                value: "all",
                default: !filter.type,
              },
              ...Object.entries(analysisNames).map(([type, names]) => ({
                label: localized(locale, names),
                value: type,
                default: type === filter.type,
              })),
            ],
          },
        ],
      },
      await actionRow(issue, [
        {
          label: c(locale, "previousPage"),
          action: "analysisHistory",
          data: {
            ...filter,
            cursor: page.previousCursor,
            direction: "previous",
          },
          disabled: !page.previousCursor,
        },
        {
          label: c(locale, "nextPage"),
          action: "analysisHistory",
          data: { ...filter, cursor: page.nextCursor, direction: "next" },
          disabled: !page.nextCursor,
        },
      ]),
      await actionRow(issue, [
        { label: c(locale, "back"), action: "analysisMenu" },
        {
          label: c(locale, "refresh"),
          action: "analysisHistory",
          data: filter,
        },
      ]),
    ],
  });
}
export async function analysisResultPanel(
  issue: Issue,
  data: {
    run: AnalysisRun;
    result: AnalysisResult | null;
    canOperate?: boolean;
    reviews?: { message_id: string; status: string }[];
  },
  locale: UiLocale,
  notice?: string,
  showEvidence = false,
  detailPage = 0,
  placePage = 0,
) {
  const { run, result } = data;
  const children: PanelChild[] = [];
  const metricPage = Math.min(
    detailPage,
    Math.max(0, Math.ceil((result?.metrics.length ?? 0) / detailPageSize) - 1),
  );
  const scopePage = Math.min(
    placePage,
    Math.max(
      0,
      Math.ceil((run.target_channel_ids?.length ?? 0) / placePageSize) - 1,
    ),
  );
  if (notice) children.push(callout(notice, ""));
  children.push(
    callout(
      localized(locale, analysisNames[run.analysis_type]),
      `${localized(locale, runStatusNames[run.status])}\n${evidencePeriod(locale, run.period_start.toISOString(), run.period_end.toISOString())}`,
    ),
  );
  if (result) {
    children.push(
      callout(c(locale, "savedScope"), savedPlaces(locale, run, scopePage)),
    );
    if (run.calculated_at)
      children.push(
        footer(
          c(locale, "calculatedAt", {
            time: `<t:${Math.floor(run.calculated_at.getTime() / 1000)}:f>`,
          }),
        ),
      );
    if (result.baseline?.changes.length)
      children.push(
        callout(
          c(locale, "changes"),
          result.baseline.changes
            .slice(0, 2)
            .map(
              (change) =>
                `${name(locale, change.key)}: ${metricValue(locale, change.key, change.before, change.unit)} → ${metricValue(locale, change.key, change.after, change.unit)}`,
            )
            .join("\n"),
        ),
      );
    if (
      result.baseline &&
      result.metrics.some((m) => m.evidence.sampleSize < 5)
    )
      children.push(footer(c(locale, "smallSample")));
    const available = result.metrics.filter((m) =>
      hasObservedValue(m.evidence),
    );
    children.push(
      callout(
        c(locale, "quality"),
        !available.length
          ? c(locale, "noFacts")
          : localized(
              locale,
              qualityNames[
                result.metrics.every(
                  (m) =>
                    m.evidence.coverageState === "COMPLETE" &&
                    m.evidence.observationState === "OBSERVED" &&
                    hasObservedValue(m.evidence),
                )
                  ? "COMPLETE"
                  : "PARTIAL"
              ],
            ),
      ),
    );
    if (hasHistoricalPostCoverage(result.metrics))
      children.push(
        callout(
          c(locale, "historicalPostsTitle"),
          c(locale, "reasonHistoricalPosts"),
        ),
      );
    const visible = showEvidence
      ? result.metrics.slice(
          metricPage * detailPageSize,
          (metricPage + 1) * detailPageSize,
        )
      : result.metrics.slice(0, 3);
    children.push(
      callout(
        c(locale, "observedFacts"),
        run.analysis_type === "NEW_MEMBERS" ? c(locale, "cohortScope") : "",
      ),
    );
    for (const metric of visible)
      children.push(
        callout(
          name(locale, metric.key),
          [
            ...new Set(
              [
                hasObservedValue(metric.evidence)
                  ? metricValue(
                      locale,
                      metric.key,
                      metric.evidence.value!,
                      metric.unit,
                    )
                  : c(locale, "valueUnknown"),
                evidenceState(locale, metric.evidence),
                metricDescription(locale, metric, run.analysis_type),
                ["UNKNOWN", "COLLECTING"].includes(
                  metric.evidence.observationState,
                )
                  ? c(locale, "sampleUnknown")
                  : c(
                      locale,
                      [
                        "new_members",
                        "voice_copresence",
                        "poll_participants",
                      ].includes(metric.key)
                        ? "samplePeople"
                        : "sampleRecords",
                      { count: metric.evidence.sampleSize },
                    ),
                showEvidence
                  ? evidenceDetails(locale, metric)
                  : evidenceReasons(locale, metric.evidence)
                      .slice(0, 2)
                      .join("\n"),
              ]
                .filter(Boolean)
                .flatMap((line) => line.split("\n")),
            ),
          ].join("\n"),
        ),
      );
    if (visible.some((m) => m.key === "voice_copresence")) {
      const seconds = (
        run.conditions?.settings as
          { voiceThresholdSeconds?: unknown } | undefined
      )?.voiceThresholdSeconds;
      if (
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        children.push(footer(c(locale, "savedVoiceThreshold", { seconds })));
    }
    children.push(
      callout(
        c(locale, "concerns"),
        result.concerns.length
          ? result.concerns
              .map((concern) => c(locale, "waiting", { count: concern.value }))
              .join("\n")
          : !available.length ||
              result.metrics.some(
                (m) =>
                  !hasObservedValue(m.evidence) ||
                  m.evidence.coverageState !== "COMPLETE",
              )
            ? c(locale, "concernUnknown")
            : c(locale, "noConcerns"),
      ),
    );
    if (visible.some((m) => m.key === "first_reply_seconds"))
      children.push(footer(c(locale, "medianNote")));
    children.push(
      callout(c(locale, "unknowns"), c(locale, "unknownsDescription")),
    );
    if (!showEvidence) children.push(footer(c(locale, "nextCheckDescription")));
    if (data.canOperate === false)
      children.push(footer(c(locale, "recordReadOnly")));
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
  const concern = result?.concerns[0];
  const key = concern ? `analysis:${run.id}:${concern.key}` : undefined;
  const saved = data.reviews?.some((review) => review.message_id === key);
  const buttons = result
    ? [
        {
          label: c(locale, "compare"),
          action: "analysisCompare",
          data: { runId: run.id },
        },
        {
          label: showEvidence ? c(locale, "view") : c(locale, "details"),
          action: showEvidence ? "analysisResult" : "analysisEvidence",
          data: { runId: run.id },
        },
        ...(concern
          ? [
              {
                label: c(locale, saved ? "responseRecords" : "attention"),
                action: saved ? "analysisAttentionItem" : "analysisAttention",
                data: saved
                  ? { key }
                  : { runId: run.id, concernKey: concern.key },
                style: ButtonStyle.Primary as const,
                disabled: !saved && data.canOperate === false,
              },
            ]
          : []),
      ]
    : [
        ...(run.status === "QUEUED"
          ? [
              {
                label: c(locale, "cancel"),
                action: "analysisCancel",
                data: { runId: run.id },
              },
            ]
          : []),
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
      ...(result &&
      run.scope_bug_impact === "POSSIBLE_CATEGORY_PARENT" &&
      run.status === "COMPLETED" &&
      !run.invalidated_at
        ? [
            await actionRow(issue, [
              {
                label: c(locale, "correctionReview"),
                action: "analysisPreview",
                data: {
                  type: run.analysis_type,
                  days: run.period_days,
                  periodStart: run.period_start.toISOString(),
                  periodEnd: run.period_end.toISOString(),
                  correctionOf: run.id,
                },
              },
            ]),
          ]
        : []),
      ...(result && showEvidence
        ? [
            await actionRow(issue, [
              {
                label: c(locale, "back"),
                action: "analysisEvidence",
                data: {
                  runId: run.id,
                  placePage: scopePage,
                  detailPage: Math.max(0, metricPage - 1),
                },
                disabled: metricPage === 0,
              },
              {
                label: c(locale, "next"),
                action: "analysisEvidence",
                data: {
                  runId: run.id,
                  placePage: scopePage,
                  detailPage: metricPage + 1,
                },
                disabled:
                  (metricPage + 1) * detailPageSize >= result.metrics.length,
              },
            ]),
          ]
        : []),
      ...(result && (run.target_channel_ids?.length ?? 0) > placePageSize
        ? [
            await actionRow(issue, [
              {
                label: c(locale, "previousPage"),
                action: showEvidence ? "analysisEvidence" : "analysisResult",
                data: {
                  runId: run.id,
                  detailPage: metricPage,
                  placePage: Math.max(0, scopePage - 1),
                },
                disabled: scopePage === 0,
              },
              {
                label: c(locale, "scopeDetails"),
                action: showEvidence ? "analysisEvidence" : "analysisResult",
                data: {
                  runId: run.id,
                  detailPage: metricPage,
                  placePage: scopePage + 1,
                },
                disabled:
                  (scopePage + 1) * placePageSize >=
                  (run.target_channel_ids?.length ?? 0),
              },
            ]),
          ]
        : []),
      await actionRow(issue, [
        {
          label: c(locale, "history"),
          action: "analysisHistory",
          emojiKey: "history",
        },
        {
          label: c(locale, "responseRecords"),
          action: "analysisAttentionList",
          data: { filter: "all" },
        },
        { label: c(locale, "back"), action: "analysisMenu" },
      ]),
    ],
  });
}
export async function analysisComparisonPanel(
  issue: Issue,
  id: string,
  data: AnalysisComparison,
  locale: UiLocale,
) {
  const children: PanelChild[] = [];
  if (data.current)
    children.push(
      callout(
        c(locale, "comparisonCurrent"),
        evidencePeriod(locale, data.current.from, data.current.to),
      ),
    );
  if (data.previous)
    children.push(
      callout(
        c(locale, "comparisonPrevious"),
        evidencePeriod(locale, data.previous.from, data.previous.to),
      ),
    );
  children.push(footer(c(locale, "comparisonConditions")));
  if (data.comparable) {
    children.push(
      ...data.changes.map((m) =>
        callout(
          name(locale, m.key),
          `${metricValue(locale, m.key, m.before, m.unit)} → ${metricValue(locale, m.key, m.after, m.unit)}`,
        ),
      ),
    );
    if (data.unavailableMetrics?.length)
      children.push(
        callout(
          c(locale, "comparisonUnavailableMetrics"),
          data.unavailableMetrics
            .slice(0, 3)
            .map(
              (m) =>
                `${name(locale, m.key)}: ${[...new Set(m.reasons.map((reason) => analysisEvidenceReason(locale, reason)))].slice(0, 2).join(" ")}`,
            )
            .join("\n"),
        ),
      );
  } else
    children.push(
      callout(
        c(locale, "incompatible"),
        data.reasons?.length
          ? [
              ...new Set(
                data.reasons.map((reason) =>
                  analysisEvidenceReason(locale, reason),
                ),
              ),
            ].join("\n")
          : c(locale, "reasonOther"),
      ),
    );
  children.push(footer(c(locale, "unknownsDescription")));
  return nexusPanel({
    title: c(locale, "compare"),
    children,
    rows: [
      await actionRow(issue, [
        {
          label: c(locale, "back"),
          action: "analysisResult",
          data: { runId: id },
        },
        {
          label: c(locale, "history"),
          action: "analysisHistory",
          emojiKey: "history",
        },
        {
          label: c(locale, "responseRecords"),
          action: "analysisAttentionList",
          data: { filter: "all" },
        },
        ...(data.comparable && data.previous
          ? [
              {
                label: c(locale, "view"),
                action: "analysisResult",
                data: { runId: data.previous.runId },
              },
            ]
          : []),
      ]),
    ],
  });
}
export async function analysisAttentionListPanel(
  issue: Issue,
  items: Awaited<ReturnType<AnalysisService["attentionList"]>>,
  offset: number,
  locale: UiLocale,
  filter: "active" | "all" = "active",
) {
  const children: PanelChild[] = [];
  for (const item of items)
    children.push(
      sectionWithAccessory(
        item.evidence.value === null
          ? c(locale, "unknown")
          : c(locale, "waiting", { count: item.evidence.value }),
        `${recordState(locale, item.status)} · ${relative(item.detected_at)}`,
        await actionButton(issue, {
          label: c(locale, "see"),
          action: "analysisAttentionItem",
          data: { key: item.message_id },
        }),
      ),
    );
  if (!items.length)
    children.push(
      callout(c(locale, filter === "all" ? "recordEmpty" : "noReviews"), ""),
    );
  return nexusPanel({
    title: panelIconText(
      "attention",
      c(locale, filter === "all" ? "responseRecords" : "analysisConcerns"),
    ),
    children,
    rows: [
      await actionRow(issue, [
        {
          label: c(locale, "back"),
          action: "analysisAttentionList",
          data: { offset: Math.max(0, offset - 5), filter },
          disabled: offset === 0,
        },
        {
          label: c(locale, "next"),
          action: "analysisAttentionList",
          data: { offset: offset + 5, filter },
          disabled: items.length < 5 || offset >= 995,
        },
        {
          label: c(locale, "home"),
          emojiKey: "overview",
          action: "controlNavigate",
          data: { page: "overview" },
        },
      ]),
      await actionRow(issue, [
        {
          label: c(locale, filter === "all" ? "recordActive" : "recordAll"),
          action: "analysisAttentionList",
          data: { filter: filter === "all" ? "active" : "all" },
        },
        {
          label: c(locale, "history"),
          action: "analysisHistory",
          emojiKey: "history",
        },
      ]),
    ],
  });
}
export async function analysisAttentionConfirmationPanel(
  issue: Issue,
  data: {
    run: AnalysisRun;
    result: AnalysisResult | null;
    canOperate?: boolean;
  },
  concernKey: string,
  duplicate: boolean,
  locale: UiLocale,
) {
  const concern = data.result?.concerns.find((item) => item.key === concernKey);
  if (!concern) throw new Error("ANALYSIS_CONCERN_UNAVAILABLE");
  return nexusPanel({
    title: c(locale, "attentionConfirm"),
    children: [
      callout(
        c(locale, "waiting", { count: concern.value }),
        c(locale, duplicate ? "attentionDuplicate" : "attentionNew"),
      ),
      callout(
        c(locale, "comparisonCurrent"),
        evidencePeriod(
          locale,
          data.run.period_start.toISOString(),
          data.run.period_end.toISOString(),
        ),
      ),
      callout(c(locale, "savedScope"), savedPlaces(locale, data.run)),
      callout(
        c(locale, "evidence"),
        `${evidenceState(locale, concern.evidence)}\n${evidenceDetails(locale, { key: concern.metricKey, unit: "COUNT", quality: "COMPLETE", evidence: concern.evidence })}`,
      ),
      footer(c(locale, "recordOnly")),
      ...(data.canOperate === false
        ? [footer(c(locale, "recordReadOnly"))]
        : []),
    ],
    rows: [
      await actionRow(issue, [
        {
          label: c(locale, "attention"),
          action: "analysisAttentionConfirm",
          data: { runId: data.run.id, concernKey },
          style: ButtonStyle.Primary,
          disabled: duplicate || data.canOperate === false,
        },
        ...(duplicate
          ? [
              {
                label: c(locale, "responseRecords"),
                action: "analysisAttentionItem",
                data: { key: `analysis:${data.run.id}:${concernKey}` },
              },
            ]
          : []),
        {
          label: c(locale, "back"),
          action: "analysisResult",
          data: { runId: data.run.id },
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
  const closed = ["RESOLVED", "DISMISSED"].includes(item.status);
  const runId = item.message_id.split(":")[1];
  return nexusPanel({
    title: panelIconText("attention", c(locale, "analysisConcerns")),
    children: [
      callout(
        item.evidence.value === null
          ? c(locale, "unknown")
          : c(locale, "waiting", { count: item.evidence.value }),
        `${evidenceState(locale, item.evidence)}\n${evidencePeriod(locale, item.evidence.windowStart, item.evidence.windowEnd)}\n${c(locale, "sampleRecords", { count: item.evidence.sampleSize })}`,
      ),
      callout(c(locale, "responseStatus"), recordState(locale, item.status)),
      ...(item.opened_at
        ? [
            footer(
              c(locale, "recordCreatedAt", {
                time: `<t:${Math.floor(item.opened_at.getTime() / 1000)}:f>`,
              }),
            ),
          ]
        : []),
      ...(item.updated_at
        ? [
            footer(
              c(locale, "recordUpdatedAt", {
                time: `<t:${Math.floor(item.updated_at.getTime() / 1000)}:f>`,
              }),
            ),
          ]
        : []),
      callout(
        c(locale, "recordHistory"),
        item.events.length
          ? item.events
              .map(
                (event) =>
                  `${recordState(locale, event.state)} · <t:${Math.floor(event.occurred_at.getTime() / 1000)}:f>`,
              )
              .join("\n")
          : c(locale, "recordHistoryUnknown"),
      ),
      footer(c(locale, "recordOnly")),
      ...(!item.canOperate ? [footer(c(locale, "recordReadOnly"))] : []),
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
          disabled:
            !item.canOperate || closed || item.status === "ACKNOWLEDGED",
        },
        {
          label: c(locale, "recordCompleted"),
          emojiKey: "done",
          action: "analysisAttentionUpdate",
          data: {
            key: item.message_id,
            version: item.version,
            status: "RESOLVED",
          },
          style: ButtonStyle.Primary,
          disabled: !item.canOperate || closed,
        },
        {
          label: c(locale, "recordWithdraw"),
          action: "analysisAttentionUpdate",
          data: {
            key: item.message_id,
            version: item.version,
            status: "DISMISSED",
          },
          disabled: !item.canOperate || closed,
        },
      ]),
      await actionRow(issue, [
        {
          label: c(locale, "back"),
          action: "analysisAttentionList",
          data: { filter: "all" },
        },
        { label: c(locale, "view"), action: "analysisResult", data: { runId } },
        {
          label: c(locale, "compare"),
          action: "analysisCompare",
          data: { runId },
        },
        {
          label: c(locale, "history"),
          action: "analysisHistory",
          emojiKey: "history",
        },
      ]),
    ],
  });
}
