import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { comparisonRows } from "../../apps/web/app/pricing/comparison";
import { planRegistry, plans } from "../../packages/settings/src/plan-registry";

const output = ".local/official-site-r3-ui";
const checks: string[] = [],
  external: string[] = [],
  errors: string[] = [];
const layouts: unknown[] = [],
  inventory: unknown[] = [];
const baseline = JSON.parse(
  await readFile("tests/fixtures/pricing-comparison-baseline.json", "utf8"),
);
const privateMarkers = [
  "LEGAL_TEST_ONLY_PRIVATE_BODY",
  "support@example.invalid",
  "rights@example.invalid",
];
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const changedFiles = execFileSync("git", ["diff", "--name-only"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
await mkdir(output, { recursive: true });
// Next starts from a strict environment and refuses local dotenv files without
// opening them. No provider credentials, database or live product server is used.
for (const folder of [".", "apps/web"])
  for (const name of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ])
    if (existsSync(resolve(folder, name)))
      throw new Error("LOCAL_ENV_FILE_PRESENT: " + folder + "/" + name);
expect(plans).toEqual(baseline.plans);
expect(comparisonRows.map(({ id, values }) => ({ id, values }))).toEqual(
  baseline.rows,
);
expect(
  Object.fromEntries(plans.map((plan) => [plan, planRegistry[plan].limits])),
).toEqual(baseline.limits);
const sourceContract = JSON.parse(
  await readFile("tests/fixtures/alpha14-public-contracts.json", "utf8"),
);
for (const [path, hash] of Object.entries(sourceContract.sha256)) {
  const source = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  expect(createHash("sha256").update(source).digest("hex"), path).toBe(hash);
}
checks.push(
  "Source invariants: 44 feature rows / 220 booleans / 60 limits; billing, access, proxy and migrations match the portable source contract",
);

async function freePort() {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_TEST_PORT");
  await new Promise<void>((yes, no) =>
    server.close((error) => (error ? no(error) : yes())),
  );
  return address.port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((yes) => child.once("exit", () => yes()));
}
async function fits(page: Page, label: string) {
  const evidence = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clipped: [
      ...document.querySelectorAll<HTMLElement>(
        "main h1,main h2,main h3,main p,main button,main summary",
      ),
    ]
      .filter(
        (node) =>
          node.clientWidth > 0 &&
          node.getBoundingClientRect().height > 0 &&
          node.scrollWidth > node.clientWidth + 2 &&
          !node.closest("table,.comparison-scroll,.chart-table-scroll,svg"),
      )
      .map((node) => ({
        tag: node.tagName,
        className: node.className,
        text: node.textContent?.slice(0, 100),
      })),
  }));
  if (evidence.scrollWidth > evidence.viewport + 1 || evidence.clipped.length) {
    await writeFile(
      output + "/layout-failure.json",
      JSON.stringify({ label, ...evidence }, null, 2),
    );
    await page.screenshot({
      path: output + "/layout-failure.png",
      fullPage: true,
    });
  }
  expect(evidence.scrollWidth, label + " page overflow").toBeLessThanOrEqual(
    evidence.viewport + 1,
  );
  expect(evidence.clipped, label + " clipped text").toEqual([]);
}
async function heroImage(page: Page, locale: string) {
  const region = page.locator(".nx-hero-screen-scroll"),
    image = region.locator("img");
  await expect(image).toHaveAttribute(
    "src",
    "/nexus/screens/attention-" + locale + ".png",
  );
  await expect
    .poll(() =>
      image.evaluate(
        (node) =>
          node instanceof HTMLImageElement &&
          node.complete &&
          node.naturalWidth > 0 &&
          node.naturalHeight > 0,
      ),
    )
    .toBe(true);
  await expect(page.locator(".nx-hero-example")).toContainText(
    /Still image|静止画/,
  );
  await expect(region).toHaveAttribute("tabindex", "0");
  if (
    await region.evaluate((node) => node.scrollWidth > node.clientWidth + 1)
  ) {
    await region.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => region.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
    await region.evaluate((node) => {
      node.scrollLeft = 0;
    });
  }
}
async function noPrivateText(page: Page) {
  const html = await page.content();
  for (const marker of privateMarkers) expect(html).not.toContain(marker);
}
async function cards(page: Page, label: string) {
  const card = page.locator(".r3-pricing-grid > [data-pricing-plan]");
  expect(
    await card.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-pricing-plan")),
    ),
  ).toEqual(plans);
  const positions = await card.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        plan: node.getAttribute("data-pricing-plan"),
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        regions: [
          ".r3-plan-name",
          ".r3-plan-price",
          ".r3-plan-cta",
          ".r3-plan-features",
          ".r3-plan-details",
        ].map((selector) => {
          const child = node.querySelector(selector)!;
          const childRect = child.getBoundingClientRect();
          return { selector, top: childRect.top, bottom: childRect.bottom };
        }),
      };
    }),
  );
  const rows: (typeof positions)[] = [];
  for (const position of positions) {
    const row = rows.find(
      (items) => Math.abs(items[0]!.top - position.top) < 2,
    );
    if (row) row.push(position);
    else rows.push([position]);
  }
  for (const row of rows) {
    for (const [index, region] of row[0]!.regions.entries()) {
      const starts = row.map((item) => item.regions[index]!.top);
      expect(
        Math.max(...starts) - Math.min(...starts),
        label + " aligned " + region.selector,
      ).toBeLessThan(2);
    }
    const ends = row.map((item) => item.bottom);
    expect(
      Math.max(...ends) - Math.min(...ends),
      label + " card bottoms",
    ).toBeLessThan(2);
  }
  for (const position of positions)
    expect(
      position.regions.every(
        (region) =>
          region.top >= position.top && region.bottom <= position.bottom + 1,
      ),
    ).toBe(true);
  await expect(page.locator('a[href^="/checkout"]')).toHaveCount(0);
  expect((await card.allTextContents()).join(" ")).not.toMatch(
    /Buy now|購入する/,
  );
  layouts.push({
    label,
    cards: positions,
    columnsPerRow: rows.map((row) => row.length),
  });
}
async function values(page: Page) {
  const table = page.locator(".comparison-scroll");
  await expect(table.locator("[data-feature-id]")).toHaveCount(44);
  for (const row of baseline.rows as { id: string; values: boolean[] }[])
    expect(
      await table
        .locator('[data-feature-id="' + row.id + '"] td')
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-included") === "true"),
        ),
    ).toEqual(row.values);
  await expect(table.locator(".comparison-mark-included").first()).toHaveCSS(
    "color",
    "rgb(39, 88, 202)",
  );
  await expect(table.locator(".comparison-mark-excluded").first()).toHaveCSS(
    "color",
    "rgb(107, 114, 128)",
  );
  await expect(table).toHaveAttribute("tabindex", "0");
}
async function recordInventory(page: Page, locale: string, path: string) {
  inventory.push(
    await page.evaluate(
      ({ locale, path }) => ({
        locale,
        path,
        headings: [...document.querySelectorAll("main h1,main h2,main h3")].map(
          (node) => ({
            level: node.tagName,
            id: node.id,
            text: node.textContent,
          }),
        ),
        sections: [
          ...document.querySelectorAll("main > section,main > div > section"),
        ].map((node) => ({
          id: node.id,
          className: node.className,
          heading: node.querySelector("h1,h2,h3")?.textContent,
        })),
        links: [
          ...document.querySelectorAll(
            "header a[href],main a[href],footer a[href]",
          ),
        ].map((node) => ({
          text: node.textContent,
          href: node.getAttribute("href"),
        })),
      }),
      { locale, path },
    ),
  );
}
async function navigation(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin);
  await expect(
    page.locator('.nx-navigation[data-enhanced="true"]'),
  ).toBeVisible();
  const triggers = page.locator(".nx-nav-main .nx-nav-disclosure");
  await expect(triggers).toHaveCount(5);
  const product = page.locator("#nexus-nav-product"),
    guide = page.locator("#nexus-nav-guide");
  await page.locator(".nx-nav-main .nx-nav-item").first().hover();
  await expect(product).toBeVisible();
  await product.locator("a").first().hover();
  await expect(product).toBeVisible();
  await page.locator(".nx-nav-main .nx-nav-item").nth(1).hover();
  await expect(guide).toBeVisible();
  await expect(product).not.toBeVisible();
  await page.mouse.move(1400, 900);
  await expect(guide).not.toBeVisible();
  await triggers.first().focus();
  await page.keyboard.press("Enter");
  await expect(product).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(product).not.toBeVisible();
  await expect(triggers.first()).toBeFocused();
  await page.waitForTimeout(260);
  await expect(product).not.toBeVisible();
  await page.keyboard.press("Space");
  await expect(product).toBeVisible();
  await product.locator("a").first().focus();
  await page.mouse.move(1400, 900);
  await page.waitForTimeout(260);
  await expect(product).toBeVisible();
  await page.screenshot({ path: output + "/menu-ja-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(triggers.first()).toBeFocused();
  await triggers.first().click();
  await expect(product).toBeVisible();
  // The expanded panel covers the hero heading; choose visible content below it.
  expect(
    await page.evaluate(
      () => !!document.elementFromPoint(1400, 900)?.closest(".nx-site-header"),
    ),
  ).toBe(false);
  await page.mouse.click(1400, 900);
  await expect(product).not.toBeVisible();
  await triggers.first().focus();
  await page.keyboard.press("Enter");
  await page.locator("main a[href]").first().focus();
  await expect(product).not.toBeVisible();
  // The next tab stop after the disclosure stays outside all hidden panels.
  await triggers.first().focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest(".nx-nav-panel"),
    ),
  ).toBe(false);
  const skip = page.locator(".nx-skip-link");
  await skip.focus();
  await page.keyboard.press("Enter");
  const target = page.locator((await skip.getAttribute("href"))!);
  await expect(target).toBeFocused();
  // Check a real in-page anchor rather than only CSS declarations.
  await page.goto(origin + "/#how-it-works");
  await page.waitForTimeout(100);
  const anchor = page.locator("#how-it-works");
  expect((await anchor.boundingBox())!.y).toBeGreaterThanOrEqual(62);
  checks.push(
    "Desktop menu hover/panel/switch/leave; click, Enter, Space, Tab, focus retention, Escape/reopen, outside click/focus; skip and fixed-header anchor",
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(origin);
  await page.evaluate(() => scrollTo(0, 500));
  const scrollBefore = await page.evaluate(() => scrollY);
  const trigger = page.locator(".nx-nav-mobile-trigger"),
    dialog = page.locator("#nexus-mobile-menu");
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".nx-nav-mobile-top button")).toBeFocused();
  await expect(dialog.locator(".nx-nav-mobile-primary > a")).toHaveCount(5);
  const focusable = dialog.locator("a[href],button:not([disabled])");
  await page.keyboard.press("Shift+Tab");
  await expect(focusable.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(focusable.first()).toBeFocused();
  await page.screenshot({ path: output + "/menu-ja-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  expect(
    Math.abs((await page.evaluate(() => scrollY)) - scrollBefore),
  ).toBeLessThan(3);
  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.locator(".nx-nav-mobile-top button").click();
  await expect(trigger).toBeFocused();
  checks.push(
    "Mobile modal primary/secondary routes, native Escape, Tab cycle, close/reopen, focus and scroll restoration",
  );

  // A genuine safe /locale POST through the UI, not merely a test cookie.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const languageResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/locale" &&
      response.request().method() === "POST",
  );
  await page.locator(".nx-nav-language-switch").click();
  expect((await languageResponse).status()).toBe(303);
  await expect(page.locator("main h1")).toContainText("Discord");
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === "nexus_locale",
    )?.value,
  ).toBe("en");
  await expect(page.locator(".nx-nav-language-switch")).toHaveText("JA");
  checks.push("Actual locale POST 303 + English cookie and translated shell");
}
async function demo(page: Page) {
  await page.goto(origin);
  const preview = page.getByTestId("interactive-demo");
  const tabs = preview.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await preview.locator("summary").first().click();
  await expect(preview.locator("details[open]")).toContainText(
    /does not establish|示すものではありません/,
  );
  await tabs.nth(1).focus();
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await expect(preview.getByRole("tabpanel")).toContainText(
    /Missing days|欠測日/,
  );
  await page.keyboard.press("Home");
  const period = preview.getByRole("combobox");
  await period.selectOption("30");
  await expect(preview.locator(".observation-plot g[role=button]")).toHaveCount(
    30,
  );
  await preview.locator(".chart-values summary").click();
  const rows = preview.locator(".chart-values tbody tr");
  await expect(rows).toHaveCount(30);
  const unknown = await rows.nth(2).locator("td").first().innerText(),
    zero = await rows.nth(3).locator("td").first().innerText();
  expect(unknown).not.toBe("0");
  expect(zero).toBe("0");
  await expect(preview.locator(".chart-total")).toContainText(/Partial|一部/);
  await rows.nth(2).getByRole("button").click();
  await expect(preview.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rows.nth(2).getByRole("button")).toBeFocused();
  await preview
    .getByRole("button", { name: /Reset demo|デモをリセット/ })
    .click();
  await expect(period).toHaveValue("7");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(preview.locator(".chart-point").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  checks.push(
    "Interactive demo period 7/30, tabs/key navigation, point/table details and reset; unknown/partial/observed zero remain distinct; reduced-motion usable",
  );
}

async function finalLayouts(page: Page, context: BrowserContext) {
  const inspection: unknown[] = [];
  for (const locale of ["ja", "en"]) {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: origin },
    ]);
    for (const width of [1440, 375, 320, 768]) {
      await page.setViewportSize({ width, height: width < 768 ? 812 : 1000 });
      for (const path of ["/", "/product"]) {
        await page.goto(origin + path);
        await page.evaluate(() => document.fonts.ready);
        await fits(page, "final " + path + " " + locale + " " + width);
        await heroImage(page, locale);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          scrollTo(0, 0);
        });
        const visual = await page.evaluate(() => ({
          heading: (() => {
            const node = document.querySelector("main h1")!;
            const css = getComputedStyle(node);
            return {
              width: node.getBoundingClientRect().width,
              fontSize: css.fontSize,
              maxWidth: css.maxWidth,
            };
          })(),
          phrases: [
            ...document.querySelectorAll(".nx-hero .nx-heading-phrase"),
          ].map((node) => ({
            text: node.textContent,
            height: node.getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(node).lineHeight),
          })),
          workflow: [...document.querySelectorAll(".nx-workflow > li")].map(
            (node) => {
              const main = node
                  .querySelector(".nx-workflow-main")!
                  .getBoundingClientRect(),
                detail = node
                  .querySelector(".nx-workflow-detail")!
                  .getBoundingClientRect();
              return {
                columns: getComputedStyle(node).gridTemplateColumns,
                width: node.getBoundingClientRect().width,
                mainWidth: main.width,
                mainBottom: main.bottom,
                detailTop: detail.top,
                detailColumn: getComputedStyle(
                  node.querySelector(".nx-workflow-detail")!,
                ).gridColumn,
              };
            },
          ),
        }));
        if (path === "/" && locale === "ja" && width === 1440) {
          expect(visual.heading.width).toBeGreaterThan(690);
          expect(visual.phrases).toHaveLength(2);
          for (const phrase of visual.phrases)
            expect(phrase.height).toBeLessThanOrEqual(phrase.lineHeight + 1);
        }
        if (width <= 375)
          for (const row of visual.workflow) {
            expect(row.mainWidth).toBeGreaterThanOrEqual(row.width - 2);
            expect(row.detailColumn).toBe("auto");
            expect(row.detailTop).toBeGreaterThanOrEqual(row.mainBottom - 1);
          }
        inspection.push({ locale, width, path, ...visual });
        if ([1440, 375].includes(width)) {
          const label = path === "/" ? "home" : "product";
          await page.screenshot({
            path: output + "/" + label + "-" + locale + "-" + width + ".png",
            fullPage: true,
          });
          if (path === "/") {
            await page.screenshot({
              path: output + "/home-" + locale + "-" + width + "-viewport.png",
            });
            if (width === 375)
              await page.locator("#features").screenshot({
                path: output + "/workflow-" + locale + "-375.png",
                style:
                  ".nx-public-header,.nx-navigation,.nx-site-header,.nx-skip-link {visibility:hidden!important}",
              });
          }
          if (width === 1440) await recordInventory(page, locale, path);
        }
      }
    }
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + "/pricing");
      await fits(page, "final pricing " + locale + width);
      await cards(page, "final " + locale + width);
      await page.locator(".r3-pricing-grid").screenshot({
        path: output + "/pricing-cards-" + locale + "-" + width + ".png",
        style:
          ".nx-public-header,.nx-navigation,.nx-site-header,.nx-skip-link {visibility:hidden!important}",
      });
    }
    for (const path of [
      "/pricing",
      "/support",
      "/news",
      "/terms",
      "/privacy",
      "/legal",
      "/legal/beta",
      "/legal/operator",
      "/legal/history",
    ]) {
      await page.goto(origin + path);
      await noPrivateText(page);
      await recordInventory(page, locale, path);
    }
  }
  await context.addCookies([
    { name: "nexus_locale", value: "ja", url: origin },
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin);
  await page.locator(".nx-nav-disclosure").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#nexus-nav-product")).toBeVisible();
  await page.screenshot({ path: output + "/menu-ja-desktop.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(origin);
  await page.locator(".nx-nav-mobile-trigger").click();
  await expect(page.locator("#nexus-mobile-menu")).toBeVisible();
  await expect(page.locator(".nx-nav-mobile-primary > a")).toHaveCount(5);
  await page.screenshot({ path: output + "/menu-ja-mobile.png" });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await writeFile(
    output + "/inventory.json",
    JSON.stringify(inventory, null, 2),
  );
  await writeFile(
    output + "/final-layout-result.json",
    JSON.stringify(
      {
        passed: true,
        sourceCommit,
        changedFiles,
        inspection,
        pageErrors: errors,
        externalRequests: external,
        verified: [
          "Final rebuilt home/product JAEN1440/375/320/768 and actual image loading",
          "Desktop JA hero two intact phrases, wide heading",
          "Mobile workflow full-width main then supporting copy without implicit second grid column",
          "Five-plan price/CTA/features alignment and clean component captures",
          "Final route/headings/CTA inventory and initial menu screenshots",
        ],
        previousEvidence:
          "result.json retains the prior complete9-group interaction run. This supplemental run verifies the final CSS and newcomer-copy changes only; it does not claim all9groups were rerun.",
      },
      null,
      2,
    ),
  );
  console.log("PASS final R3 layout follow-up; images and inventory refreshed");
}

// Bundle real presentation components only. This is a labeled synthetic render,
// not a DB-backed route or a claim that a public article exists.
async function newsFixture() {
  const requireHere = createRequire(import.meta.url);
  const requireTsx = createRequire(requireHere.resolve("tsx"));
  const build = requireTsx("esbuild").build as (
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  const filename = resolve(output, "news-fixtures.cjs");
  await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents:
        'import React from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {NewsListContent,NewsArticle} from "./apps/web/app/news/news-components"; export function render(locale){const query={page:1};const item={id:"11111111-1111-4111-8111-111111111111",category:"UPDATE",incidentStatus:"NONE",locale:"ja",fallback:locale==="en",title:"合成お知らせ — 公開データではありません",summary:"実際のニュース描画部品を使う検証用サンプル。",publishedAt:"2026-10-09T00:00:00.000Z",updatedAt:"2026-10-09T01:00:00.000Z",body:"## 確認すること\\n\\nこの文章は合成サンプルです。\\n\\n## 関連する案内\\n\\n[サポート](/support)"};return renderToStaticMarkup(<main className="site nexus-site"><p>LOCAL SYNTHETIC COMPONENT FIXTURE — NO PUBLICATION</p><div className="news-page"><section id="fixture-empty"><NewsListContent locale={locale} query={query} data={{items:[],total:0,page:1,hasNext:false}}/></section><section id="fixture-continuation"><NewsListContent locale={locale} query={{page:3}} data={{items:[],total:2,page:3,hasNext:false}}/></section><section id="fixture-detail"><NewsArticle locale={locale} item={item}/></section></div></main>);}',
    },
    bundle: true,
    outfile: filename,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    alias: {
      react: resolve("apps/web/node_modules/react"),
      "react-dom": resolve("apps/web/node_modules/react-dom"),
    },
    plugins: [
      {
        name: "presentation-only",
        setup(buildApi: {
          onResolve(options: { filter: RegExp }, handler: () => unknown): void;
          onLoad(
            options: { filter: RegExp; namespace: string },
            handler: () => unknown,
          ): void;
        }) {
          buildApi.onResolve({ filter: /(^|\/)public-ui$/ }, () => ({
            path: "public-ui",
            namespace: "r3-stub",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "r3-stub" }, () => ({
            contents: 'export const copy=(locale,ja,en)=>locale==="ja"?ja:en;',
            loader: "js",
          }));
        },
      },
    ],
  });
  return requireHere(filename) as { render(locale: string): string };
}
const port = await freePort(),
  origin = "http://127.0.0.1:" + port;
let log = "",
  web: ChildProcess | undefined;
const browser = await chromium.launch({ headless: true });
function blockExternal(context: BrowserContext) {
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  return context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (
        !["GET", "HEAD"].includes(route.request().method()) &&
        !(url.pathname === "/locale" && route.request().method() === "POST")
      ) {
        errors.push(
          "Unexpected local mutation: " +
            route.request().method() +
            " " +
            url.pathname,
        );
        return route.abort();
      }
      return route.continue();
    }
    external.push(url.origin + url.pathname);
    return route.abort();
  });
}
try {
  web = spawn(
    process.execPath,
    [
      resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: resolve("apps/web"),
      env: {
        NODE_ENV: "production",
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NEXT_TELEMETRY_DISABLED: "1",
        NEXUS_HOSTED_BETA: "on",
        NEXUS_WEB_AUTH_MODE: "oauth",
        NEXUS_WEB_URL: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  web.stdout?.on("data", (chunk) => {
    log += String(chunk);
  });
  web.stderr?.on("data", (chunk) => {
    log += String(chunk);
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (web.exitCode !== null) throw new Error("LOCAL_NEXT_EXITED");
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* isolated startup */
    }
    await new Promise((yes) => setTimeout(yes, 200));
  }
  if (!ready) throw new Error("LOCAL_NEXT_NOT_READY");
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  await blockExternal(context);
  const page = await context.newPage();
  if (process.argv.includes("--final-layouts")) {
    await finalLayouts(page, context);
  } else {
    for (const locale of ["ja", "en"]) {
      await context.addCookies([
        { name: "nexus_locale", value: locale, url: origin },
      ]);
      for (const width of [1440, 375]) {
        await page.setViewportSize({
          width,
          height: width === 375 ? 812 : 1000,
        });
        await page.goto(origin);
        await page.evaluate(() => document.fonts.ready);
        await fits(page, "home " + locale + " " + width);
        await heroImage(page, locale);
        await page.evaluate(() => scrollTo(0, 0));
        await expect(page.locator("main h1")).toContainText("Discord");
        await expect(
          page.locator(".nx-eyebrow,.site-eyebrow,.publication-eyebrow"),
        ).toHaveCount(0);
        await expect(page.getByTestId("interactive-demo")).toBeVisible();
        await noPrivateText(page);
        await page.screenshot({
          path: output + "/home-" + locale + "-" + width + ".png",
          fullPage: true,
        });
        if (width === 1440) await recordInventory(page, locale, "/");
        await page.goto(origin + "/pricing");
        await fits(page, "pricing " + locale + " " + width);
        await cards(page, locale + " " + width);
        if (width === 1440) await values(page);
        await page.locator(".r3-pricing-grid").screenshot({
          path: output + "/pricing-cards-" + locale + "-" + width + ".png",
        });
        await noPrivateText(page);
        layouts.push({ page: "home/pricing", locale, width });
      }
      for (const width of [320, 639, 640, 768, 959, 960, 1119, 1120, 1439]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin + "/pricing");
        await fits(page, "boundary " + locale + " " + width);
        await cards(page, locale + " " + width);
        if ([320, 768, 1119, 1120].includes(width)) {
          await page.goto(origin);
          await fits(page, "home boundary " + locale + " " + width);
          if (width < 1120)
            await expect(page.locator(".nx-nav-mobile-trigger")).toBeVisible();
          else await expect(page.locator(".nx-nav-main")).toBeVisible();
        }
      }
      await page.setViewportSize({
        width: locale === "ja" ? 375 : 1440,
        height: 1000,
      });
      for (const path of [
        "/product",
        "/support",
        "/news",
        "/news/11111111-1111-4111-8111-111111111111",
        "/terms",
        "/privacy",
        "/legal",
        "/legal/beta",
        "/legal/operator",
        "/legal/history",
      ]) {
        await page.goto(origin + path);
        await fits(page, locale + " " + path);
        await noPrivateText(page);
        if (path === "/product") await heroImage(page, locale);
        await expect(page.locator(".nx-navigation")).toHaveCount(1);
        await expect(page.locator("footer")).toHaveCount(1);
        await expect(
          page.locator(".nx-eyebrow,.site-eyebrow,.publication-eyebrow"),
        ).toHaveCount(0);
        if (path === "/news" || path.startsWith("/news/")) {
          await expect(page.locator("#news-unavailable-title")).toBeVisible();
          await expect(page.locator(".news-empty")).toContainText(
            /0件|does not mean/,
          );
          await expect(page.locator(".news-results-summary")).toHaveCount(0);
        }
        if (["/terms", "/privacy"].includes(path) || path.startsWith("/legal"))
          await expect(page.locator("#document-status-title")).toContainText(
            /公開文書はまだありません|No published document is available/,
          );
        if (path === "/support") {
          await page.locator(".nx-support-form-details summary").focus();
          await page.keyboard.press("Enter");
          for (const input of await page
            .locator(
              ".support-contact-form input,.support-contact-form select,.support-contact-form textarea,.support-contact-form button",
            )
            .all())
            await expect(input).toBeDisabled();
          await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
        }
        if (["/product", "/support", "/news", "/terms"].includes(path)) {
          await recordInventory(page, locale, path);
          if (locale === "ja")
            await page.screenshot({
              path: output + "/page-" + path.slice(1) + "-ja-375.png",
              fullPage: path === "/product",
            });
        }
      }
    }
    checks.push(
      "JA/EN whole home1440/375 +320/768; nav and card breakpoint neighbors; five-card order/row alignment; public shell product/support/news/detail/legal",
    );
    await context.addCookies([
      { name: "nexus_locale", value: "ja", url: origin },
    ]);
    await navigation(page);
    await demo(page);
    // A 1280-pixel canvas viewed at 200% has a 640-CSS-pixel layout.
    // This reflow/raster approximation exercises media-query changes too; CSS
    // zoom alone would leave desktop media queries active and create a false result.
    const zoom = await browser.newContext({
      viewport: { width: 640, height: 500 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    await blockExternal(zoom);
    await zoom.addCookies([{ name: "nexus_locale", value: "en", url: origin }]);
    const zoomPage = await zoom.newPage();
    for (const path of ["/", "/pricing"]) {
      await zoomPage.goto(origin + path);
      await fits(zoomPage, path + " 200% zoom-equivalent reflow");
      if (path === "/pricing")
        await cards(zoomPage, "200% zoom-equivalent reflow");
    }
    await zoomPage.locator(".nx-nav-mobile-trigger").click();
    await expect(zoomPage.locator("#nexus-mobile-menu")).toBeVisible();
    await zoomPage.keyboard.press("Escape");
    await expect(zoomPage.locator(".nx-nav-mobile-trigger")).toBeFocused();
    await zoom.close();
    checks.push(
      "200% zoom-equivalent reflow/raster approximation:1280px canvas→640 CSSpx at2x; home/pricing and mobile navigation. Not a native browser zoom or OS text-size test",
    );

    const fixtures = await newsFixture();
    await page.goto(origin + "/news");
    const styles = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join(""));
    for (const locale of ["ja", "en"]) {
      await page.setViewportSize({
        width: locale === "ja" ? 375 : 1440,
        height: 1000,
      });
      await page.setContent(
        '<!doctype html><html lang="' +
          locale +
          '"><head>' +
          styles +
          "</head><body>" +
          fixtures.render(locale) +
          "</body></html>",
      );
      await fits(page, "synthetic news " + locale);
      await expect(page.locator("#fixture-empty")).toContainText(
        /公開済みのお知らせはまだありません|No announcements have been published yet/,
      );
      await expect(page.locator("#fixture-continuation")).toContainText(
        /このページにお知らせはありません|There are no announcements on this page/,
      );
      await expect(
        page.locator("#fixture-detail .news-contents a"),
      ).toHaveCount(2);
      if (locale === "en")
        await expect(
          page.locator("#fixture-detail .news-fallback"),
        ).toContainText("Japanese version is shown");
      await page.locator("#fixture-detail").screenshot({
        path: output + "/synthetic-news-detail-" + locale + ".png",
      });
      if (locale === "ja")
        await page
          .locator("#fixture-empty")
          .screenshot({ path: output + "/synthetic-news-empty-ja.png" });
    }
    checks.push(
      "Actual NewsListContent/NewsArticle rendered with labeled synthetic empty/continuation/detail/EN fallback; no DB writes or actual publication",
    );

    const noJs = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 375, height: 812 },
    });
    await blockExternal(noJs);
    await noJs.addCookies([{ name: "nexus_locale", value: "en", url: origin }]);
    const plain = await noJs.newPage();
    await plain.goto(origin);
    await expect(plain.locator("main h1")).toBeVisible();
    await expect(plain.getByTestId("interactive-demo")).toBeVisible();
    const fallback = plain.locator(".nx-nav-fallback");
    await fallback.locator("summary").click();
    for (const path of [
      "/product",
      "/pricing",
      "/news",
      "/support",
      "/auth/login",
    ])
      await expect(
        fallback.locator('a[href="' + path + '"]').first(),
      ).toBeVisible();
    await expect(fallback.locator('form[action="/locale"]')).toBeVisible();
    await plain.locator(".chart-values summary").click();
    await expect(plain.locator(".chart-values tbody tr")).toHaveCount(7);
    await fits(plain, "home JS disabled");
    await noJs.close();
    checks.push(
      "JavaScript disabled: visible home/sample/table and native navigation disclosure/locale routes; no animation-gated blank content",
    );
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
    await writeFile(
      output + "/inventory.json",
      JSON.stringify(inventory, null, 2),
    );
    await writeFile(
      output + "/result.json",
      JSON.stringify(
        {
          passed: true,
          sourceCommit,
          changedFiles,
          checks,
          layouts,
          pageErrors: errors,
          externalRequests: external,
          baselineFailures:
            "19 recorded at4392d5/133b42b; not rerun, not claimed green at R3",
          notRun: [
            "Full suite/performance/load",
            "Production DB/provider/payment/OAuth/send",
            "Real Windows operator credential-file ACL",
            "Physical mobile/screen-reader usability",
            "Dedicated loading UI (none exists in scoped public routes)",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS R3 focused public UI: " +
        checks.length +
        " check groups; evidence " +
        output,
    );
  }
} catch (error) {
  await writeFile(
    output + "/failure.json",
    JSON.stringify(
      {
        sourceCommit,
        checksCompleted: checks,
        error: String(error),
        pageErrors: errors,
        externalRequests: external,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await stop(web);
  await writeFile(output + "/server.log", log);
}
