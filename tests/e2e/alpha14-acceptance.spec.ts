import { expect, test, type Page } from "@playwright/test";
import { demoChart } from "../../apps/web/app/landing/demo-data";
import { chartQuerySchema } from "../../packages/analytics/src/chart-spec";
import { exploreLocation } from "../../apps/web/app/explore/navigation";
import {
  canonicalFeatures,
  planRegistry,
  plans,
  type Plan,
} from "../../packages/settings/src/plan-registry";

// Browser response fixtures test presentation only. Authorization is independently
// covered by alpha13-history-access/access-presentation and alpha14 integration tests.
const guild = "321111111111111111";
const widths = [390, 768, 1440] as const;
async function fitsViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
}
async function homeLayoutDoesNotOverlap(page: Page, width: number) {
  const home = page.locator(".home-overview");
  const focus = (await home.locator(".home-focus").boundingBox())!;
  const recent = (await home.locator(".home-recent").boundingBox())!;
  const primary = (await home.locator(".home-focus .primary").boundingBox())!;
  if (width === 1440) {
    expect((await home.boundingBox())!.width).toBeGreaterThan(900);
    expect(focus.width).toBeGreaterThan(500);
  }
  if (width <= 850)
    expect(recent.y).toBeGreaterThanOrEqual(focus.y + focus.height - 1);
  else expect(recent.x).toBeGreaterThanOrEqual(focus.x + focus.width + 10);
  expect(primary.x).toBeGreaterThanOrEqual(focus.x);
  expect(primary.x + primary.width).toBeLessThanOrEqual(focus.x + focus.width);
  expect(primary.y).toBeGreaterThanOrEqual(focus.y);
  expect(primary.y + primary.height).toBeLessThanOrEqual(
    focus.y + focus.height,
  );
  const activity = home.locator(".home-activity");
  if (await activity.count()) {
    const box = (await activity.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(
      Math.max(focus.y + focus.height, recent.y + recent.height) - 1,
    );
    const parts = await activity
      .locator(":scope > div, :scope > dl, :scope > button")
      .all();
    const bounds = await Promise.all(parts.map((part) => part.boundingBox()));
    for (let i = 0; i < bounds.length; i++)
      for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i]!,
          b = bounds[j]!;
        const overlapX =
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY =
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(
          overlapX <= 1 || overlapY <= 1,
          "Activity content must not overlap",
        ).toBe(true);
      }
  }
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await fitsViewport(page);
  await page.screenshot({
    path: `.local/alpha14-evidence/after/alpha14-${name}.png`,
    fullPage: true,
  });
}

