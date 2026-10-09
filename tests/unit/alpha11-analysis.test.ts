import { expect, it } from "vitest";
import {
  analysisRecipeVersion,
  type AnalysisMetric,
  type AnalysisResult,
} from "../../packages/analysis/src/domain";
import { compareAnalyses } from "../../packages/analysis/src/comparison";
import { metricEvidence } from "../../packages/shared/src/metric-evidence";
import { measurementDefinition } from "../../packages/shared/src/measurement-definitions";
import {
  analysisResultPanel,
  analysisComparisonPanel,
  analysisAttentionItemPanel,
  analysisHistoryPanel,
  analysisAttentionListPanel,
  metricValue,
} from "../../packages/discord-panels/src/views/analysis";
import { basicAnalysisPanel } from "../../packages/discord-panels/src/views/basic-analysis";
import {
  evidenceState,
  metricDescription,
} from "../../packages/discord-panels/src/views/analysis-evidence";
import { validatePanel } from "../../packages/discord-panels/src/primitives";
import { errorPanel } from "../../packages/discord-panels/src/views/errors";
import { errorCategory } from "../../packages/shared/src/errors";
import { DomainError } from "../../packages/shared/src/index";
import type { Issue } from "../../packages/discord-panels/src/types";
import { run, result } from "../fixtures/analysis-panels";

