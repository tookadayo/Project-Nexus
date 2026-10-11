import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: "nexus_locale", value: "en", url: baseURL! },
  ]);
});

test("public value, sample data and participation conditions are readable without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.addCookies([
      { name: "nexus_locale", value: "en", url: baseURL! },
    ]);
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Review activity and reply status in your Discord community.",
    );
    await expect(
      page
        .getByRole("link", { name: "Explore the product", exact: true })
        .first(),
    ).toHaveAttribute("href", "/product");
    await expect(
      page.getByRole("tabpanel", { name: "Overview" }),
    ).toContainText("Show all dates and values");
    await expect(page.locator("#invitation-beta")).toContainText(
      "not an allowance per participant",
    );
    await expect(page.locator(".nx-faq details")).toHaveCount(4);
    await page
      .getByText("Are message contents stored?", { exact: true })
      .click();
    await expect(page.locator(".nx-faq details[open]")).toContainText(
      "DM contents and Voice audio are not stored",
    );
    await expect(page.locator('footer a[href="/legal"]')).toHaveText(
      "Document availability",
    );
  } finally {
    await context.close();
  }
});

test("public routes, metadata and unchanged original brand files are accessible", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  for (const route of [
    "/",
    "/product",
    "/pricing",
    "/privacy",
    "/terms",
    "/support",
    "/nexus/mark.svg",
    "/nexus/social-preview.png",
    "/nexus/social-preview.svg",
    "/nexus/brand/nexus-wordmark.png",
    "/nexus/brand/blue-n.png",
    "/nexus/brand/navy-n.png",
    "/nexus/brand/navy-tile.png",
    "/nexus/screens/attention-ja.png",
    "/nexus/screens/attention-en.png",
  ])
    expect((await request.get(route)).ok(), route).toBe(true);
  await page.goto("/");
  await expect(page).toHaveTitle("NEXUS — Discord community operations");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/nexus\/social-preview\.png$/,
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /community activity/,
  );
  await expect(page.locator("main")).not.toContainText(
    /Intelligence Layer|AI Workspace|Agents|Revenue growth|Qualified pipeline|Connect everything|SOC ?2|SSO|SAML/,
  );
  await expect(page.locator(".nx-hero-example")).toContainText(
    "Actual UI · Synthetic data · Still image",
  );
  await expect(page.locator(".nx-hero .nx-button-primary")).toHaveAttribute(
    "href",
    "/support",
  );
  await expect(page.locator(".nx-hero")).not.toContainText("Sample period");
  await expect(page.locator(".nx-hero-example img")).toHaveAttribute(
    "src",
    "/nexus/screens/attention-en.png",
  );
  await expect
    .poll(() =>
      page
        .locator(".nx-hero-example img")
        .evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.naturalHeight > 0,
        ),
    )
    .toBe(true);
  await expect(
    page.locator("#demo [data-testid=interactive-demo]"),
  ).toBeVisible();
  await expect(page.locator("#features .nx-workflow > li")).toHaveCount(3);
  await expect(page.locator(".nx-plan-note")).toContainText(
    "Free, Starter, Growth, Scale and Enterprise",
  );
  await expect(page.locator(".nx-plan-note")).toContainText(
    "paid checkout, Live and extra analysis packs are not open",
  );
  await page.goto("/product");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Review Discord activity and replies to posts.",
  );
  await expect(
    page.locator("#demo [data-testid=interactive-demo]"),
  ).toBeVisible();
  await expect(
    page.locator(".nx-hero [data-testid=interactive-demo]"),
  ).toHaveCount(0);
  await context.addCookies([
    { name: "nexus_locale", value: "ja", url: baseURL! },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/product");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Discordの活動と、投稿への返信状況を確認する。",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync(".local/nexus-alpha14-lp-qa", { recursive: true });
  await page.screenshot({
    path: ".local/nexus-alpha14-lp-qa/product-ja-390.png",
  });
  await page.screenshot({
    path: ".local/nexus-alpha14-lp-qa/product-ja-390-full.png",
    fullPage: true,
  });
});

