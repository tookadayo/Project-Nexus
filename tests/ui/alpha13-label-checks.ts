import { expect, type Page } from "@playwright/test";

export async function labelChecks(page: Page, origin: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/explore/data?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        spec: null,
        views: [],
        segments: [],
        channels: [],
        capabilities: {
          canSave: true,
          saveReason: null,
          compare: true,
          advanced: true,
          csv: false,
          historyDays: 90,
        },
      }),
    }),
  );
  await page.route("**/operations/data?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        view: "organization",
        guildId: "111111111111111111",
        access: {
          plan: "Beta",
          role: "ADMIN",
          permissions: ["GOVERN", "OPERATE"],
          features: { rbac: true, improvement_tracking: true },
          limits: { historyDays: 90, intakePanels: null },
        },
        destinations: [],
        teams: [],
        members: [],
        improvements: [],
      }),
    }),
  );
  for (const locale of ["ja", "en"] as const) {
    await page.goto(`${origin}/explore?locale=${locale}`);
    const metric = page.getByRole("combobox", {
      name: locale === "ja" ? /^指標/ : /^Metric/,
    });
    await expect(metric.locator("option")).toHaveText(
      locale === "ja"
        ? [
            "直接の返信",
            "フォーラムの初回返信",
            "条件を満たすボイス同席",
            "イベント参加登録（出席ではありません）",
            "リアクションへの参加",
            "投票への参加",
          ]
        : [
            "Direct replies",
            "Forum first responses",
            "Qualified voice co-presence",
            "Event signups (not attendance)",
            "Reaction participation",
            "Poll participation",
          ],
    );
    const surface = page.getByRole("combobox", {
      name: locale === "ja" ? /^活動の種類/ : /^Activity type/,
    });
    await expect(surface.locator("option")).toHaveText(
      locale === "ja"
        ? ["すべて", "テキスト", "フォーラム", "ボイス", "イベント"]
        : ["All", "Text", "Forum", "Voice", "Event"],
    );
    await metric.selectOption({
      label:
        locale === "ja"
          ? "イベント参加登録（出席ではありません）"
          : "Event signups (not attendance)",
    });
    await surface.selectOption({ label: locale === "ja" ? "ボイス" : "Voice" });
    const version = page.getByLabel(
      locale === "ja"
        ? "測定方法の版ID（任意）"
        : "Measurement recipe version ID (optional)",
      { exact: true },
    );
    await expect(version).toHaveAttribute(
      "aria-describedby",
      "recipe-version-help",
    );
    await expect(page.locator("#recipe-version-help")).toContainText(
      locale === "ja" ? "改訂番号ではありません" : "not its revision number",
    );
    const versionId = "11111111-1111-4111-8111-111111111111";
    const request = page.waitForRequest(
      (r) => r.url().includes("/explore/data?") && r.url().includes(versionId),
    );
    await version.fill(versionId);
    const sent = JSON.parse(
      new URL((await request).url()).searchParams.get("q")!,
    );
    expect(sent.metric).toBe("event");
    expect(sent.filter.surface).toBe("VOICE");
    expect(sent.filter.recipeVersionId).toBe(versionId);
    if (locale === "ja")
      await page.screenshot({
        path: ".local/alpha13-ui/explore-labels-1440.png",
        fullPage: true,
      });

    await page.goto(`${origin}/operations?view=organization&locale=${locale}`);
    await expect(page.locator(".page-head")).toContainText(
      locale === "ja" ? "管理者" : "Administrator",
    );
    await expect(page.locator(".page-head")).not.toContainText("ADMIN");
    const role = page.locator('select[name="role"]');
    await expect(role.locator("option")).toHaveText(
      locale === "ja"
        ? ["所有者", "管理者", "運営担当", "分析担当", "閲覧者"]
        : ["Owner", "Administrator", "Operator", "Analyst", "Viewer"],
    );
    await role.selectOption({
      label: locale === "ja" ? "管理者" : "Administrator",
    });
    expect(
      await role.evaluate((el) =>
        new FormData(el.closest("form")!).get("role"),
      ),
    ).toBe("ADMIN");
    page.once("dialog", (dialog) => dialog.accept());
    await page.goto(`${origin}/operations?view=improvements&locale=${locale}`);
    await expect(
      page.locator('select[name="metric"] option').first(),
    ).toHaveText(locale === "ja" ? "直接の返信" : "Direct replies");
    await expect(page.locator('select[name="metric"]')).toHaveValue("reply");
    if (locale === "ja")
      await page.screenshot({
        path: ".local/alpha13-ui/operations-labels-1440.png",
        fullPage: true,
      });
  }
}
