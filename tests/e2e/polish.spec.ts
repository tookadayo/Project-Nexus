import { test, expect } from "@playwright/test";

for (const locale of ["en", "ja"] as const) {
  test(`polish: public mobile navigation, pricing and landing (${locale})`, async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "nexus_locale",
        value: locale,
        url: process.env.NEXUS_E2E_WEB_PORT
          ? `http://127.0.0.1:${process.env.NEXUS_E2E_WEB_PORT}`
          : "http://127.0.0.1:3100",
      },
    ]);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".nx-faq details")).toHaveCount(4);
    const menu = page.locator(".nx-mobile-menu");
    await page
      .getByRole("button", {
        name: locale === "ja" ? "メニューを開く" : "Open menu",
        exact: true,
      })
      .click();
    await expect(
      menu.getByRole("link", {
        name: locale === "ja" ? "ログイン" : "Log in",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "English", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-mobile-menu.png`,
      fullPage: false,
    });
    await menu
      .getByRole("link", {
        name: locale === "ja" ? "プラン" : "Pricing",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator(".planned-features")).toHaveCount(0);
    await expect(page.getByRole("table")).not.toContainText(
      /Planned|準備中|AI explanations|AIによる説明|Google Calendar|SAML|SCIM/,
    );
    await expect(page.locator("main")).toContainText(
      locale === "ja"
        ? "有料決済は準備中。価格は承認後に公開。"
        : "Paid checkout is being prepared. Prices await approval.",
    );
    for (const plan of ["Scale", "Enterprise"]) {
      const card = page.locator(".price-card").filter({
        has: page.locator(".site-eyebrow", { hasText: plan.toUpperCase() }),
      });
      await expect(card.locator("li")).not.toHaveCount(0);
      await expect(card).toContainText(
        locale === "ja" ? "現在利用可能" : "Available features",
      );
      await expect(card).toContainText(
        plan === "Scale"
          ? locale === "ja"
            ? "730日の集計履歴"
            : "730 days of aggregate history"
          : locale === "ja"
            ? "個別にお問い合わせ"
            : "custom usage terms",
      );
      await expect(card).not.toContainText(
        /SAML|SCIM|Ask NEXUS|Google Calendar sync|AI explanations|AIによる説明/,
      );
      await expect(card).not.toContainText("$149");
    }
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .filter(
          (element) =>
            element.getBoundingClientRect().right > innerWidth + 1 &&
            getComputedStyle(element).display !== "none" &&
            !element.closest(".comparison-scroll"),
        )
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: element.getBoundingClientRect().right,
        }))
        .slice(0, 10),
    );
    expect(overflow).toEqual([]);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("body")).toHaveCSS("margin", "0px");
    const width = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: innerWidth,
      overflow: Array.from(document.querySelectorAll("body *"))
        .filter(
          (e) =>
            e.scrollWidth > e.clientWidth + 1 &&
            !e.closest(".comparison-scroll"),
        )
        .map((e) => ({
          tag: e.tagName,
          className: e.className,
          width: e.clientWidth,
          scroll: e.scrollWidth,
        }))
        .slice(0, 20),
    }));
    expect(width.document, JSON.stringify(width)).toBeLessThanOrEqual(
      width.viewport + 1,
    );
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-pricing-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-pricing-desktop.png`,
      fullPage: true,
    });
    await page.goto("/");
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-landing-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-landing-mobile.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: locale === "ja" ? "メニューを開く" : "Open menu",
        exact: true,
      })
      .click();
    await page
      .locator(".nx-mobile-menu")
      .getByRole("link", {
        name: locale === "ja" ? "ログイン" : "Log in",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/(dashboard|servers)/);
  });
  test(`polish: rules explain observed activity and dashboard adapts to mobile (${locale})`, async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "nexus_locale",
        value: locale,
        url: process.env.NEXUS_E2E_WEB_PORT
          ? `http://127.0.0.1:${process.env.NEXUS_E2E_WEB_PORT}`
          : "http://127.0.0.1:3100",
      },
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-dashboard-desktop.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: locale === "ja" ? "目標と判定ルール" : "Goals & Rules",
        exact: true,
      })
      .click();
    const intro = page.getByTestId("adaptive-community");
    await expect(intro).toContainText(locale === "ja" ? "対象:" : "Sample:");
    await expect(intro).not.toContainText(
      locale === "ja" ? "観測中です" : "Still collecting",
    );
    await expect(intro).toContainText(
      locale === "ja" ? "他の人から直接返信" : "direct human reply",
    );
    await expect(intro).not.toContainText(
      locale === "ja" ? "観測できた出席" : "Observed attendance",
    );
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-rules-mobile.png`,
      fullPage: true,
    });
    await page.locator(".mobile-head select").selectOption("0");
    await page.screenshot({
      caret: "initial",
      path: `test-results/polish-${locale}-dashboard-mobile.png`,
      fullPage: true,
    });
  });
}
