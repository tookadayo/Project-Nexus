import { createRequire } from "node:module";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Pricing from "../../apps/web/app/pricing/page";
import { CheckoutReview } from "../../apps/web/app/checkout/review/controls";
import { offeringAmount } from "../../apps/web/app/checkout/order";
import type { PublicBillingCatalog } from "../../apps/web/app/billing/catalog";
import { planRegistry, plans } from "../../packages/settings/src/plan-registry";
import { commercialLaunch } from "../../packages/settings/src/billing/commerce";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createElement } = requireWeb("react") as typeof import("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server") as {
  renderToStaticMarkup: (node: ReactNode) => string;
};
const state = vi.hoisted(() => ({
  locale: "en" as "ja" | "en",
  catalog: null as PublicBillingCatalog | null,
}));
vi.mock("../../apps/web/app/public-ui", () => ({
  siteLocale: async () => state.locale,
  copy: <T>(locale: "ja" | "en", ja: T, en: T) => (locale === "ja" ? ja : en),
  SiteShell: ({ children }: { children: ReactNode }) =>
    createElement("main", {}, children),
}));
vi.mock("../../apps/web/app/billing/catalog", () => ({
  publicBillingCatalog: async () => state.catalog,
}));
const sandbox = () =>
  commercialLaunch({
    NODE_ENV: "test",
    NEXUS_STRIPE_ENABLED: "true",
    NEXUS_STRIPE_MODE: "SANDBOX",
    STRIPE_SECRET_KEY: "sk_test_synthetic_pricing_fixture",
  });
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  plan_key: "STARTER" as const,
  currency: "USD" as const,
  final_price_minor: 1587,
  tax_behavior: "EXCLUSIVE" as const,
};
beforeEach(() => {
  state.catalog = {
    launch: commercialLaunch({ NODE_ENV: "test" }),
    status: "CLOSED",
    offerings: [],
  };
});
const render = async () =>
  renderToStaticMarkup(await Pricing())
    .replaceAll("&nbsp;", " ")
    .replaceAll("\u00a0", " ");
