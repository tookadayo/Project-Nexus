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
} from "../../../analysis/src/index";
const relative = (at: Date) => `<t:${Math.floor(at.getTime() / 1000)}:R>`;
const renewal=(locale:UiLocale)=>{
  const now=new Date(),next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
  return c(locale,"monthlyRenewal",{time:`<t:${Math.floor(next.getTime()/1000)}:f>`});
};
const name = (locale: UiLocale, key: string) =>
  localized(locale, metricNames[key] ?? [c(locale, "unknownMetric"), c(locale, "unknownMetric")]);
export const metricValue = (locale: UiLocale, key: string, value: number) => {
  const count = Math.round(value * 100) / 100;
  return c(locale, key === "first_reply_seconds" ? "seconds" : ["new_members", "event_signups", "event_attendance", "poll_participants"].includes(key) ? "people" : key === "voice_copresence" ? "times" : "items", { count });
};
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
  const cost=data.consumeCount;
  const children: PanelChild[] = [
    ...(data.correctionOf?[callout(c(locale,"correctionReview"),c(locale,"correctionFree"))]:[]),
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
      `${c(locale, data.scope.mode)}\n${c(locale,"placesCount",{count:data.targetChannelCount})}`,
    ),
    callout(
      c(locale, "quality"),
      localized(locale, availabilityNames[data.availability]),
    ),
  ];
  if(hasHistoricalPostCoverage(data.metrics))children.push(callout(c(locale,"historicalPostsTitle"),c(locale,"reasonHistoricalPosts")));
  for (const metric of data.metrics.filter(m => m.quality !== "NOT_APPLICABLE").slice(0, 3))
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
    footer(data.estimate ? c(locale, "eta", { range: data.estimate }) : c(locale, "estimateUnknown")),
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
  if (data.usage.remaining === 0 && cost>0) children.push(footer(c(locale, "noUses")));
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
  history: AnalysisRun[] | { runs: AnalysisRun[]; nextCursor: string | null; previousCursor: string | null },
  locale: UiLocale,
  filter: { type?: string; status?: string } = {},
) {
  const page = Array.isArray(history) ? {runs: history, nextCursor: null, previousCursor: null} : history;
  if (page.runs.length > 5) throw new Error("DISCORD_HISTORY_PAGE_LIMIT");
  const children: PanelChild[] = page.runs.length
    ? [] : [callout(c(locale, "empty"), c(locale, "basic"))];
  for (const run of page.runs)
    children.push(sectionWithAccessory(
      localized(locale, analysisNames[run.analysis_type]),
      `${run.invalidated_at ? c(locale,"removedData") : localized(locale, runStatusNames[run.status])}\n${/^(v1|analysis-observation-v1)/.test(run.recipe_version)?c(locale,"oldDefinition")+"\n":""}${c(locale, "periodWindow", {from: run.period_start.toISOString().slice(0,10), through: new Date(run.period_end.getTime()-1).toISOString().slice(0,10)})} · ${relative(run.requested_at)}`,
      await actionButton(issue, {label:c(locale,"view"), action:"analysisResult", data:{runId:run.id},disabled:Boolean(run.invalidated_at)}),
    ));
  return nexusPanel({title:c(locale,"history"), children, rows:[
    {type:ComponentType.ActionRow,components:[{type:ComponentType.StringSelect,custom_id:await issue({action:"analysisHistory",field:"type",status:filter.status}),placeholder:c(locale,"menu"),options:[{label:c(locale,"history"),value:"all",default:!filter.type},...Object.entries(analysisNames).map(([type,names])=>({label:localized(locale,names),value:type,default:type===filter.type}))]}]},
    await actionRow(issue,[
      {label:c(locale,"previousPage"),action:"analysisHistory",data:{...filter,cursor:page.previousCursor,direction:"previous"},disabled:!page.previousCursor},
      {label:c(locale,"nextPage"),action:"analysisHistory",data:{...filter,cursor:page.nextCursor,direction:"next"},disabled:!page.nextCursor},
    ]),
    await actionRow(issue,[{label:c(locale,"back"),action:"analysisMenu"},{label:c(locale,"refresh"),action:"analysisHistory",data:filter}]),
  ]});
}
export async function analysisResultPanel(
  issue: Issue,
  data: { run: AnalysisRun; result: AnalysisResult | null },
  locale: UiLocale,
  notice?: string,
  showEvidence = false,
  detailPage = 0,
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
    children.push(callout(c(locale,"scope"),run.target_channel_ids ? c(locale,"placesCount",{count:run.target_channel_ids.length}) : c(locale,"previousDefinition")));
    if(run.calculated_at)children.push(footer(c(locale,"calculatedAt",{time:`<t:${Math.floor(run.calculated_at.getTime()/1000)}:f>`})));
    if(result.baseline?.changes.length)children.push(callout(c(locale,"changes"),result.baseline.changes.slice(0,2).map(change=>`${name(locale,change.key)}: ${metricValue(locale,change.key,change.before)} → ${metricValue(locale,change.key,change.after)}`).join("\n")));
    if(result.baseline && result.metrics.some(m=>m.evidence.sampleSize<5))children.push(footer(c(locale,"smallSample")));
    children.push(callout(c(locale,"quality"),localized(locale,qualityNames[result.dataQuality])));
    if(hasHistoricalPostCoverage(result.metrics))children.push(callout(c(locale,"historicalPostsTitle"),c(locale,"reasonHistoricalPosts")));
    const metrics = result.metrics.filter(m => m.quality !== "NOT_APPLICABLE");
    const visible = showEvidence ? metrics.slice(detailPage * 5, detailPage * 5 + 5) : metrics.slice(0, 3);
    for (const metric of visible) {
      const measured =
        metric.evidence.value !== null &&
        ["COMPLETE", "PARTIAL"].includes(metric.quality);
      children.push(
        callout(
          name(locale, metric.key),
          `${measured ? metricValue(locale, metric.key, metric.evidence.value!) + "\n" : ""}${localized(locale, qualityNames[metric.quality])}\n${metric.quality==="NO_DATA" ? c(locale,"sampleUnknown") : c(locale,metric.key==="new_members"?"peopleSample":"sample", { count: metric.evidence.sampleSize })}`,
        ),
      );
    }
    children.push(callout(c(locale, "concerns"), result.concerns.length ? result.concerns.map(concern => c(locale, "waiting", {count: concern.value})).join("\n") : c(locale, "noConcerns")));
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
            ? reasons.join("\n")
            : c(locale, "reasonsNone"),
        ),
      );
    }
    if (visible.some(m=>m.key==="first_reply_seconds")) children.push(footer(c(locale,"medianNote")));
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
          label: showEvidence ? c(locale, "view") : c(locale, "details"),
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
        ...(run.status === "QUEUED" ? [{label:c(locale,"cancel"),action:"analysisCancel",data:{runId:run.id}}] : []),
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
      ...(result && run.scope_bug_impact === "POSSIBLE_CATEGORY_PARENT" && run.status === "COMPLETED" && !run.invalidated_at ? [await actionRow(issue,[{label:c(locale,"correctionReview"),action:"analysisPreview",data:{type:run.analysis_type,days:run.period_days,periodStart:run.period_start.toISOString(),periodEnd:run.period_end.toISOString(),correctionOf:run.id}}])] : []),
      ...(result && showEvidence ? [await actionRow(issue,[{label:c(locale,"back"),action:"analysisEvidence",data:{runId:run.id,detailPage:Math.max(0,detailPage-1)},disabled:detailPage===0},{label:c(locale,"next"),action:"analysisEvidence",data:{runId:run.id,detailPage:detailPage+1},disabled:(detailPage+1)*5>=result.metrics.filter(m=>m.quality!=="NOT_APPLICABLE").length}])] : []),
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
          callout(name(locale, m.key), `${metricValue(locale,m.key,m.before)} → ${metricValue(locale,m.key,m.after)}`),
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
      items[index]!.evidence.value === null ? c(locale,"unknown") : c(locale, "waiting", { count: items[index]!.evidence.value! }),
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
export async function analysisAttentionConfirmationPanel(
  issue: Issue,
  data: { run: AnalysisRun; result: AnalysisResult | null },
  concernKey: string,
  duplicate: boolean,
  locale: UiLocale,
) {
  const concern = data.result?.concerns.find(item => item.key === concernKey);
  if (!concern) throw new Error("ANALYSIS_CONCERN_UNAVAILABLE");
  return nexusPanel({title:c(locale,"attentionConfirm"),children:[
    callout(c(locale,"waiting",{count:concern.value}),c(locale,duplicate?"attentionDuplicate":"attentionNew")),
    callout(c(locale,"period"),c(locale,"periodWindow",{from:data.run.period_start.toISOString().slice(0,10),through:new Date(data.run.period_end.getTime()-1).toISOString().slice(0,10)})),
    footer(c(locale,"notes")),
  ],rows:[await actionRow(issue,[
    {label:c(locale,"attention"),action:"analysisAttentionConfirm",data:{runId:data.run.id,concernKey},style:ButtonStyle.Primary,disabled:duplicate},
    {label:c(locale,"back"),action:"analysisResult",data:{runId:data.run.id}},
  ])]});
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
        item.evidence.value === null ? c(locale,"unknown") : c(locale, "waiting", { count: item.evidence.value }),
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
