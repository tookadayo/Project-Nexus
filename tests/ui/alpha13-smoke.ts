import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const { build } =
  require("../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild") as {
    build: (options: Record<string, unknown>) => Promise<unknown>;
  };
await mkdir(".local/alpha13-ui", { recursive: true });
await build({
  entryPoints: ["tests/ui/alpha13-entry.tsx"],
  bundle: true,
  outfile: ".local/alpha13-ui/app.js",
  platform: "browser",
  jsx: "automatic",
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
    ["tokens.css", "style.css", "product.css", "brand.css"].map((file) =>
      readFile("apps/web/app/" + file, "utf8"),
    ),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "");
const app = await readFile(".local/alpha13-ui/app.js");
const brandFiles = new Map<string, Buffer>(
  await Promise.all(
    ["blue-n", "navy-n", "nexus-wordmark", "navy-tile"].map(
      async (name) =>
        [
          `/nexus/brand/${name}.png`,
          await readFile(`apps/web/public/nexus/brand/${name}.png`),
        ] as const,
    ),
  ),
);
const server = createServer((request, response) => {
  const brand = brandFiles.get(request.url ?? "");
  if (brand) {
    response.setHeader("Content-Type", "image/png");
    response.end(brand);
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/app.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(app);
  } else if (request.url?.startsWith("/auth/select")) {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end("<p>Fixture authorization boundary</p>");
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`,
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("PORT");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  for (const width of [320, 390, 767, 768, 1024, 1199, 1200, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await expect(page.locator("#home-title")).toHaveText("ホーム");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width < 1200) {
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "閉じる", exact: true }),
      ).toBeFocused();
      for (const summary of await dialog.locator("summary").all())
        await summary.click();
      expect(await dialog.locator("nav button").count()).toBe(13);
      for (const href of [
        "/explore",
        "/operations?view=attention",
        "/operations?view=organization",
        "/operations?view=integrations",
        "/privacy",
        "/terms",
        "/support",
        "/auth/logout",
      ])
        await expect(dialog.locator(`a[href="${href}"]`)).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "English", exact: true }),
      ).toBeVisible();
      for (let i = 0; i < 32; i++) {
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(
            () => !!document.activeElement?.closest("dialog"),
          ),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "メニュー", exact: true }),
      ).toBeFocused();
    }
    await page.screenshot({
      path: `.local/alpha13-ui/home-ja-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "分析", exact: true })
    .click();
  await expect(page).toHaveURL(/view=5/);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "履歴", exact: true })
    .click();
  await expect(page).toHaveURL(/view=3/);
  await page.goBack();
  await expect(page).toHaveURL(/view=5/);
  await expect(page.locator('.sidebar button[aria-current="page"]')).toHaveText(
    "分析",
  );
  await page.reload();
  await expect(page.locator('.sidebar button[aria-current="page"]')).toHaveText(
    "分析",
  );
  await page.goBack();
  await expect(page.locator("#home-title")).toBeVisible();
  await page.goto(origin + "?locale=en");
  await expect(page.locator("#home-title")).toHaveText("Home");
  await page.screenshot({
    path: ".local/alpha13-ui/home-en-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.addStyleTag({
    content:
      ".product{font-size:32px}.product h1{font-size:52px}.product h2{font-size:40px}",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/alpha13-ui/zoom-en-390.png",
    fullPage: true,
  });
  await page
    .locator(".server-picker select")
    .selectOption("222222222222222222");
  await expect(page).toHaveURL(/auth\/select\?guild=222222222222222222/);
  await expect(page.locator("#home-title")).toHaveCount(0);
  await page.goto(origin);
  await page
    .getByRole("button", { name: "状況を詳しく見る", exact: true })
    .click();
  await expect(page.locator("#home-overview-detail")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "状況を詳しく見る", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  for (const view of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    await page.goto(origin + "?view=" + view);
    await expect(page.locator(".content")).toBeVisible();
    if ([3, 4, 8].includes(view))
      await page.screenshot({
        path: `.local/alpha13-ui/view-${view}-ja-390.png`,
        fullPage: true,
      });
  }
  await page.goto(origin + "?preview=unknown");
  await expect(page.getByText("この項目は確認できません。")).toBeVisible();
  await expect(page.getByText("確認できた範囲では0件です。")).toHaveCount(0);
  await page.goto(origin + "?preview=zero");
  await expect(page.getByText("確認できた範囲では0件です。")).toBeVisible();
  await expect(page.getByText(/2026.*UTC/)).toBeVisible();
  for (const state of ["PAUSED", "EXPIRED"]) {
    await page.goto(origin + "?state=" + state);
    await expect(page.locator(".access-notice")).toBeVisible();
    await page.locator(".access-notice button").click();
    await expect(page).toHaveURL(/view=4/);
  }
  await page.goto(origin + "?preview=operations");
  await page.locator("summary").click();
  await expect(
    page.getByRole("link", { name: "レポート", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ログアウト", exact: true }),
  ).toBeVisible();
  await page.route("**/link/disconnect", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ confirmation: "synthetic-confirmation" }),
    }),
  );
  await page.goto(origin + "?preview=connection");
  const disconnect = page.getByRole("button", {
    name: "連携を解除（対象と影響を確認）",
    exact: true,
  });
  await disconnect.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "このサーバーの収集・利用権を停止し、データを削除しますか",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(disconnect).toBeFocused();
  for (const preview of ["explore-error", "operations-error"]) {
    await page.route(
      preview === "explore-error"
        ? "**/explore/data?*"
        : "**/operations/data?*",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "RAW_SECRET_STACK_TRACE" }),
        }),
    );
    await page.goto(origin + "?preview=" + preview);
    await expect(page.getByRole("alert")).toContainText(
      "処理を完了できませんでした",
    );
    await expect(page.getByText("RAW_SECRET_STACK_TRACE")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  console.log(
    "PASS alpha13 UI: eight widths, 13+4 destinations, help/locale/logout, modal focus/Escape, Back/refresh, JA/EN, long names, text enlargement, server selection boundary. External requests blocked.",
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
