import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  AvailabilityMark,
  FeatureComparison,
  comparisonGroups,
  comparisonRows,
} from "../../apps/web/app/pricing/comparison";
import { PricingFaq } from "../../apps/web/app/pricing/faq";
import { planRegistry, plans } from "../../packages/settings/src/plan-registry";
const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createElement } = requireWeb("react") as typeof import("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server") as {
  renderToStaticMarkup: (node: ReactNode) => string;
};
const baseline = JSON.parse(
  readFileSync(
    new URL("../fixtures/pricing-comparison-baseline.json", import.meta.url),
    "utf8",
  ),
);
describe("pricing comparison and FAQ", () => {
  it("preserves every original row ID, all 220 booleans and all 60 limits", () => {
    expect(plans).toEqual(baseline.plans);
    expect(comparisonRows.map(({ id, values }) => ({ id, values }))).toEqual(
      baseline.rows,
    );
    expect(
      Object.fromEntries(
        plans.map((plan) => [plan, planRegistry[plan].limits]),
      ),
    ).toEqual(baseline.limits);
    const ids = comparisonGroups.flatMap((group) =>
      group.rows.map((row) => row.id),
    );
    expect(ids.length).toBe(44);
    expect(new Set(ids).size).toBe(44);
    expect(ids.sort()).toEqual(
      baseline.rows.map((row: { id: string }) => row.id).sort(),
    );
  });
  it("groups shared then Starter / Growth / Scale, without an empty Enterprise group", () => {
    expect(comparisonGroups.map((group) => group.key)).toEqual([
      "FREE",
      "STARTER",
      "GROWTH",
      "SCALE",
    ]);
    for (const group of comparisonGroups)
      for (const row of group.rows) {
        expect(row.firstPlan).toBe(group.key);
        expect(row.conditional).toBe(false);
        const first = row.values.indexOf(true);
        expect(row.values.slice(0, first).every((value) => !value)).toBe(true);
        expect(row.values.slice(first).every(Boolean)).toBe(true);
      }
  });
  for (const locale of ["ja", "en"] as const) {
    it(
      "renders identifiable cells and distinct accessible symbols: " + locale,
      () => {
        const html = renderToStaticMarkup(
          createElement(FeatureComparison, { locale }),
        );
        for (const row of comparisonRows) {
          expect(html).toContain('data-feature-id="' + row.id + '"');
        }
        expect(html.match(/data-included="/g)).toHaveLength(220);
        expect(html).toContain(
          'class="comparison-mark comparison-mark-included"><span aria-hidden="true">✓</span>',
        );
        expect(html).toContain(
          'class="comparison-mark comparison-mark-excluded"><span aria-hidden="true">−</span>',
        );
        expect(html).toContain(locale === "ja" ? "利用可能" : "Included");
        expect(html).toContain(locale === "ja" ? "対象外" : "Not included");
        expect(html).toContain('aria-describedby="feature-comparison-hint"');
        expect(html).toContain('tabindex="0"');
        for (const state of ["planned", "unknown"] as const) {
          const value = renderToStaticMarkup(
            createElement(AvailabilityMark, { state, locale }),
          );
          expect(value).not.toMatch(/✓|−|comparison-mark-excluded/);
          expect(value).toContain("comparison-state-text");
        }
      },
    );
    it(
      "explains count, uncertainty, scope, grace and launch preparation without internal jargon: " +
        locale,
      () => {
        const html = renderToStaticMarkup(
          createElement(PricingFaq, { locale, purchaseMode: "closed" }),
        );
        expect(html.match(/<details/g)).toHaveLength(5);
        expect(html).not.toMatch(
          /UNKNOWN|PARTIAL|Sandbox|Voice同席|測定根拠|プライバシー保持設定/,
        );
        expect(html).toContain("UTC");
        expect(html).toContain(locale === "ja" ? "参加・退出" : "join, leave");
        expect(html).toContain(
          locale === "ja" ? "招待期限" : "Invitation expiry",
        );
        expect(html).toContain(
          locale === "ja" ? "標準30日" : "standard 30-day",
        );
        expect(html).toContain(
          locale === "ja"
            ? "必ず残る・復元できるという保証ではなく"
            : "does not guarantee preservation or recovery",
        );
        expect(html).toContain(
          locale === "ja" ? "開始を準備しています" : "preparing to launch",
        );
        expect(html).toContain('href="#invitation-beta"');
        expect(html).not.toMatch(/href="\/privacy"|href="\/checkout|<form/);
      },
    );
    it(
      "labels only the verified payment-test branch as testing: " + locale,
      () => {
        const sandbox = renderToStaticMarkup(
          createElement(PricingFaq, { locale, purchaseMode: "sandbox" }),
        );
        const live = renderToStaticMarkup(
          createElement(PricingFaq, { locale, purchaseMode: "live" }),
        );
        expect(sandbox).toContain(
          locale === "ja"
            ? "実際の請求は発生しません"
            : "do not create real charges",
        );
        expect(live).not.toContain(
          locale === "ja"
            ? "実際の請求は発生しません"
            : "do not create real charges",
        );
        expect(live).toContain(
          locale === "ja" ? "決済側の契約確認" : "payment provider confirms",
        );
      },
    );
  }
});
