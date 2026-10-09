import { expect, type Page } from "@playwright/test";
const guild = "111111111111111111";
const guarded = (page: Page) =>
  page.evaluate(
    () =>
      !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );

export async function followupChecks(page: Page, origin: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/data/*", (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.goto(origin + "?view=5&range=7&tab=channels");
  await expect(
    page.getByRole("tab", { name: "チャンネル", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "チャンネル", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "行動", exact: true }).click();
  await expect(page).toHaveURL(/tab=behavior/);
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "チャンネル", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(
    page.getByRole("tab", { name: "行動", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto(origin + "?view=1");
  await page.getByRole("button", { name: "7D", exact: true }).click();
  await expect(page).toHaveURL(/range=7/);
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "30D", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // Internal navigation, browser Back and server switching must all preserve a cancelled draft.
  await page.goto(origin);
  await page.locator(".sidebar summary").filter({ hasText: "設定" }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "サーバーの目的", exact: true })
    .click();
  const model = page.getByTestId("community-model-settings");
  await model
    .getByText("目的・チャンネル・タグを詳しく設定", { exact: true })
    .click();
  const threshold = model.locator('input[type="number"]').first();
  await threshold.fill("2");
  await expect.poll(() => guarded(page)).toBe(true);
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
  });
  await page.locator(".server-picker a").click();
  await expect(page).toHaveURL(/view=11/);
  await expect(threshold).toHaveValue("2");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "ホーム", exact: true })
    .click();
  await expect(page).toHaveURL(/view=11/);
  await expect(threshold).toHaveValue("2");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/view=11/);
  await expect(threshold).toHaveValue("2");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .locator(".server-picker select")
    .selectOption("222222222222222222");
  await expect(page.locator(".server-picker select")).toHaveValue(guild);
  await expect(threshold).toHaveValue("2");
  // Failed save keeps the draft; a confirmed save clears only this editor's draft.
  await model.locator('input[type="checkbox"]').first().check();
  await page.route("**/control", (route) => {
    expect(route.request().headers()["x-nexus-guild"]).toBe(guild);
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"failure":{"category":"INTERNAL","effect":"NOT_STARTED"}}',
    });
  });
  await model
    .getByRole("button", { name: "目的と用途を保存", exact: true })
    .click();
  await expect(
    model.getByRole("button", { name: "目的と用途を保存", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => guarded(page)).toBe(true);
  await page.unroute("**/control");
  await page.route("**/control", (route) =>
    route.fulfill({ contentType: "application/json", body: '{"revision":2}' }),
  );
  await model
    .getByRole("button", { name: "目的と用途を保存", exact: true })
    .click();
  await expect(model).toContainText("運営目的を保存しました");
  await expect.poll(() => guarded(page)).toBe(false);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "ホーム", exact: true })
    .click();
  await page.goBack();
  await model
    .getByText("目的・チャンネル・タグを詳しく設定", { exact: true })
    .click();
  await expect(threshold).toHaveValue("2");
  await threshold.fill("3");
  await page.unroute("**/control");
  await page.route("**/control", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: '{"error":"SERVER_SELECTION_CHANGED"}',
    }),
  );
  await model
    .getByRole("button", { name: "目的と用途を保存", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "選択中のサーバー" }),
  ).toBeVisible();
  await expect(threshold).toHaveValue("3");
  page.once("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/explore");

  const exploreData = {
    spec: null,
    views: [],
    segments: [],
    capabilities: { advanced: true, csv: false, historyDays: 90 },
    channels: [],
  };
  await page.route("**/explore/data?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(exploreData),
    }),
  );
  await page.reload();
  await page.getByRole("combobox", { name: /^期間/ }).selectOption("30");
  await expect(page).toHaveURL(/guild=111111111111111111/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: /^期間/ })).toHaveValue("30");
  await page.getByRole("combobox", { name: /^期間/ }).selectOption("90");
  await page.goBack();
  await expect(page.getByRole("combobox", { name: /^期間/ })).toHaveValue("30");
  await page.getByLabel("名前", { exact: true }).fill("合成の未保存ビュー");
  await expect.poll(() => guarded(page)).toBe(true);
  expect(page.url()).not.toContain(encodeURIComponent("合成の未保存ビュー"));
  await expect(page.locator(".surface").first()).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator(".surface").first()).toHaveCSS(
    "background-image",
    "none",
  );
  await page.screenshot({
    path: ".local/alpha13-ui/explore-followup-1440.png",
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());

  const operationsData = {
    view: "improvements",
    guildId: guild,
    access: {
      plan: "Beta",
      role: "ADMIN",
      permissions: ["OPERATE", "CONFIGURE"],
      features: { improvement_tracking: true },
      limits: { historyDays: 90, intakePanels: null },
    },
    destinations: [],
    teams: [],
    improvements: [],
  };
  await page.route("**/operations/data?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(operationsData),
    }),
  );
  await page.goto(origin + "/operations?view=improvements");
  await page.getByLabel("実施した施策", { exact: true }).fill("合成の下書き");
  await expect.poll(() => guarded(page)).toBe(true);
  await expect(page.locator(".surface").first()).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator(".surface").first()).toHaveCSS(
    "background-image",
    "none",
  );
  await page.route("**/operations/data", (route) => {
    expect(route.request().headers()["x-nexus-guild"]).toBe(guild);
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.getByRole("button", { name: "記録して測定", exact: true }).click();
  await expect(
    page.getByText("保存しました。送信と測定の結果は処理後に表示されます。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => guarded(page)).toBe(false);
  await page.screenshot({
    path: ".local/alpha13-ui/operations-followup-1440.png",
    fullPage: true,
  });
  // An older successful submission must not mark a newer draft as saved.
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.unroute("**/operations/data");
  await page.route("**/operations/data", async (route) => {
    await pending;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page
    .getByLabel("実施した施策", { exact: true })
    .fill("送信する合成入力");
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith("/operations/data") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "記録して測定", exact: true }).click();
  await sent;
  await page
    .getByLabel("実施した施策", { exact: true })
    .fill("送信後に編集した未保存入力");
  complete();
  await expect(
    page.getByRole("button", { name: "記録して測定", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => guarded(page)).toBe(true);
}