test("demo preserves keyboard tabs, 7/30-day sample values and reset", async ({
  page,
}) => {
  await page.goto("/");
  const demo = page.getByTestId("interactive-demo");
  const overview = demo.getByRole("tab", { name: "Overview", exact: true });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    demo.getByRole("tab", { name: "Attention example", exact: true }),
  ).toBeFocused();
  await expect(
    demo.getByRole("tabpanel", { name: "Attention example" }),
  ).toContainText("A post with no response detected");
  await demo.getByText("View sample evidence", { exact: true }).click();
  await expect(demo.locator("details[open]")).toContainText(
    "does not establish whether the member is satisfied or their question is resolved",
  );
  await demo
    .getByRole("tab", { name: "Attention example", exact: true })
    .focus();
  await page.keyboard.press("End");
  await expect(
    demo.getByRole("tab", { name: "Evidence", exact: true }),
  ).toBeFocused();
  await expect(demo.getByRole("tabpanel", { name: "Evidence" })).toContainText(
    "Missing days remain unavailable",
  );
  await page.keyboard.press("Home");
  await expect(overview).toBeFocused();
  await demo
    .getByRole("combobox", { name: "Sample period", exact: true })
    .selectOption("30");
  await demo.getByText("Show all dates and values", { exact: true }).click();
  await expect(demo.locator(".chart-values tbody tr")).toHaveCount(30);
  await demo.getByRole("button", { name: "Reset demo" }).click();
  await expect(
    demo.getByRole("combobox", { name: "Sample period", exact: true }),
  ).toHaveValue("7");
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await demo.getByText("Show all dates and values", { exact: true }).click();
  await expect(demo.locator(".chart-values tbody tr")).toHaveCount(7);
});

test("mobile menu contains focus and restores it on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open menu", exact: true });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Menu", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Close menu" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    menu.locator("a[href],button:not([disabled])").last(),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "Close menu" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
});

for (const locale of ["en", "ja"] as const) {
  test(`community product layout and screenshots at six widths (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    mkdirSync(".local/nexus-alpha14-lp-qa", { recursive: true });
    for (const width of [1440, 1280, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "en"
          ? "Review activity and reply status in your Discord community."
          : "Discordの活動と、投稿への返信状況を確認する。",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow at ${width}`,
      ).toBe(true);
      const clipped = await page.locator("main").evaluate((element) =>
        Array.from(element.querySelectorAll("*"))
          .filter(
            (node) =>
              node.getBoundingClientRect().width > 0 &&
              node.scrollWidth > node.clientWidth + 2 &&
              getComputedStyle(node).overflowX === "visible",
          )
          .map((node) => node.className),
      );
      expect(clipped, `clipped text at ${width}`).toEqual([]);
      const hero = await page.locator(".nx-hero").boundingBox();
      const demo = await page.locator("#demo").boundingBox();
      expect(demo!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height - 1);
      if (width === 1440) {
        const example = await page.locator(".nx-hero-example").boundingBox();
        // R3 places a full actual UI screenshot below the centered hero copy.
        // The primary CTA remains in the first viewport; the screenshot must
        // follow the copy and fit inside the hero instead of being clipped to it.
        const copy = await page.locator(".nx-hero-copy").boundingBox();
        expect(example!.y).toBeGreaterThanOrEqual(copy!.y + copy!.height);
        expect(example!.y + example!.height).toBeLessThanOrEqual(
          hero!.y + hero!.height,
        );
        const primary = await page
          .locator(".nx-hero .nx-button-primary")
          .boundingBox();
        expect(primary!.y + primary!.height).toBeLessThan(900);
        expect(
          (await page.getByTestId("interactive-demo").boundingBox())!.width,
        ).toBeGreaterThan(1000);
      }
      await page.screenshot({
        path: `.local/nexus-alpha14-lp-qa/${locale}-${width}.png`,
      });
      await page.screenshot({
        path: `.local/nexus-alpha14-lp-qa/${locale}-${width}-full.png`,
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}
