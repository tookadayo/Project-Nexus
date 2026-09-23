import { test, expect } from "@playwright/test";
test("renders Home with real scoped metrics, orientation and guided setup", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "See where newcomers drop off. Fix it. Measure what worked.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Start measuring community growth" }),
  ).toBeVisible();
  const members = page.locator("article").filter({
    has: page.getByRole("heading", { name: "New Members", exact: true }),
  });
  await expect(members.locator(".value")).toHaveText("24");
  await expect(
    page.getByRole("button", { name: "Journey", exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("421111111111111111");
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("rejects unauthenticated dashboard requests", async () => {
  const response = await fetch("http://127.0.0.1:3100");
  expect(response.status).toBe(401);
});
test("switches Journey range immediately and never shows sequential conversion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Journey", exact: true }).click();
  await expect(page.getByText("Home / Journey")).toBeVisible();
  const response = page.waitForResponse((value) =>
    value.url().includes("/data/journey?range=7"),
  );
  await page.getByRole("button", { name: "7D" }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "7D" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("body")).not.toContainText(/step conversion/i);
  const response90 = page.waitForResponse((value) =>
    value.url().includes("/data/journey?range=90"),
  );
  await page.getByRole("button", { name: "90D" }).click();
  expect((await response90).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "90D" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("uses labeled Discord entity selectors without exposing raw IDs", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await expect(page.getByText("Home / Actions / Reply Rescue")).toBeVisible();
  const channel = page.getByLabel("Destination channel");
  await channel.selectOption({ label: "#helpers" });
  await expect(channel.locator("option:checked")).toHaveText("#helpers");
  await expect(channel.locator("option")).toContainText([
    "—",
    "#helpers",
    "#welcome",
  ]);
  await expect(page.locator("body")).not.toContainText("621111111111111111");
});
test("localizes the complete navigation and Action workflow in Japanese", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "新規メンバーが離脱する場所を見つけ、改善し、効果を測定します。",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "アクション", exact: true }).click();
  await expect(
    page.getByText("ホーム / アクション / 返信レスキュー"),
  ).toBeVisible();
  const channel = page.getByLabel("送信先チャンネル");
  await channel.selectOption({ label: "#helpers" });
  await expect(channel.locator("option:checked")).toHaveText("#helpers");
  await page.screenshot({
    path: "test-results/actions-japanese.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "結果", exact: true }).click();
  await expect(page.getByText("ホーム / 結果")).toBeVisible();
  await expect(
    page.getByText(
      "テスト結果はまだありません。アクションを公開し、何もしない対照群と比較してください。",
    ),
  ).toBeVisible();
});
test("completes Action to test to Results through the guided workflow", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Review Action", exact: true })
    .click();
  await expect(
    page.getByText("Draft is ready. Review and publish it."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Reply Rescue · v1/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Test this Action", exact: true })
    .click();
  await expect(page.getByText("Home / Results / Reply Rescue")).toBeVisible();
  await page.getByRole("button", { name: "Review Test", exact: true }).click();
  await page.getByRole("button", { name: "Start Test", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Reply Rescue Test" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause Test" })).toBeVisible();
  await page.getByRole("button", { name: "Pause Test" }).click();
  await expect(page.getByRole("status")).toHaveText("Test paused.");
  await page.getByRole("button", { name: "Stop Test" }).click();
  await expect(page.getByRole("status")).toHaveText("Test stopped.");
});
