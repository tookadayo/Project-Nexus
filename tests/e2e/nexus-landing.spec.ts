import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: "nexus_locale", value: "en", url: baseURL! },
  ]);
});

test("public product copy and navigation are readable without JavaScript", async ({
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
      "Know where newcomers need a reply.",
    );
    await expect(
      page
        .getByRole("link", { name: "Explore the product", exact: true })
        .first(),
    ).toHaveAttribute("href", "/product");
    await expect(
      page.getByRole("tabpanel", { name: "Overview" }),
    ).toContainText("72-hour observation complete");
    await expect(page.locator(".nx-faq details")).toHaveCount(4);
    await page
      .getByText("Are message contents stored?", { exact: true })
      .click();
    await expect(page.locator(".nx-faq details[open]")).toContainText(
      "DM contents and Voice audio are not stored",
    );
    await expect(page.locator("footer")).toContainText("Documentation");
  } finally {
    await context.close();
  }
});

test("public pages, truthful metadata and original brand assets remain accessible", async ({
  page,
  request,
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
    /newcomer activity/,
  );
  await expect(page.locator("main")).not.toContainText(
    /Intelligence Layer|AI Workspace|Agents|Individual|Revenue growth|Qualified pipeline|API access|Connect everything|conceptual|SOC ?2|SSO|SAML/,
  );
  await expect(page.locator(".nx-product-preview")).toContainText(
    "Product preview · Example data",
  );
  await expect(page.locator(".nx-hero .nx-button-primary")).toHaveAttribute(
    "href",
    /^https:\/\/discord\.com\/oauth2\/authorize\?/,
  );
});

test("preview views show implemented attention and evidence with keyboard access", async ({
  page,
}) => {
  await page.goto("/");
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Attention", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Attention" })).toContainText(
    "Staff acknowledged",
  );
  await expect(page.getByRole("tabpanel", { name: "Attention" })).toContainText(
    "snooze or resolve",
  );
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Evidence", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Evidence" })).toContainText(
    "Voice co-presence does not prove conversation",
  );
  await page.keyboard.press("Home");
  await page
    .getByRole("button", { name: "Review attention items", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Attention", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "Attention", exact: true }),
  ).toBeFocused();
});

test("mobile menu contains focus and restores it on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open menu", exact: true });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Close menu" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    menu.getByRole("button", { name: "English", exact: true }),
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
  test(`corporate product layout and screenshots at six widths (${locale})`, async ({
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
    mkdirSync(".local/nexus-corporate-qa", { recursive: true });
    for (const width of [1440, 1280, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "en"
          ? "Know where newcomers need a reply."
          : "新しいメンバーの返信待ちを見つける。",
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
      if (width === 1440) {
        const preview = await page.locator(".nx-product-preview").boundingBox();
        expect(preview!.y + preview!.height).toBeLessThan(900);
        const primary = await page
          .locator(".nx-hero .nx-button-primary")
          .boundingBox();
        expect(primary!.y + primary!.height).toBeLessThan(900);
      }
      await page.screenshot({
        path: `.local/nexus-corporate-qa/${locale}-${width}.png`,
      });
      await page.screenshot({
        path: `.local/nexus-corporate-qa/${locale}-${width}-full.png`,
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}
