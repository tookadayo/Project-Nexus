import { expect, it } from "vitest";
import {
  chartValue,
  coverageReason,
  evidenceLabel,
  heatMix,
} from "../../apps/web/app/chart-presentation";
import { demoChart, demoPeriods } from "../../apps/web/app/landing/demo-data";
import { safeError } from "../../apps/web/app/safe-error";
it.each(["ja", "en"] as const)(
  "keeps unavailable data, observed zero and access restrictions distinct in %s",
  (locale) => {
    expect(chartValue(null, locale)).not.toBe(chartValue(0, locale));
    expect(safeError("HISTORY_PLAN_LIMIT", locale)).not.toBe(
      evidenceLabel("INSUFFICIENT_SAMPLE", locale),
    );
    expect(safeError("NEXUS_ROLE_REQUIRED", locale)).not.toBe(
      safeError("PLAN_REQUIRED", locale),
    );
    expect(coverageReason("COLLECTION_GAP", locale)).not.toBe(
      coverageReason("INTENT_MESSAGES_UNAVAILABLE", locale),
    );
    expect(
      coverageReason("unknown private driver exception", locale),
    ).not.toContain("driver");
  },
);
it.each(demoPeriods)(
  "keeps the %s-day demo deterministic, partial, and current/previous dates separate",
  (days) => {
    const spec = demoChart(days),
      current = spec.series[0]!,
      previous = spec.series[1]!;
    expect(spec).toEqual(demoChart(days));
    expect(current.points).toHaveLength(days);
    expect(previous.points).toHaveLength(days);
    expect(current.points.some((p) => p.value === null)).toBe(true);
    expect(current.points.some((p) => p.value === 0)).toBe(true);
    expect(spec.evidence.coverageState).toBe("PARTIAL");
    expect(spec.evidence.value).toBe(
      current.points
        .filter((p) => p.value !== null)
        .reduce((sum, p) => sum + p.value!, 0),
    );
    expect(previous.points.at(-1)!.evidence.windowEnd).toBe(
      current.points[0]!.bucket,
    );
    expect(spec.evidence.comparable).toBe(false);
  },
);
it("keeps every generated heatmap text color above 4.5:1 on its cell background", () => {
  const lum = (rgb: number[]) =>
    rgb
      .map((n) => n / 255)
      .reduce(
        (sum, n, i) =>
          sum +
          (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][i]!,
        0,
      );
  for (let i = 0; i <= 100; i++) {
    const ratio = i / 100,
      mix = heatMix(ratio) / 100,
      bg = lum([39, 88, 202].map((v) => Math.round(255 + (v - 255) * mix))),
      fg = ratio > 0.7 ? 1 : lum([23, 33, 43]);
    expect(
      (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
});

it.each(["ja", "en"] as const)(
  "does not infer a server admission state from a generic unavailable error (%s)",
  (locale) => {
    expect(safeError("BETA_UNAVAILABLE", locale)).not.toMatch(
      /停止中|招待済み|登録済み|paused|registered|invited/,
    );
  },
);
