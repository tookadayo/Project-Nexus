import { describe, expect, it } from "vitest";
import {
  chartSvg,
  renderChartPng,
} from "../../packages/analytics/src/chart-renderer";
import {
  chartLinePath,
  chartSummary,
  chartPeriod,
} from "../../packages/analytics/src/chart-language";
import { alpha14ChartFixture } from "../fixtures/alpha14-charts";

describe("alpha14 shared chart presentation", () => {
  it("breaks the daily line at unknown values while keeping an exact zero", () => {
    const path = chartLinePath(
      alpha14ChartFixture().series[0]!.points,
      (i) => i,
      (n) => n,
    );
    expect(path).toBe(
      "M0.00,12.00 L1.00,18.00 M3.00,0.00 L4.00,24.00 L5.00,16.00 L6.00,21.00",
    );
    expect(
      chartLinePath(
        alpha14ChartFixture(true).series[0]!.points,
        (i) => i,
        (n) => n,
      ),
    ).toBe("");
  });
  it("uses the actual daily UTC period and keeps partial coverage and noncomparison visible", () => {
    const spec = alpha14ChartFixture();
    expect(chartPeriod(spec, "ja")).toBe(
      "2026-10-01 — 2026-10-07 · 7日間 · UTC",
    );
    expect(chartSummary(spec, "en")).toContain(
      "Total: 91 recorded activities · Partial data",
    );
    expect(chartSummary(spec, "en")).toContain("not sufficient for comparison");
    expect(chartSummary(spec, "ja")).toContain("合計: 91");
    expect(chartSummary(alpha14ChartFixture(true), "ja")).toContain(
      "合計: 確認できません",
    );
    expect(chartSummary(alpha14ChartFixture(true), "en")).not.toContain(
      "Total: 0",
    );
  });
  it("labels SVGs in both languages, escapes branding, and distinguishes the two series without color alone", () => {
    const spec = alpha14ChartFixture();
    spec.branding = {
      title: "<unsafe & title>",
      footer: "<footer>",
      logoBase64: null,
    };
    const ja = chartSvg(spec, "ja"),
      en = chartSvg(spec, "en");
    expect(ja).toContain("直接の返信");
    expect(ja).toContain("一部のデータのみ");
    expect(ja).toContain("欠測は0件と異なります");
    expect(en).toContain("Current period");
    expect(en).toContain("Previous: 2026-09-24 — 2026-09-30");
    expect(en).toContain("not sufficient to calculate a difference");
    expect(en).toContain('stroke-dasharray="5 4"');
    expect(en).toContain("&lt;unsafe &amp; title&gt;");
    expect(en).not.toMatch(/#c8f169|#131e17|>PARTIAL<|>UNKNOWN</);
    expect(en).toContain('aria-labelledby="title description"');
    const missing = chartSvg(alpha14ChartFixture(true), "en");
    expect(missing).toContain("Daily values are unavailable");
    expect(missing).not.toContain('stroke="#dbe3ef"/><text');
  });
  it("renders distinct Japanese and English PNGs without mixing cached locales", async () => {
    const spec = alpha14ChartFixture();
    const [ja, en, jaAgain] = await Promise.all([
      renderChartPng(spec, "ja"),
      renderChartPng(spec, "en"),
      renderChartPng(spec, "ja"),
    ]);
    expect(ja.equals(en)).toBe(false);
    expect(ja.equals(jaAgain)).toBe(true);
    for (const png of [ja, en]) {
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(1000);
      expect(png.readUInt32BE(20)).toBe(500);
    }
  });
});