describe("Stripe-backed pricing presentation", () => {
  for (const locale of ["ja", "en"] as const) {
    it(
      "keeps ordered, concise cards linked to the full comparison (" +
        locale +
        ")",
      async () => {
        state.locale = locale;
        const html = await render();
        const cards = [
          ...html.matchAll(
            /<article class="price-card r3-price-card"[^>]*data-pricing-plan="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g,
          ),
        ];
        expect(cards.map((card) => card[1])).toEqual(plans);
        expect(html).toContain(
          locale === "ja" ? "プランを比較する" : "Compare plans",
        );
        expect(html).not.toMatch(/site-eyebrow|COMMUNITY WORKFLOWS|>PLANS</);
        const expected = [
          ["core_observation", "fallback_onboarding", "interventions"],
          ["csv_export", "saved_views", "heatmaps"],
          ["attention_escalation", "scheduled_reports", "attention_inbox"],
          ["multi_guild", "rbac", "audit_export"],
          [],
        ];
        for (let index = 0; index < cards.length; index++) {
          const body = cards[index]![2]!,
            plan = plans[index]!;
          const parts = [
            "r3-plan-name",
            "r3-plan-purpose",
            "r3-plan-price",
            "r3-plan-cta",
            "r3-plan-conditions",
            "r3-plan-features",
            "r3-plan-details",
          ];
          const positions = parts.map((name) => body.indexOf(name));
          expect(positions.every((value) => value >= 0)).toBe(true);
          expect(positions).toEqual([...positions].sort((a, b) => a - b));
          const ids = [
            ...body.matchAll(/data-highlight-feature="([^"]+)"/g),
          ].map((match) => match[1]);
          expect(ids).toEqual(expected[index]);
          for (const id of ids) {
            expect(planRegistry[plan].features).toContain(id);
          }
          expect(body).toContain('href="#feature-comparison-title"');
          expect(body).toContain('href="/support"');
        }
        expect(cards[4]![2]).toContain(
          locale === "ja"
            ? "Scaleの利用可能な機能を含みます。"
            : "Includes available Scale features.",
        );
        expect(html).toContain('id="feature-comparison-title"');
        expect(html).toContain('id="plan-limits"');
        expect(html).toContain(
          locale === "ja" ? "プリセットを1つ" : "one matching preset recipe",
        );
      },
    );
  }

  for (const locale of ["ja", "en"] as const) {
    it(`keeps Closed Beta 1 free and unpublished prices hidden (${locale})`, async () => {
      state.locale = locale;
      const html = await render();
      expect(html).toContain("Closed Beta 1");
      expect(html).toContain(
        locale === "ja"
          ? "第6の料金プランではありません"
          : "not a sixth subscription plan",
      );
      expect(html).toContain(
        locale === "ja" ? "価格は未公開" : "Price not published",
      );
      expect(html).not.toMatch(/(?:USD|\$)\s*(?:15|49|149)(?:\D|$)/);
      expect(html).not.toContain('href="/checkout?');
      expect(html).not.toContain("stripe-pricing-table");
      expect(html).not.toContain("js.stripe.com");
      expect(html).toContain('href="/billing/manage"');
    });
    it(`uses the mapped amount including cents, tax and internal Offering link (${locale})`, async () => {
      state.locale = locale;
      state.catalog = { launch: sandbox(), status: "READY", offerings: [row] };
      const html = await render();
      expect(html).toContain("USD 15.87");
      expect(html).not.toContain("USD 16");
      expect(html).not.toMatch(/(?:USD|\$)\s*(?:49|149)(?:\D|$)/);
      expect(html).toContain(locale === "ja" ? "税別" : "Tax exclusive");
      expect(html).toContain(
        locale === "ja" ? "月ごとに更新" : "Renews monthly",
      );
      expect(html).toContain(
        locale === "ja" ? "STARTERをSandboxで確認" : "Test Starter in Sandbox",
      );
      expect(html).toContain(`href="/checkout?offering=${row.id}"`);
      expect(html.match(/href="\/checkout\?/g)).toHaveLength(1);
      expect(html).toContain(
        locale === "ja" ? "実際の請求はありません" : "No real-money charge",
      );
      expect(html).not.toContain("sk_test_");
    });
    for (const status of ["UNAVAILABLE", "EMPTY"] as const) {
      it(`keeps comparison and billing recovery available when catalog is ${status} (${locale})`, async () => {
        state.locale = locale;
        state.catalog = { launch: sandbox(), status, offerings: [] };
        const html = await render();
        expect(html).toContain('role="status"');
        expect(html).not.toContain('href="/checkout?');
        expect(html).not.toMatch(/(?:USD|\$)\s*\d/);
        expect(html).toContain('href="/billing/manage"');
        expect(html).toContain("<table>");
        if (status === "UNAVAILABLE") expect(html).toContain('href="/pricing"');
      });
    }
    it(`renders the same amount and tax in the purchase review (${locale})`, () => {
      const html = renderToStaticMarkup(
        createElement(CheckoutReview, {
          connected: true,
          taxBehavior: "INCLUSIVE",
          order: {
            offeringId: row.id,
            plan: "STARTER",
            guildId: "922222222222222222",
            guildName: "Synthetic community",
            currency: "USD",
            amountMinor: 1587,
            locale,
            sandbox: true,
          },
        }),
      )
        .replaceAll("&nbsp;", " ")
        .replaceAll("\u00a0", " ");
      expect(html).toContain("USD 15.87");
      expect(html).toContain(locale === "ja" ? "税込" : "Tax inclusive");
      expect(html).toContain(
        locale === "ja" ? "Stripeの決済画面" : "Stripe payment form",
      );
    });
  }
  it("does not confuse a closed public catalog with enabled internal checkout", async () => {
    state.locale = "en";
    state.catalog = {
      launch: { ...sandbox(), publishPrices: false, publicSalesEnabled: false },
      status: "CLOSED",
      offerings: [],
    };
    const html = await render();
    expect(html).not.toContain('href="/checkout?');
    expect(html).not.toContain("Test purchases are available");
    expect(html).toContain(
      "Paid plan prices are not published. Purchases are currently unavailable.",
    );
  });
  it("shows inclusive tax without presenting Sandbox labels as live purchase labels", async () => {
    state.locale = "en";
    state.catalog = {
      launch: { ...sandbox(), mode: "LIVE", livemode: true },
      status: "READY",
      offerings: [{ ...row, tax_behavior: "INCLUSIVE" }],
    };
    const html = await render();
    expect(html).toContain("Tax inclusive");
    expect(html).toContain("Choose Starter");
    expect(html).not.toContain("Test Starter in Sandbox");
    expect(html).not.toContain("paid checkout are not open");
  });
  it("retains zero and fractional USD amounts instead of treating zero as missing", () => {
    expect(
      offeringAmount({ locale: "en", currency: "USD", amountMinor: 0 }),
    ).toMatch(/USD\s0\.00/);
    expect(
      offeringAmount({ locale: "ja", currency: "USD", amountMinor: 1 }),
    ).toMatch(/USD\s0\.01/);
  });
});