for (const locale of ["ja", "en"] as const) {
  const ja = locale === "ja";
  test(`alpha14 Home hierarchy and keyboard action (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(90000);
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/dashboard");
    const home = page.locator(".home-overview");
    await expect(home.locator("h1")).toHaveText(ja ? "ホーム" : "Home");
    await expect(home.locator(".home-attention-count")).toHaveText("2");
    await expect(home.locator(".primary")).toHaveCount(1);
    await expect(home.locator(".home-focus .primary")).toContainText(
      ja ? "要確認を見る" : "Review posts",
    );
    await expect(home.locator(".summary-grid")).toHaveCount(0);
    await expect(
      home.locator('.home-footnote a[href="/support#product-info"]'),
    ).toBeVisible();
    await expect(home.locator(".home-recent")).toContainText(
      ja ? "最近の対応記録" : "Recent response records",
    );
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await homeLayoutDoesNotOverlap(page, width);
      await capture(page, `home-${locale}-${width}`);
      if (width === 390) {
        const main = await home.locator(".home-focus").boundingBox();
        const records = await home.locator(".home-recent").boundingBox();
        expect(records!.y).toBeGreaterThanOrEqual(main!.y + main!.height - 1);
      }
    }
    await home.locator(".home-focus .primary").focus();
    await expect(page.locator(":focus-visible")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/view=8/);
    await expect(page.locator(".attention-view")).toBeVisible();
    await page.goBack();
    await expect(home).toBeVisible();
    await page.reload();
    await expect(home.locator(".home-attention-count")).toHaveText("2");
    expect(errors).toEqual([]);
  });

  test(`alpha14 synthetic Explore values, comparison and current access (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180000);
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
      { name: "nexus_guild", value: guild, url: baseURL! },
    ]);
    const errors: string[] = [],
      mutations: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let plan: Plan = "STARTER",
      role = "ADMIN",
      beta: "ACTIVE" | "PAUSED" | "EXPIRED" | null = null;
    let historyError = false;
    await page.route("**/explore/data**", async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        mutations.push(request.method());
        await route.fulfill({
          status: 403,
          json: { error: "NEXUS_ROLE_REQUIRED" },
        });
        return;
      }
      const q = chartQuerySchema.parse(
        JSON.parse(new URL(request.url()).searchParams.get("q") ?? "{}"),
      );
      if (historyError && q.compare) {
        await route.fulfill({
          status: 403,
          json: { error: "HISTORY_PLAN_LIMIT" },
        });
        return;
      }
      const definition = planRegistry[plan];
      const features = canonicalFeatures.filter((feature) =>
        definition.features.includes(feature),
      );
      const advanced = features.includes("surface_breakdowns") || beta !== null;
      const workAllowed = beta === null || beta === "ACTIVE";
      const canAnalyze = role === "ADMIN" || role === "ANALYST";
      const canSave = canAnalyze && workAllowed && advanced;
      const spec = demoChart(q.days === 30 ? 30 : 7);
      if (!q.compare)
        spec.series = spec.series.filter((series) => series.key === "CURRENT");
      spec.heatmap = Array.from({ length: 168 }, (_, i) => ({
        weekday: Math.floor(i / 24),
        hour: i % 24,
        value: i === 1 ? null : i % 6,
      }));
      spec.breakdowns = [
        {
          channelId: "621111111111111111",
          evidence: spec.evidence,
          points: spec.series[0]!.points,
        },
      ];
      await route.fulfill({
        json: {
          spec,
          views: [],
          segments: [],
          channels: [],
          capabilities: {
            advanced,
            compare: features.includes("comparable_periods") || beta !== null,
            canSave,
            saveReason: !canAnalyze
              ? "NEXUS_ROLE_REQUIRED"
              : !workAllowed
                ? "BETA_UNAVAILABLE"
                : !advanced
                  ? "PLAN_REQUIRED"
                  : null,
            csv: features.includes("csv_export"),
            historyDays: definition.limits.historyDays,
            access: {
              plan,
              basePlan: plan,
              features,
              historyDays: definition.limits.historyDays,
              monthlyRuns: definition.limits.analysisRunsMonthly,
              concurrency: definition.limits.analysisConcurrency,
              benefits: beta
                ? [{ kind: "BETA", endsAt: "2026-11-01T00:00:00Z" }]
                : [],
              beta: beta
                ? {
                    state: beta,
                    endsAt: "2026-11-01T00:00:00Z",
                    limits: {
                      daily: 3,
                      monthly: 20,
                      guildPending: 2,
                      globalPending: 10,
                    },
                  }
                : null,
              workAllowed,
              usage:
                canAnalyze && workAllowed
                  ? { remaining: 1, reserved: 0, consumed: 0 }
                  : null,
              asOf: "2026-10-09T00:00:00Z",
              nextMonthlyGrantAt: "2026-11-01T00:00:00Z",
            },
          },
        },
      });
    });
    await page.goto(
      exploreLocation(chartQuerySchema.parse({ compare: true }), guild),
    );
    await expect(page.locator(".observation-chart")).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await capture(page, `synthetic-explore-${locale}-${width}`);
    }
    const points = page.locator('.observation-plot g[role="button"]');
    await expect(points).toHaveCount(7);
    await points.nth(2).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(ja ? "確認できません" : "Unavailable");
    await page.keyboard.press("Escape");
    await expect(points.nth(2)).toBeFocused();
    const table = page.locator(".chart-values");
    await table.locator("summary").click();
    await expect(table.locator("tbody tr")).toHaveCount(7);
    await expect(table.locator("thead th")).toHaveCount(5);
    await table.getByRole("button").first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button").click();
    await expect(table.getByRole("button").first()).toBeFocused();
    const cells = page.locator(".heatmap tbody button");
    await expect(cells.nth(0)).toHaveText("0");
    await expect(cells.nth(1)).toHaveText("?");
    await cells.nth(1).click();
    await expect(dialog).toContainText(ja ? "確認できません" : "Unavailable");
    await page.keyboard.press("Escape");
    await expect(cells.nth(1)).toBeFocused();
    historyError = true;
    await page
      .getByRole("combobox", { name: ja ? /^期間/ : /^Period/ })
      .selectOption("30");
    await expect(
      page.locator(".explore-workspace").getByRole("alert"),
    ).toContainText(ja ? "履歴の範囲外" : "outside your available history");
    const comparison = page.getByRole("checkbox", {
      name: ja ? "前の同期間と比較" : "Compare previous period",
    });
    await expect(comparison).toBeEnabled();
    await page
      .getByRole("button", { name: ja ? "比較を解除" : "Turn off comparison" })
      .click();
    await expect(page.locator(".observation-chart")).toBeVisible();
    await page.goBack();
    await expect(comparison).toBeChecked();
    await expect(
      page.locator(".explore-workspace").getByRole("alert"),
    ).toBeVisible();
    await comparison.uncheck();
    await page.reload();
    await expect(comparison).not.toBeChecked();
    historyError = false;
    for (role of ["ADMIN", "ANALYST", "OPERATOR", "VIEWER"]) {
      await page.goto("/explore");
      const name = page.getByRole("textbox", {
        name: ja ? "名前" : "Name",
        exact: true,
      });
      await name.fill("Synthetic view");
      const save = page.getByRole("button", {
        name: ja ? "ビューを保存" : "Save view",
        exact: true,
      });
      if (["ADMIN", "ANALYST"].includes(role)) await expect(save).toBeEnabled();
      else {
        await expect(save).toBeDisabled();
        await expect(
          page.getByText(
            ja
              ? "この操作を行う権限がありません。"
              : "You do not have permission to perform this action.",
            { exact: true },
          ),
        ).toBeVisible();
      }
      await name.fill("");
    }
    role = "ADMIN";
    for (plan of plans) {
      await page.goto("/explore");
      await expect(page.locator(".current-access summary")).toContainText(plan);
      await page.locator(".current-access summary").click();
      await expect(page.locator(".current-access")).toContainText(
        ja ? `基本プラン: ${plan}` : `Base plan: ${plan}`,
      );
      await expect(page.getByRole("checkbox")).toBeEnabled({
        enabled: plan !== "FREE",
      });
      await fitsViewport(page);
    }
    plan = "FREE";
    for (beta of ["ACTIVE", "PAUSED", "EXPIRED"] as const) {
      await page.goto("/explore");
      await expect(page.locator(".current-access summary")).toContainText(
        ja ? "無料招待Beta" : "Free invitation Beta",
      );
      await page.locator(".current-access summary").click();
      await expect(page.locator(".current-access")).toContainText(
        ja ? "基本プラン: FREE" : "Base plan: FREE",
      );
      await expect(page.locator(".observation-chart")).toBeVisible();
      const name = page.getByRole("textbox", {
        name: ja ? "名前" : "Name",
        exact: true,
      });
      await name.fill("Synthetic view");
      const save = page.getByRole("button", {
        name: ja ? "ビューを保存" : "Save view",
        exact: true,
      });
      if (beta === "ACTIVE") await expect(save).toBeEnabled();
      else {
        await expect(save).toBeDisabled();
        await expect(page.locator(".current-access")).toContainText(
          ja ? "現在の状態を確認できません" : "Current amount unavailable",
        );
        await expect(page.locator(".access-state-band")).toBeVisible();
        await expect(page.locator(".access-state-band")).toContainText(
          beta === "EXPIRED"
            ? ja
              ? "利用期間が終了"
              : "access period has ended"
            : ja
              ? "停止中"
              : "paused",
        );
      }
      await name.fill("");
      await capture(page, `synthetic-access-${locale}-${beta.toLowerCase()}`);
    }
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const locale of ["ja", "en"] as const) {
  test(`alpha14 synthetic Home zero, unknown, partial, collection and stopped states (${locale})`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const { dirname } = await import("node:path");
    const require = createRequire(import.meta.url);
    const { build } =
      require("../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild") as {
        build: (
          options: Record<string, unknown>,
        ) => Promise<{ outputFiles: { text: string }[] }>;
      };
    const built = await build({
      entryPoints: ["tests/fixtures/alpha14-home-browser.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      loader: { ".css": "empty" },
      alias: {
        react: dirname(require.resolve("../../apps/web/node_modules/react")),
        "react-dom": dirname(
          require.resolve("../../apps/web/node_modules/react-dom"),
        ),
      },
      define: { "process.env.NODE_ENV": '"development"' },
    });
    const css = (
      await Promise.all(
        [
          "tokens.css",
          "style.css",
          "product.css",
          "brand.css",
          "home-summary.css",
        ].map((file) => readFile("apps/web/app/" + file, "utf8")),
      )
    )
      .join("\n")
      .replace(/@import[^;]+;/g, "");
    const errors: string[] = [],
      requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    for (const state of [
      "ready",
      "zero",
      "unknown",
      "partial",
      "collecting",
      "paused",
      "expired",
    ]) {
      await page.setContent(
        `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root" data-locale="${locale}" data-state="${state}"></div></body></html>`,
      );
      await page.addScriptTag({ content: built.outputFiles[0]!.text });
      const home = page.locator(".home-overview");
      await expect(home).toBeVisible();
      await expect(home.locator(".primary")).toHaveCount(1);
      await expect(home.locator(".home-state")).toHaveCount(
        ["ready", "zero"].includes(state) ? 0 : 1,
      );
      if (state === "unknown" || state === "collecting") {
        await expect(home.locator(".home-attention-count")).toHaveCount(0);
        await expect(home.locator(".home-activity")).toHaveCount(0);
        await expect(home.locator("svg")).toHaveCount(0);
        await expect(home.locator(".home-focus .primary")).toContainText(
          locale === "ja" ? "収集状況を確認する" : "Check collection status",
        );
      } else {
        await expect(home.locator(".home-attention-count")).toHaveText(
          state === "zero" ? "0" : "2",
        );
      }
      if (state === "zero")
        await expect(home.locator(".home-focus .primary")).toContainText(
          locale === "ja" ? "分析を見る" : "View analysis",
        );
      if (state === "partial")
        await expect(
          home.locator(".home-activity-values dd").first(),
        ).toHaveText(locale === "ja" ? "未確認" : "Unavailable");
      if (state === "paused" || state === "expired") {
        await expect(home.locator(".home-records li")).toHaveCount(1);
        await expect(home.locator(".home-focus .primary")).toContainText(
          locale === "ja"
            ? "利用状態と接続の案内を見る"
            : "Review access and connection",
        );
      }
      for (const width of widths) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await fitsViewport(page);
        await homeLayoutDoesNotOverlap(page, width);
        if (width !== 768)
          await capture(page, `synthetic-home-${state}-${locale}-${width}`);
      }
      await home.locator(".home-focus .primary").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#root")).toHaveAttribute(
        "data-action",
        state === "zero"
          ? "5"
          : state === "unknown" || state === "collecting"
            ? "details"
            : state === "paused" || state === "expired"
              ? "4"
              : "8",
      );
    }
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });
}