function capture() {
  const intents: Record<string, unknown>[] = [];
  const issue: Issue = async (intent) => {
    intents.push(intent);
    return "private:" + "a".repeat(60);
  };
  return { issue, intents };
}
function metric(
  key = "observed_posts",
  definition = "analysisPosts",
  value: number | null = 0,
): AnalysisMetric {
  const def = measurementDefinition(definition);
  return {
    key,
    unit: key === "first_reply_seconds" ? "SECONDS" : "COUNT",
    quality: "COMPLETE",
    evidence: metricEvidence({
      metricKey: key,
      definitionVersion: `${analysisRecipeVersion}:${def.version}:OVERALL`,
      definition: def.version,
      value,
      numerator: value,
      denominator: null,
      sampleSize: value ?? 0,
      minimumSample: 0,
      requiredSurfaces: def.surfaces,
      evidenceSources: def.sources,
      coverageState: "COMPLETE",
      coverageReasons: [],
      windowStart: run.period_start.toISOString(),
      windowEnd: run.period_end.toISOString(),
      collectionEpochIds: [run.id],
    }),
  };
}
function saved(metrics: AnalysisMetric[]): AnalysisResult {
  return { ...result, metrics, dataQuality: "COMPLETE" };
}
it.each(["flag", "reversed", "empty", "epochs"] as const)(
  "does not compare unconfirmed evidence with %s",
  (cause) => {
    const previous = prior();
    const e = previous.result.metrics[0]!.evidence;
    if (cause === "flag") e.comparable = false;
    if (cause === "reversed")
      e.windowEnd = new Date(Date.parse(e.windowStart) - 1).toISOString();
    if (cause === "empty") e.windowEnd = e.windowStart;
    if (cause === "epochs") e.collectionEpochIds = [];
    const compared = compareAnalyses(run, saved([metric()]), previous);
    expect(compared.comparable).toBe(false);
    expect(compared.changes).toEqual([]);
    expect(compared.reasons?.length).toBeGreaterThan(0);
  },
);
it.each(["ja", "en"] as const)(
  "keeps a large saved scope and extensive missing-data reasons within Discord limits (%s)",
  async (locale) => {
    const { issue } = capture();
    const reasons = [
      "INTENT_MESSAGES_UNAVAILABLE",
      "COLLECTION_GAP",
      "COLLECTION_NOT_STARTED",
      "LEGACY_PARTICIPANT_ONLY_COVERAGE",
      "SELECTED_LOCATION_UNAVAILABLE",
      "LEGACY_REPLY_SEMANTICS_UNKNOWN",
      "RECIPE_CHANGED_OR_LEGACY",
      "STAFF_CLASSIFICATION_UNOBSERVED",
      "SAFETY_CONTEXT",
      "EPOCH_LIMIT",
      "INSUFFICIENT_SAMPLE",
      "NO_ELIGIBLE",
      "EPOCH_UNKNOWN",
      "SCOPE_MISMATCH",
      "WINDOW_MISMATCH",
      "METHOD_MISMATCH",
      "METRIC_MISSING",
    ];
    const measures = [
      metric("observed_posts", "analysisPosts", 2),
      metric("observed_replies", "analysisReplies", 1),
      metric("first_reply_seconds", "analysisReplyLatency", 20),
    ];
    for (const m of measures) {
      m.evidence.coverageState = "PARTIAL";
      m.evidence.coverageReasons = reasons;
      m.evidence.comparisonBlockers = reasons;
      m.evidence.comparable = false;
    }
    const data = {
      run: {
        ...run,
        target_channel_ids: Array.from({ length: 230 }, (_, i) =>
          String(700000000000000000n + BigInt(i)),
        ),
      },
      result: saved(measures),
    };
    validatePanel(await analysisResultPanel(issue, data, locale));
    validatePanel(
      await analysisResultPanel(issue, data, locale, undefined, true),
    );
    validatePanel(
      await analysisComparisonPanel(
        issue,
        run.id,
        compareAnalyses(data.run, data.result, prior(measures)),
        locale,
      ),
    );
  },
);
function prior(metrics = [metric()]) {
  const end = new Date(run.period_start.getTime() - 3 * 86400000),
    start = new Date(end.getTime() - run.period_days * 86400000);
  return {
    run: {
      ...run,
      id: "bb0c766f-1d0e-4ad9-a860-d2d9797f632f",
      period_start: start,
      period_end: end,
    },
    result: saved(
      metrics.map((m) => ({
        ...m,
        evidence: {
          ...m.evidence,
          windowStart: start.toISOString(),
          windowEnd: end.toISOString(),
        },
      })),
    ),
  };
}
it.each(["ja", "en"] as const)(
  "explains confirmed values, period, sources, missing data and saved-place navigation (%s)",
  async (locale) => {
    const { issue, intents } = capture();
    const posts = metric("observed_posts", "analysisPosts", 12),
      missing = metric("observed_replies", "analysisReplies", null);
    missing.evidence.observationState = "UNKNOWN";
    missing.evidence.coverageState = "UNKNOWN";
    missing.evidence.coverageReasons = ["INTENT_MESSAGES_UNAVAILABLE"];
    const ids = Array.from({ length: 12 }, (_, i) =>
      String(700000000000000000n + BigInt(i)),
    );
    const data = {
      run: { ...run, target_channel_ids: ids },
      result: saved([posts, missing]),
    };
    const panel = await analysisResultPanel(issue, data, locale);
    validatePanel(panel);
    const text = JSON.stringify(panel);
    expect(text).toContain(locale === "ja" ? "12件" : "12 items");
    expect(text).toContain(`<#${ids[0]}>`);
    expect(text).not.toContain("INTENT_MESSAGES_UNAVAILABLE");
    expect(text).toContain(
      locale === "ja"
        ? "必要な場所や機能を確認できていません"
        : "Some required places or features could not be checked",
    );
    expect(text).toContain(
      locale === "ja"
        ? "変化だけで原因や対応の効果を判断できません"
        : "Changes alone do not establish causes or effects",
    );
    expect(intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "analysisAttentionList",
          filter: "all",
        }),
        expect.objectContaining({ action: "analysisCompare", runId: run.id }),
        expect.objectContaining({ action: "analysisHistory" }),
      ]),
    );
    const detail = await analysisResultPanel(
      issue,
      data,
      locale,
      undefined,
      true,
      0,
      1,
    );
    validatePanel(detail);
    expect(JSON.stringify(detail)).toContain(`<#${ids[5]}>`);
    expect(JSON.stringify(detail)).not.toContain(`<#${ids[0]}>`);
    expect(JSON.stringify(detail)).toContain(
      locale === "ja" ? "集計期間:" : "Period covered:",
    );
    expect(JSON.stringify(detail)).toContain(
      locale === "ja" ? "投稿・返信の作成" : "message and reply creation",
    );
    expect(JSON.stringify(detail)).not.toMatch(
      /MESSAGE_CREATE|Evidence|Coverage|観測/,
    );
  },
);
it.each(["ja", "en"] as const)(
  "keeps an actual zero and a small sample distinct from unknown, collecting and no eligible data (%s)",
  async (locale) => {
    const { issue } = capture();
    const latency = metric("first_reply_seconds", "analysisReplyLatency", 15);
    latency.evidence.sampleSize = 2;
    latency.evidence.observationState = "INSUFFICIENT_SAMPLE";
    latency.evidence.comparisonBlockers = ["INSUFFICIENT_SAMPLE"];
    const panel = await analysisResultPanel(
      issue,
      { run, result: saved([metric(), latency]) },
      locale,
    );
    expect(JSON.stringify(panel)).toContain(
      locale === "ja" ? "0件" : "0 items",
    );
    expect(JSON.stringify(panel)).toContain(
      locale === "ja" ? "15秒" : "15 seconds",
    );
    for (const state of ["UNKNOWN", "COLLECTING", "NO_ELIGIBLE"] as const) {
      const m = metric();
      m.evidence.value = null;
      m.evidence.observationState = state;
      const p = await analysisResultPanel(
        issue,
        { run, result: saved([m]) },
        locale,
      );
      validatePanel(p);
      const values = (
        p.components![0] as { components: { content?: string }[] }
      ).components
        .map((component) => component.content)
        .filter((content): content is string => Boolean(content));
      const value = values
        .find((content) =>
          content.startsWith(
            locale === "ja" ? "**確認できた投稿**" : "**Recorded posts**",
          ),
        )!
        .split("\n")[1];
      expect(value).toBe(
        locale === "ja" ? "値を確認できません。" : "The value is unavailable.",
      );
      expect(value).not.toMatch(/^0(?:件| items)?$/);
      expect(evidenceState(locale, m.evidence)).not.toContain(
        locale === "ja" ? "確認できています" : "Confirmed within",
      );
    }
    const lower = metric();
    lower.evidence.coverageState = "LOWER_BOUND";
    expect(evidenceState(locale, lower.evidence)).toContain(
      locale === "ja" ? "総数は分かりません" : "the total is unknown",
    );
  },
);
it.each(["ja", "en"] as const)(
  "uses participant units for voice, record counts for events, and avoids applying current definitions to legacy values (%s)",
  async (locale) => {
    expect(metricValue(locale, "voice_copresence", 3)).toContain(
      locale === "ja" ? "人" : "people",
    );
    expect(metricValue(locale, "event_signups", 3)).toContain(
      locale === "ja" ? "件" : "items",
    );
    expect(metricValue(locale, "event_attendance", 3)).toContain(
      locale === "ja" ? "件" : "items",
    );
    const legacy = metric();
    legacy.evidence.definitionVersion = "unverified-version";
    expect(metricDescription(locale, legacy, "OVERALL")).toContain(
      locale === "ja" ? "現在の" : "current",
    );
    const { issue } = capture();
    const basic = await basicAnalysisPanel(
      issue,
      {
        basicAnalysis: {
          result: saved([metric("voice_copresence", "voiceCopresence", 3)]),
          from: run.period_start,
          to: run.period_end,
          channelCount: 1,
        },
      },
      locale,
      "voice",
    );
    validatePanel(basic);
    expect(JSON.stringify(basic)).toContain(
      locale === "ja" ? "3人" : "3 people",
    );
  },
);
it("compares matching definitions and methods across equal non-overlapping periods with different calendar dates", () => {
  const comparison = compareAnalyses(run, saved([metric()]), prior());
  expect(comparison.comparable).toBe(true);
  expect(comparison.current?.from).not.toBe(comparison.previous?.from);
  expect(comparison.changes).toEqual([
    { key: "observed_posts", before: 0, after: 0, unit: "COUNT" },
  ]);
});
it.each(["scope", "recipe", "window", "definition", "unit", "gap"] as const)(
  "explains incompatible %s rather than treating equal day counts as sufficient",
  (cause) => {
    const previous = prior();
    if (cause === "scope") previous.run.scope_identity = "different";
    if (cause === "recipe") previous.run.recipe_version = "different";
    if (cause === "window")
      previous.run.period_end = new Date(run.period_start.getTime() + 86400000);
    if (cause === "definition")
      previous.result.metrics[0]!.evidence.definitionVersion = "different";
    if (cause === "unit") previous.result.metrics[0]!.unit = "SECONDS";
    if (cause === "gap")
      previous.result.metrics[0]!.evidence.comparisonBlockers = [
        "COLLECTION_GAP",
      ];
    const comparison = compareAnalyses(run, saved([metric()]), previous);
    expect(comparison.comparable).toBe(false);
    expect(comparison.changes).toEqual([]);
    expect(comparison.reasons).toContain(
      {
        scope: "SCOPE_MISMATCH",
        recipe: "RECIPE_MISMATCH",
        window: "WINDOW_MISMATCH",
        definition: "DEFINITION_MISMATCH",
        unit: "METHOD_MISMATCH",
        gap: "COLLECTION_GAP",
      }[cause],
    );
  },
);
it.each(["ja", "en"] as const)(
  "shows comparison reasons, excludes missing measures and retains result/history/follow-up navigation (%s)",
  async (locale) => {
    const { issue, intents } = capture();
    const previous = prior();
    previous.run.scope_identity = "different";
    const incompatible = await analysisComparisonPanel(
      issue,
      run.id,
      compareAnalyses(run, saved([metric()]), previous),
      locale,
    );
    validatePanel(incompatible);
    expect(JSON.stringify(incompatible)).toContain(
      locale === "ja"
        ? "対象範囲または用途が異なります"
        : "scope or purposes differ",
    );
    expect(JSON.stringify(incompatible)).not.toContain("SCOPE_MISMATCH");
    const missing = metric("observed_replies", "analysisReplies", null);
    const comparison = compareAnalyses(
      run,
      saved([metric(), missing]),
      prior([metric(), missing]),
    );
    expect(comparison.comparable).toBe(true);
    expect(comparison.changes).toHaveLength(1);
    expect(
      JSON.stringify(
        await analysisComparisonPanel(issue, run.id, comparison, locale),
      ),
    ).toContain(
      locale === "ja" ? "比較に含めていない指標" : "Measures excluded",
    );
    expect(intents.some((intent) => intent.action === "analysisHistory")).toBe(
      true,
    );
  },
);
it.each(["ja", "en"] as const)(
  "shows existing follow-up history without equating completion with resolution, and disables unauthorized changes (%s)",
  async (locale) => {
    const { issue, intents } = capture(),
      key = `analysis:${run.id}:waiting_response`;
    const item = {
      message_id: key,
      version: 1,
      status: "ACKNOWLEDGED",
      evidence: metric("waiting_response", "analysisWaiting", 2).evidence,
      detected_at: run.requested_at,
      opened_at: run.requested_at,
      updated_at: run.requested_at,
      acknowledged_at: run.requested_at,
      resolved_at: null,
      canOperate: false,
      events: [
        { state: "ACKNOWLEDGED", version: 1, occurred_at: run.requested_at },
        { state: "OPEN", version: 0, occurred_at: run.requested_at },
      ],
    };
    const panel = await analysisAttentionItemPanel(issue, item, locale);
    validatePanel(panel);
    expect(JSON.stringify(panel)).toContain(
      locale === "ja"
        ? "保存した分析値は変わりません"
        : "Saved analysis values stay unchanged",
    );
    expect(JSON.stringify(panel)).toContain(
      locale === "ja" ? "閲覧のみ" : "You can view",
    );
    const buttons = (
      panel.components![0] as {
        components: { components?: { disabled?: boolean }[] }[];
      }
    ).components.flatMap((c) => c.components ?? []);
    expect(buttons.slice(0, 3).every((button) => button.disabled)).toBe(true);
    expect(
      intents.some(
        (intent) =>
          intent.action === "analysisAttentionUpdate" &&
          intent.status === "DISMISSED",
      ),
    ).toBe(true);
    expect(
      intents.some(
        (intent) =>
          intent.action === "analysisResult" && intent.runId === run.id,
      ),
    ).toBe(true);
    const e = item.evidence;
    const data = {
      run,
      result: {
        ...saved([metric()]),
        concerns: [
          {
            key: "waiting_response",
            metricKey: "waiting_response",
            reason: "WAITING_RESPONSE" as const,
            value: 2,
            evidence: e,
          },
        ],
      },
      reviews: [{ message_id: key, status: "DISMISSED" }],
      canOperate: false,
    };
    const savedPanel = await analysisResultPanel(issue, data, locale);
    validatePanel(savedPanel);
    expect(intents).toContainEqual({ action: "analysisAttentionItem", key });
  },
);
it.each(["ja", "en"] as const)(
  "supports empty histories and unavailable-result recovery without revealing internal codes (%s)",
  async (locale) => {
    const { issue, intents } = capture();
    validatePanel(await analysisHistoryPanel(issue, [], locale));
    validatePanel(
      await analysisAttentionListPanel(issue, [], 0, locale, "all"),
    );
    const category = errorCategory(new DomainError("ANALYSIS_NOT_FOUND", 404));
    expect(category).toBe("ANALYSIS_RESULT");
    const panel = await errorPanel(
      issue,
      { category, effect: "NOT_STARTED" },
      locale,
    );
    validatePanel(panel);
    expect(JSON.stringify(panel)).not.toContain("ANALYSIS_NOT_FOUND");
    expect(intents.some((intent) => intent.action === "analysisHistory")).toBe(
      true,
    );
    expect(
      errorCategory(new DomainError("ANALYSIS_TARGET_UNAVAILABLE", 403)),
    ).toBe("PERMISSION");
  },
);