for (const locale of ["ja", "en"] as const) {
  test(`alpha14 synthetic Attention reaches 101 posts and restores filters safely (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180000);
    const ja = locale === "ja";
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const channelA = "621111111111111111",
      channelB = "621111111111111112";
    const id = (index: number) => String(521111111111111000n + BigInt(index));
    const postUrl = (index: number) =>
      `https://discord.com/channels/${guild}/${index < 75 || index >= 101 ? channelA : channelB}/${id(index)}`;
    let size = 101,
      generation = 0,
      canOperate = true,
      scopeMismatch = false,
      unavailable = false;
    const snapshots = new Map<string, number>(),
      removed = new Set<number>();
    const reads: { state: string; channel: string; cursor: string | null }[] =
      [];
    const writes: { messageId: string; status: string; version: number }[] = [];
    await page.route("**/data/attention**", async (route) => {
      const request = route.request();
      expect(request.headers()["x-nexus-guild"]).toBe(guild);
      if (request.method() === "POST") {
        const body = request.postDataJSON() as {
          messageId: string;
          status: string;
          version: number;
        };
        writes.push(body);
        removed.add(Number(BigInt(body.messageId) - 521111111111111000n));
        await route.fulfill({ json: { ok: true } });
        return;
      }
      if (scopeMismatch || unavailable) {
        await route.fulfill({
          status: scopeMismatch ? 409 : 503,
          json: {
            error: scopeMismatch ? "SERVER_SELECTION_CHANGED" : "UNAVAILABLE",
          },
        });
        return;
      }
      const params = new URL(request.url()).searchParams;
      const cursor = params.get("cursor"),
        state = params.get("state") ?? "ACTIVE",
        channel = params.get("channelId") ?? "";
      reads.push({ state, channel, cursor });
      const parsed = cursor?.match(/^(synthetic-snapshot-\d+):(\d+)$/);
      const snapshot = parsed?.[1] ?? `synthetic-snapshot-${++generation}`;
      if (!snapshots.has(snapshot)) snapshots.set(snapshot, size);
      const start = Number(parsed?.[2] ?? 0),
        boundary = snapshots.get(snapshot)!;
      const eligible = Array.from(
        { length: boundary },
        (_, index) => index,
      ).filter((index) => {
        const candidateChannel =
          index < 75 || index >= 101 ? channelA : channelB;
        return (
          !removed.has(index) &&
          (!channel || candidateChannel === channel) &&
          ["ACTIVE", "OPEN"].includes(state)
        );
      });
      const selection = eligible.filter((index) => index >= start).slice(0, 50);
      const previous = eligible.filter((index) => index < start).slice(-50);
      const next = eligible.find(
        (index) => index > (selection.at(-1) ?? start),
      );
      await route.fulfill({
        json: {
          items: selection.map((index) => ({
            channelId: index < 75 || index >= 101 ? channelA : channelB,
            messageId: id(index),
            status: "OPEN",
            version: 1,
            surface: "TEXT",
            purpose: "SUPPORT",
            postedAt: "2026-10-09T10:00:00Z",
            openedAt: "2026-10-09T10:20:00Z",
            snoozeUntil: null,
            response: null,
            waitingMinutes: 35,
            url: postUrl(index),
          })),
          total: eligible.length,
          activeCount: size - removed.size,
          asOf: "2026-10-09T12:00:00Z",
          checkedAt: "2026-10-09T12:01:00Z",
          cursor: `${snapshot}:${start}`,
          firstCursor: `${snapshot}:0`,
          previousCursor: previous.length ? `${snapshot}:${previous[0]}` : null,
          nextCursor: next === undefined ? null : `${snapshot}:${next}`,
          canOperate,
          channels: [channelA, channelB],
        },
      });
    });
    await page.goto("/dashboard?view=8");
    const view = page.locator(".attention-view"),
      cards = view.locator(".attention-card"),
      pagination = view.locator(".attention-pagination");
    const next = pagination.getByRole("button", {
      name: ja ? "次へ" : "Next",
      exact: true,
    });
    const first = pagination.getByRole("button", {
      name: ja ? "先頭へ" : "First",
      exact: true,
    });
    const previous = pagination.getByRole("button", {
      name: ja ? "前へ" : "Previous",
      exact: true,
    });
    const refresh = view.getByRole("button", {
      name: ja ? "更新" : "Refresh",
      exact: true,
    });
    const links = () =>
      cards
        .locator('a[href^="https://discord.com/channels/"]')
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLAnchorElement).href),
        );
    await expect(cards).toHaveCount(50);
    await expect(first).toBeDisabled();
    await expect(previous).toBeDisabled();
    await expect(view.locator(".attention-summary strong").last()).toHaveText(
      "101",
    );
    const originalCursor = new URL(page.url()).searchParams.get(
      "attentionCursor",
    );
    expect(originalCursor).toMatch(/^synthetic-snapshot-\d+:0$/);
    const reached = await links();
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await fitsViewport(page);
      // Keep the overview and capture inside the independently scrolling content.
      await view.locator(".page-head").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `.local/alpha14-evidence/after/alpha14-synthetic-attention-${locale}-${width}.png`,
      });
      if (width === 390 || width === 1440) {
        const summary = view.locator(".attention-summary");
        await summary.evaluate((element) =>
          element.scrollIntoView({ block: "start", inline: "nearest" }),
        );
        await expect(summary).toBeInViewport({ ratio: 0.9 });
        await expect(cards.first()).toBeInViewport({ ratio: 0.5 });
        await page.screenshot({
          path: `.local/alpha14-evidence/after/alpha14-synthetic-attention-${locale}-${width}-queue.png`,
        });
        await pagination.scrollIntoViewIfNeeded();
        await expect(pagination).toBeInViewport({ ratio: 1 });
        await page.screenshot({
          path: `.local/alpha14-evidence/after/alpha14-synthetic-attention-${locale}-${width}-pagination.png`,
        });
      }
    }
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(cards).toHaveCount(50);
    await expect(view.locator(".attention-summary")).toBeFocused();
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(50),
    );
    reached.push(...(await links()));
    const secondUrl = page.url();
    await next.click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(100),
    );
    reached.push(...(await links()));
    expect(reached).toEqual(
      Array.from({ length: 101 }, (_, index) => postUrl(index)),
    );
    expect(new Set(reached).size).toBe(101);
    await expect(next).toBeDisabled();
    await page.goBack();
    await expect(page).toHaveURL(secondUrl);
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(50),
    );
    await page.reload();
    await expect(page).toHaveURL(secondUrl);
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(50),
    );
    size = 102;
    await next.click();
    await expect(cards).toHaveCount(1);
    await expect(next).toBeDisabled();
    await expect(view.locator(".attention-summary strong").last()).toHaveText(
      "101",
    );
    await refresh.click();
    await expect(cards).toHaveCount(50);
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(0),
    );
    await expect(view.locator(".attention-summary strong").last()).toHaveText(
      "102",
    );
    expect(new URL(page.url()).searchParams.get("attentionCursor")).not.toBe(
      originalCursor,
    );
    expect(reads.at(-1)!.cursor).toBeNull();
    await next.click();
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(50),
    );
    const channelFilter = view.getByRole("combobox", {
      name: ja ? "対象チャンネル" : "Channel",
      exact: true,
    });
    await channelFilter.selectOption(channelA);
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(0),
    );
    await expect(view.locator(".attention-summary strong").last()).toHaveText(
      "76",
    );
    expect(reads.at(-1)).toMatchObject({ channel: channelA, cursor: null });
    await expect(page).toHaveURL(new RegExp(`attentionChannel=${channelA}`));
    const stateFilter = view.getByRole("combobox", {
      name: ja ? "状態" : "State",
      exact: true,
    });
    await stateFilter.selectOption("OPEN");
    await expect(page).toHaveURL(/attentionState=OPEN/);
    await expect(cards).toHaveCount(50);
    expect(reads.at(-1)).toMatchObject({
      state: "OPEN",
      channel: channelA,
      cursor: null,
    });
    await next.click();
    await expect(cards).toHaveCount(26);
    await previous.click();
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(0),
    );
    await next.click();
    await expect(cards).toHaveCount(26);
    await first.click();
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(0),
    );
    await channelFilter.selectOption("");
    await expect(view.locator(".attention-summary strong").last()).toHaveText(
      "102",
    );
    // A successful staff action re-reads the same boundary; removed entries stay gone.
    await cards.first().locator(".attention-record summary").click();
    await cards
      .first()
      .getByRole("button", {
        name: ja ? "対応済みとして記録" : "Mark as handled",
        exact: true,
      })
      .click();
    await expect(cards.first().locator("a")).toHaveAttribute(
      "href",
      postUrl(1),
    );
    await expect(view.locator(".attention-summary strong").last()).toHaveText(
      "101",
    );
    expect(writes).toEqual([
      expect.objectContaining({
        messageId: id(0),
        status: "RESOLVED",
        version: 1,
      }),
    ]);
    canOperate = false;
    await page.reload();
    await expect(cards).toHaveCount(50);
    await expect(view.locator(".attention-record")).toHaveCount(0);
    await expect(view.locator(".attention-readonly")).toBeVisible();
    unavailable = true;
    await refresh.click();
    await expect(cards).toHaveCount(0);
    await expect(view.locator(".attention-summary")).toHaveCount(0);
    await expect(view).toContainText(
      ja ? "件数は確認できません" : "The count is unavailable",
    );
    unavailable = false;
    await refresh.click();
    await expect(cards).toHaveCount(50);
    scopeMismatch = true;
    await next.click();
    await expect(cards).toHaveCount(0);
    await expect(view.locator(".attention-summary")).toHaveCount(0);
    await expect(
      page.getByRole("alert").filter({
        hasText: ja ? "選択中のサーバー" : "selected server changed",
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

for (const locale of ["ja", "en"] as const) {
  test(`alpha14 real Home preserves active count across synthetic staff transitions (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180000);
    const ja = locale === "ja";
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const channelId = "621111111111111111";
    const ids = [
      "521111111111111901",
      "521111111111111902",
      "521111111111111903",
    ];
    const posts = new Map(
      ids.slice(0, 2).map((id) => [id, { status: "OPEN", version: 1 }]),
    );
    const snapshots = new Map<string, string[]>();
    const writes: { messageId: string; status: string; version: number }[] = [];
    const active = (status: string) =>
      ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"].includes(status);
    let generation = 0;
    await page.route("**/data/attention**", async (route) => {
      const request = route.request();
      expect(request.headers()["x-nexus-guild"]).toBe(guild);
      if (request.method() === "POST") {
        const input = request.postDataJSON() as {
          messageId: string;
          status: string;
          version: number;
        };
        const post = posts.get(input.messageId)!;
        expect(input.version).toBe(post.version);
        writes.push(input);
        post.status = input.status;
        post.version++;
        await route.fulfill({ json: { ok: true } });
        return;
      }
      const query = new URL(request.url()).searchParams;
      const state = query.get("state") ?? "ACTIVE";
      const cursor = query.get("cursor") ?? `synthetic-home-${++generation}`;
      if (!snapshots.has(cursor)) snapshots.set(cursor, [...posts.keys()]);
      const filtered = snapshots.get(cursor)!.filter((id) => {
        const post = posts.get(id)!;
        return state === "ACTIVE" ? active(post.status) : post.status === state;
      });
      await route.fulfill({
        json: {
          items: filtered.map((messageId) => ({
            channelId,
            messageId,
            ...posts.get(messageId)!,
            surface: "TEXT",
            purpose: "SUPPORT",
            postedAt: "2026-10-09T10:00:00Z",
            openedAt: "2026-10-09T10:20:00Z",
            snoozeUntil:
              posts.get(messageId)!.status === "SNOOZED"
                ? "2026-10-09T13:00:00Z"
                : null,
            response: null,
            waitingMinutes: 35,
            url: `https://discord.com/channels/${guild}/${channelId}/${messageId}`,
          })),
          total: filtered.length,
          activeCount: [...posts.values()].filter((post) => active(post.status))
            .length,
          asOf: "2026-10-09T12:00:00Z",
          checkedAt: "2026-10-09T12:01:00Z",
          cursor,
          firstCursor: cursor,
          previousCursor: null,
          nextCursor: null,
          canOperate: true,
          channels: [channelId],
        },
      });
    });
    await page.goto("/dashboard");
    const home = page.locator(".home-overview");
    const view = page.locator(".attention-view");
    const card = (id: string) =>
      view
        .locator(".attention-card")
        .filter({ has: page.locator(`a[href$="/${id}"]`) });
    const toHome = async (count: number) => {
      await page
        .locator(".sidebar")
        .getByRole("button", { name: ja ? "ホーム" : "Home", exact: true })
        .click();
      await expect(home.locator(".home-attention-count")).toHaveText(
        String(count),
      );
    };
    const toQueue = async () => {
      await home.locator(".home-focus .primary").click();
      await expect(view.locator(".attention-summary")).toBeVisible();
    };
    const filter = async (state: string) => {
      await view
        .getByRole("combobox", { name: ja ? "状態" : "State", exact: true })
        .selectOption(state);
      await expect(view).toHaveAttribute("aria-busy", "false");
    };
    const record = async (id: string, name: string) => {
      await card(id).locator(".attention-record summary").click();
      await card(id).getByRole("button", { name, exact: true }).click();
      await expect(view).toHaveAttribute("aria-busy", "false");
    };
    await expect(home.locator(".home-attention-count")).toHaveText("2");
    await toQueue();
    await record(ids[1]!, ja ? "保留する" : "Snooze");
    await expect(card(ids[1]!)).toHaveCount(0);
    await toHome(1);
    await toQueue();
    await filter("SNOOZED");
    await card(ids[1]!).locator(".attention-record summary").click();
    await expect(
      card(ids[1]!).getByRole("combobox", {
        name: ja ? "保留する期間" : "Snooze for",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      card(ids[1]!).getByRole("button", {
        name: ja ? "保留する" : "Snooze",
        exact: true,
      }),
    ).toBeDisabled();
    expect(writes).toHaveLength(1);
    await toHome(1);
    await toQueue();
    await filter("SNOOZED");
    await record(ids[1]!, ja ? "確認したことを記録" : "Mark as acknowledged");
    await expect(card(ids[1]!)).toHaveCount(0);
    await toHome(2);
    await toQueue();
    await record(ids[1]!, ja ? "保留する" : "Snooze");
    await expect(card(ids[1]!)).toHaveCount(0);
    await toHome(1);
    await toQueue();
    await filter("SNOOZED");
    await record(ids[1]!, ja ? "対応済みとして記録" : "Mark as handled");
    await expect(card(ids[1]!)).toHaveCount(0);
    await toHome(1);
    await toQueue();
    posts.set(ids[2]!, { status: "OPEN", version: 1 });
    await view
      .getByRole("button", { name: ja ? "更新" : "Refresh", exact: true })
      .click();
    await expect(card(ids[2]!)).toBeVisible();
    await record(ids[2]!, ja ? "対応済みとして記録" : "Mark as handled");
    await expect(card(ids[2]!)).toHaveCount(0);
    await expect(card(ids[0]!)).toBeVisible();
    await toHome(1);
    expect(writes.map((write) => write.status)).toEqual([
      "SNOOZED",
      "ACKNOWLEDGED",
      "SNOOZED",
      "RESOLVED",
      "RESOLVED",
    ]);
    await capture(page, `home-count-after-transitions-${locale}-1440`);
  });

  test(`alpha14 synthetic empty continuation keeps earlier candidates reachable (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    const ja = locale === "ja";
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: baseURL! },
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/data/attention**", async (route) => {
      expect(route.request().method()).toBe("GET");
      const empty =
        new URL(route.request().url()).searchParams.get("cursor") ===
        "synthetic-empty";
      await route.fulfill({
        json: {
          items: empty
            ? []
            : [0, 1].map((index) => ({
                channelId: "621111111111111111",
                messageId: String(521111111111111000n + BigInt(index)),
                status: "OPEN",
                version: 1,
                surface: "TEXT",
                purpose: "SUPPORT",
                postedAt: "2026-10-09T10:00:00Z",
                openedAt: "2026-10-09T10:20:00Z",
                snoozeUntil: null,
                response: null,
                waitingMinutes: 35,
                url: `https://discord.com/channels/${guild}/621111111111111111/${521111111111111000n + BigInt(index)}`,
              })),
          total: 2,
          activeCount: 2,
          asOf: "2026-10-09T12:00:00Z",
          checkedAt: "2026-10-09T12:01:00Z",
          cursor: empty ? "synthetic-empty" : "synthetic-first",
          firstCursor: "synthetic-first",
          previousCursor: empty ? "synthetic-first" : null,
          nextCursor: empty ? null : "synthetic-empty",
          canOperate: false,
          channels: ["621111111111111111"],
        },
      });
    });
    await page.goto("/dashboard?view=8&attentionCursor=synthetic-empty");
    const view = page.locator(".attention-view"),
      pagination = view.locator(".attention-pagination");
    const empty = view.locator(".empty-state");
    await expect(view.locator(".attention-summary strong").last()).toHaveText(
      "2",
    );
    await expect(empty.getByRole("heading")).toHaveText(
      ja
        ? "このページに表示できる投稿はありません"
        : "No posts remain on this page",
    );
    await expect(empty).not.toContainText(
      ja
        ? "現在の条件で返信待ちの候補はありません"
        : "No posts are awaiting a response under the current conditions",
    );
    const first = pagination.getByRole("button", {
      name: ja ? "先頭へ" : "First",
      exact: true,
    });
    const previous = pagination.getByRole("button", {
      name: ja ? "前へ" : "Previous",
      exact: true,
    });
    await expect(first).toBeEnabled();
    await expect(previous).toBeEnabled();
    await first.click();
    await expect(view.locator(".attention-card")).toHaveCount(2);
    const next = pagination.getByRole("button", {
      name: ja ? "次へ" : "Next",
      exact: true,
    });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(view.locator(".attention-card")).toHaveCount(0);
    await expect(view.locator(".attention-summary")).toBeFocused();
    await expect(empty.getByRole("heading")).toHaveText(
      ja
        ? "このページに表示できる投稿はありません"
        : "No posts remain on this page",
    );
    await empty.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.local/alpha14-evidence/after/alpha14-empty-continuation-${locale}-390.png`,
    });
    await previous.click();
    await expect(view.locator(".attention-card")).toHaveCount(2);
  });
}
