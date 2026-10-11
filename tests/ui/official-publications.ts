import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { isolatedPostgres } from "../fixtures/postgres";
import { connect, migrate, sql } from "../../packages/db/src/index";
import {
  OfficialPublications,
  type PublicationContent,
  type LegalCandidateLoader,
} from "../../packages/operations/src/publication";
import {
  OperatorAuth,
  passwordCredentials,
} from "../../packages/security/src/operator-auth";
import { BetaOperator } from "../../packages/security/src/beta-operator";
import { createOperatorServer } from "../../apps/operator/src/server";

// This harness always creates an isolated database and synthetic owner/session
// values. Its injected legal prose is a layout fixture, never a canonical legal
// document, and is never written to legal/candidates or another source directory.
const outputDirectory = ".local/official-publications-ui";
const password = "synthetic-official-publication-browser-password";
const privateMarker = "SYNTHETIC-PRIVATE-LEGAL-REVIEW-ONLY";
const ownerMarker = "SYNTHETIC-OWNER-PRIVATE-ONLY";
const draftMarker = "SYNTHETIC-UNPUBLISHED-REVISION-B";
const wideTable =
  "| " +
  Array.from({ length: 16 }, (_, index) => `Column ${index + 1}`).join(" | ") +
  " |\n| " +
  Array.from({ length: 16 }, () => "---").join(" | ") +
  " |\n| " +
  Array.from({ length: 16 }, (_, index) => `Synthetic cell ${index + 1}`).join(
    " | ",
  ) +
  " |";
const malicious =
  '<script>window.publicationXss=1</script>\n\n[unsafe](javascript:alert(1))\n\n![tracking](https://example.invalid/tracker.png)\n\n<iframe src="https://example.invalid/"></iframe>';
const readLegalCandidate: LegalCandidateLoader = async (document, locale) => {
  const sectionCount =
    document === "terms" ? 12 : document === "privacy" ? 14 : 4;
  return (
    `# ${locale === "ja" ? "合成レイアウト試験" : "Synthetic layout test"}\n\n${privateMarker}\n\n${locale === "ja" ? "施行日：[要確定] 版番号：[要確定]" : "Effective date: [To be confirmed] Version: [To be confirmed]"}\n\n` +
    Array.from(
      { length: sectionCount },
      (_, index) =>
        `## ${locale === "ja" ? `第${index + 1}条 合成の見出し` : `Section ${index + 1}. Synthetic heading`}\n\n${locale === "ja" ? "これは表示検証用の合成文であり、実際の利用条件ではありません。" : "This is synthetic presentation test prose, not contractual content."} ${index + 1}\n\n${index === 1 ? "https://example.invalid/" + "synthetic-long-url/".repeat(20) : ""}`,
    ).join("\n\n") +
    `\n\n${wideTable}\n\n${malicious}\n\nSYNTHETIC-DOCUMENT-END-${document}-${locale}\n`
  );
};
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolveReady, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveReady);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_PORT_UNAVAILABLE");
  await new Promise<void>((resolveClose, reject) =>
    probe.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}
async function fits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
}
async function noExecutableMarkdown(page: Page, selector: string) {
  await expect(page.locator(selector)).toBeVisible();
  await expect(
    page.locator(selector).locator("script,iframe,object,embed,img"),
  ).toHaveCount(0);
  expect(
    await page
      .locator(selector)
      .locator("a")
      .evaluateAll((links) =>
        links.every(
          (link) =>
            !/^(javascript|data|vbscript):/i.test(
              link.getAttribute("href") ?? "",
            ),
        ),
      ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as { publicationXss?: number }).publicationXss,
    ),
  ).toBeUndefined();
}
async function keyboardTable(page: Page, selector: string) {
  const wrapper = page
    .locator(selector)
    .locator(".publication-table-scroll")
    .first();
  await expect(wrapper).toHaveAttribute("tabindex", "0");
  await expect(wrapper).toHaveAttribute("role", "region");
  await expect(wrapper.locator("thead th")).toHaveCount(16);
  await wrapper.focus();
  await expect(wrapper).toBeFocused();
  expect(
    await wrapper.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
    "sixteen columns stay readable inside a scrollable region",
  ).toBeGreaterThan(0);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => wrapper.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
}
async function anchorClearOfHeader(page: Page, anchor: string) {
  const target = page.locator(anchor);
  await expect
    .poll(async () => {
      const position = (await target.boundingBox())!;
      const header = (await page.locator(".nx-header").boundingBox())!;
      return position.y - (header.y + header.height);
    })
    .toBeGreaterThanOrEqual(0);
  await expect(target).toBeInViewport({ ratio: 1 });
}
async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolveExit) =>
    child.once("exit", () => resolveExit()),
  );
}
process.env.NEXUS_HOSTED_BETA = "on";
await mkdir(outputDirectory, { recursive: true });
const infra = await isolatedPostgres(),
  db = connect(infra.databaseUrl);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let operator: ReturnType<typeof createOperatorServer> | undefined;
let web: ChildProcess | undefined;
let webOutput = "";
const checks: string[] = [];
const unexpectedRequests: string[] = [];
let withdrawalBackNavigation:
  { pageshowPersisted: boolean[]; bfcacheObserved: boolean } | undefined;
try {
  await migrate(db);
  const publications = new OfficialPublications(db, readLegalCandidate);
  const operatorPort = await freePort(),
    webPort = await freePort();
  const operatorOrigin = `http://127.0.0.1:${operatorPort}`,
    webOrigin = `http://127.0.0.1:${webPort}`;
  const credentials = await passwordCredentials(password);
  const auth = new OperatorAuth(db, async () => credentials);
  operator = createOperatorServer(
    db,
    auth,
    new BetaOperator(db, async () => ({
      name: "Synthetic fixture",
      present: true,
      canObserve: true,
      checkedAt: Date.now(),
    })),
    operatorOrigin,
    { readLegalCandidate },
  );
  await operator.listen({ host: "127.0.0.1", port: operatorPort });
  web = spawn(
    process.execPath,
    [
      resolve("apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
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
        DATABASE_URL: infra.databaseUrl,
        NEXUS_HOSTED_BETA: "on",
        NEXUS_WEB_AUTH_MODE: "oauth",
        NEXUS_WEB_URL: webOrigin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  web.stdout?.on("data", (chunk) => {
    webOutput += String(chunk);
  });
  web.stderr?.on("data", (chunk) => {
    webOutput += String(chunk);
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (web.exitCode !== null) throw new Error("ISOLATED_NEXT_EXITED");
    try {
      if ((await fetch(webOrigin + "/news")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Isolated startup only. */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  if (!ready) throw new Error("ISOLATED_NEXT_NOT_READY");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ([operatorOrigin, webOrigin].includes(url.origin))
      return route.continue();
    unexpectedRequests.push(url.origin + url.pathname);
    return route.abort();
  });
  const page = await context.newPage(),
    publicPage = await context.newPage();
  // The page under test may reload after a BFCache restore. Keep test-only
  // pageshow evidence across that reload instead of inferring BFCache use.
  await publicPage.addInitScript(() => {
    window.addEventListener("pageshow", (event) => {
      const key = "synthetic-publication-pageshow";
      const events = JSON.parse(sessionStorage.getItem(key) ?? "[]") as {
        path: string;
        persisted: boolean;
      }[];
      events.push({ path: location.pathname, persisted: event.persisted });
      sessionStorage.setItem(key, JSON.stringify(events.slice(-20)));
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  publicPage.on("pageerror", (error) => errors.push(error.message));
  await publicPage.goto(webOrigin + "/news");
  await expect(publicPage.locator("main")).toContainText(
    /お知らせ|Announcements|News/i,
  );
  await page.goto(operatorOrigin);
  await page.locator("#login-form input").fill("synthetic-incorrect-password");
  const rejectedLogin = page.waitForResponse(
    (response) =>
      response.url() === operatorOrigin + "/operator/session" &&
      response.request().method() === "POST",
  );
  await page.locator("#login-form button").click();
  expect((await rejectedLogin).status()).toBe(401);
  await expect(page.locator("#login")).toBeVisible();
  await page.locator("#login-form input").fill(password);
  await page.locator("#login-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  checks.push(
    "incorrect password can be corrected without a page reload or stale CSRF token",
  );
  await page.locator("[data-tab=publications]").click();
  await page.locator("#publication-new").click();
  const editor = page.locator("#publication-editor");
  await editor.locator('[name="category"]').selectOption("UPDATE");
  await editor
    .locator('[name="jaTitle"]')
    .fill("合成お知らせ A — ローカル検証");
  await editor
    .locator('[name="jaSummary"]')
    .fill("公開版と編集中を分離する合成テストです。");
  await editor
    .locator('[name="jaBody"]')
    .fill(
      "## 合成本文 A\n\n公開版 A は編集中の B に変わりません。\n\n" + malicious,
    );
  await editor.locator('button[type="submit"]').click();
  await expect.poll(async () => (await publications.list()).length).toBe(1);
  const article = (await publications.list())[0]!;
  const assertPrivateAbsent = async (path: string, markers: string[]) => {
    let htmlResponse: Response | undefined;
    for (const locale of ["ja", "en"] as const) {
      for (const rsc of [false, true]) {
        const url = new URL(path, webOrigin);
        if (rsc) url.searchParams.set("_rsc", "synthetic-publication-review");
        const headers = {
          Cookie: "nexus_locale=" + locale,
          ...(rsc ? { RSC: "1" } : {}),
        };
        let response = await fetch(url, { headers, redirect: "manual" });
        const location = response.headers.get("location");
        if (rsc && response.status === 307 && location) {
          const canonical = new URL(location, url);
          // Next normalizes its RSC query key. Never follow an auth redirect
          // or any destination outside this exact local page under test.
          if (
            canonical.origin === webOrigin &&
            canonical.pathname === url.pathname &&
            canonical.searchParams.has("_rsc")
          )
            response = await fetch(canonical, { headers, redirect: "manual" });
        }
        const body = await response.text();
        for (const marker of markers) expect(body).not.toContain(marker);
        if (response.status === 200 || path.startsWith("/news")) {
          expect(response.headers.get("cache-control") ?? "").toMatch(
            /no-store/,
          );
          if (rsc)
            expect(response.headers.get("content-type") ?? "").toContain(
              "text/x-component",
            );
        }
        if (!rsc && locale === "en") htmlResponse = response;
      }
    }
    return htmlResponse!;
  };
  for (const path of [
    "/news",
    "/news?category=UPDATE",
    `/news/${article.id}`,
    "/news?page=2",
  ])
    await assertPrivateAbsent(path, ["合成お知らせ A", "合成本文 A"]);
  checks.push(
    "draft absent from public list/detail/filter/pagination and English SSR",
  );
  await page.locator("#publication-preview").click();
  await expect(page.locator("#publication-preview-content")).toContainText(
    "合成本文 A",
  );
  await noExecutableMarkdown(page, "#publication-preview-content");
  const confirm = async (
    action: "publish" | "withdraw" | "discard",
    afterSubmit?: () => Promise<void>,
  ) => {
    await page.locator(`#publication-${action}`).click();
    await expect(page.locator("#publication-confirmation")).toBeVisible();
    const checks = page.locator(
      '#publication-confirm-form input[type="checkbox"]',
    );
    for (const check of await checks.all()) await check.check();
    await page
      .locator('#publication-confirm-form button[type="submit"]')
      .click();
    await afterSubmit?.();
    await expect(page.locator("#publication-confirmation")).not.toBeVisible();
  };
  const publicationMutationUrl = operatorOrigin + "/operator/publications";
  let releasePublish: (() => void) | undefined;
  let acknowledgePublish: (() => void) | undefined;
  const observedPublish = new Promise<void>((resolveObserved) => {
    acknowledgePublish = resolveObserved;
  });
  const publishGate = new Promise<void>((resolveGate) => {
    releasePublish = resolveGate;
  });
  await page.route(publicationMutationUrl, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    acknowledgePublish?.();
    await publishGate;
    await route.fulfill({ response });
  });
  try {
    await confirm("publish", async () => {
      await observedPublish;
      await expect(page.locator("#publication-confirm-form")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(page.locator("#publication-cancel")).toBeDisabled();
      await expect(
        page.locator('#publication-confirm-form button[type="submit"]'),
      ).toBeDisabled();
      // Disabled controls cannot be clicked by a user. Escape must not dismiss
      // a mutation whose server result is still in flight either.
      await page.keyboard.press("Escape");
      await expect(page.locator("#publication-confirmation")).toBeVisible();
      expect((await publications.detail(article.id)).status).toBe("PUBLISHED");
      releasePublish?.();
    });
  } finally {
    releasePublish?.();
    await page.unroute(publicationMutationUrl);
  }
  await expect(
    page.locator("#publication-edit-area .publication-status"),
  ).toHaveText(/公開中|Published/);
  checks.push(
    "in-flight publish locks Cancel/submit and blocks Escape; completed response updates editor to the committed public state",
  );
  await publicPage.goto(webOrigin + `/news/${article.id}`);
  await expect(publicPage.locator("main")).toContainText("合成本文 A");
  await noExecutableMarkdown(publicPage, ".news-body");
  await editor.locator('[name="jaTitle"]').fill(draftMarker);
  await editor
    .locator('[name="jaBody"]')
    .fill(`## ${draftMarker}\n\n未公開の編集内容。`);
  await editor.locator('button[type="submit"]').click();
  await expect
    .poll(async () => (await publications.detail(article.id)).content?.ja.title)
    .toBe(draftMarker);
  await page.locator("#publication-preview").click();
  await expect(page.locator("#publication-preview-content")).toContainText(
    draftMarker,
  );
  await publicPage.reload();
  await expect(publicPage.locator("main")).toContainText("合成本文 A");
  await assertPrivateAbsent(`/news/${article.id}`, [draftMarker]);
  checks.push(
    "saved revision B previews locally while immutable published A stays public; preview/public unsafe Markdown inert",
  );

  // These are real HTTP-boundary checks against the same authenticated listener.
  const cookie = (await context.cookies()).find(
    (value) => value.name === "nexus_operator",
  )!;
  const csrf = (await auth.read(cookie.value)).csrf;
  const headers = {
    host: new URL(operatorOrigin).host,
    origin: operatorOrigin,
    cookie: `nexus_operator=${cookie.value}`,
    "x-csrf-token": csrf,
  };
  const mutation = {
    id: article.id,
    expectedRevision: (await publications.detail(article.id)).revision,
    requestId: randomUUID(),
    action: "withdraw",
  };
  for (const [name, override, expected] of [
    ["unauthenticated", { cookie: "" }, 401],
    ["CSRF", { "x-csrf-token": "invalid" }, 403],
    ["Host", { host: "example.invalid" }, 403],
    ["Origin", { origin: "https://example.invalid" }, 403],
    ["forwarded", { "x-forwarded-host": "example.invalid" }, 403],
  ] as const) {
    const response = await operator.inject({
      method: "POST",
      url: "/operator/publications",
      headers: { ...headers, ...override },
      payload: mutation,
    });
    expect(response.statusCode, `${name} boundary`).toBe(expected);
  }
  expect((await publications.detail(article.id)).status).toBe("PUBLISHED");
  for (const path of [
    "/operator/publications",
    "/operator/legal",
    "/operator/legal/preview?document=terms&locale=en&revision=0",
  ]) {
    const response = await fetch(webOrigin + path, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
    });
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain(draftMarker);
  }
  checks.push(
    "separate public listener has no operator mutation; operator denies missing session, CSRF, Host, Origin and forwarding",
  );

  const replayedPublications: { requestId: string; [key: string]: unknown }[] =
    [];
  await page.route(publicationMutationUrl, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    replayedPublications.push(route.request().postDataJSON());
    const response = await route.fetch();
    // The first request commits, but its response never reaches the editor.
    if (replayedPublications.length === 1) return route.abort("failed");
    return route.fulfill({ response });
  });
  try {
    await confirm("publish", async () => {
      await expect(page.locator("#publication-confirm-status")).toContainText(
        /同じ確認番号|same reference/,
      );
      await expect(page.locator("#publication-confirmation")).toBeVisible();
      await expect(
        page.locator('#publication-confirm-form button[type="submit"]'),
      ).toBeEnabled();
      await page
        .locator('#publication-confirm-form button[type="submit"]')
        .click();
    });
  } finally {
    await page.unroute(publicationMutationUrl);
  }
  expect(replayedPublications).toHaveLength(2);
  expect(replayedPublications[1]).toEqual(replayedPublications[0]);
  expect(
    (
      await sql`SELECT request_id FROM official_publication_audit WHERE request_id=${replayedPublications[0]!.requestId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    page.locator("#publication-edit-area .publication-status"),
  ).toHaveText(/公開中|Published/);
  checks.push(
    "lost committed publish response retries the identical request UUID/payload, records one audit, and reconciles editor state",
  );
  await publicPage.reload();
  await expect(publicPage.locator("main")).toContainText(draftMarker);
  await expect(publicPage.locator("main")).not.toContainText("合成本文 A");
  checks.push(
    "explicit reviewed update publishes revision B at the same fixed article URL",
  );
  // Exercise real history navigation: leave the published article, withdraw it
  // while it is away, then return with Back (not an explicit browser reload).
  await publicPage.evaluate(() => {
    sessionStorage.removeItem("synthetic-publication-pageshow");
  });
  await publicPage.goto(webOrigin + "/support");
  await expect(publicPage.locator("#support-reply-email")).toBeVisible();
  await confirm("withdraw");
  const withdrawn = await assertPrivateAbsent(`/news/${article.id}`, [
    "合成本文 A",
    draftMarker,
  ]);
  expect(withdrawn.status).toBe(404);
  for (const path of ["/news", "/news?category=UPDATE"])
    await assertPrivateAbsent(path, ["合成お知らせ A", draftMarker]);
  await publicPage.goBack({ waitUntil: "domcontentloaded" });
  await expect(publicPage).toHaveURL(webOrigin + "/news/" + article.id);
  await expect(publicPage.locator("main")).toContainText(
    /このお知らせは表示できません|This announcement is not available/,
  );
  await expect(publicPage.locator("main")).not.toContainText("合成本文 A");
  await expect(publicPage.locator("main")).not.toContainText(draftMarker);
  const pageshowPersisted = await publicPage.evaluate((articlePath) => {
    const events = JSON.parse(
      sessionStorage.getItem("synthetic-publication-pageshow") ?? "[]",
    ) as { path: string; persisted: boolean }[];
    return events
      .filter((event) => event.path === articlePath)
      .map((event) => event.persisted);
  }, "/news/" + article.id);
  expect(pageshowPersisted.length).toBeGreaterThan(0);
  withdrawalBackNavigation = {
    pageshowPersisted,
    bfcacheObserved: pageshowPersisted.includes(true),
  };
  checks.push(
    "withdrawal excludes body/title from fresh JA/EN HTML and RSC, list, filters and leave/withdraw/Back navigation; responses no-store",
  );

  const seed = async (
    index: number,
    category: PublicationContent["category"] = "UPDATE",
    english = true,
  ) => {
    const id = randomUUID(),
      text = {
        title: `Synthetic update ${index}`,
        summary: "Synthetic local-only test summary.",
        body:
          `## Synthetic section ${index}\n\n` +
          "Long synthetic content. ".repeat(80) +
          `\n\nhttps://example.invalid/${"long-url/".repeat(30)}\n\n${wideTable}\n\n## More synthetic details\n\nSynthetic ending.`,
      };
    await publications.change({
      id,
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "save",
      content: {
        category,
        incidentStatus: category === "INCIDENT" ? "MONITORING" : "NONE",
        ja: { ...text, title: `合成お知らせ ${index}` },
        en: english ? text : null,
      },
      englishReviewed: english,
    });
    await publications.change({
      id,
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "publish",
      confirmed: true,
      translationsReviewed: true,
      target: "public-site",
    });
    return id;
  };
  const ids = [];
  for (let index = 0; index < 22; index++)
    ids.push(
      await seed(index, index === 21 ? "INCIDENT" : "UPDATE", index !== 21),
    );
  await context.addCookies([
    { name: "nexus_locale", value: "en", url: webOrigin },
  ]);
  await publicPage.goto(webOrigin + "/news");
  const next = publicPage.getByRole("link", { name: "Next page", exact: true });
  await next.focus();
  await publicPage.keyboard.press("Enter");
  await expect(publicPage).toHaveURL(/page=2/);
  await expect(publicPage.locator("#news-results")).toBeFocused();
  await publicPage.goBack();
  await expect(publicPage).not.toHaveURL(/page=2/);
  await publicPage
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("INCIDENT");
  await publicPage
    .getByRole("button", { name: "Apply filter", exact: true })
    .click();
  await expect(publicPage).toHaveURL(/category=INCIDENT/);
  await expect(publicPage.locator("#news-results")).toBeFocused();
  await publicPage.goto(
    webOrigin + `/news/${ids.at(-1)}?category=INCIDENT&page=1`,
  );
  await expect(publicPage.locator("main")).toContainText(/Japanese|日本語/);
  await expect(publicPage.locator("main")).toContainText("合成お知らせ 21");
  await expect(
    publicPage
      .getByRole("link", {
        name: "Back to announcements",
        exact: true,
      })
      .first(),
  ).toHaveAttribute("href", /category=INCIDENT/);
  for (const locale of ["ja", "en"] as const) {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: webOrigin },
    ]);
    for (const width of [320, 375, 768, 1025, 1100]) {
      await publicPage.setViewportSize({ width, height: 900 });
      await publicPage.goto(webOrigin + `/news/${ids[0]}`);
      await fits(publicPage);
      await keyboardTable(publicPage, ".news-body");
      if (width >= 1025) {
        const brand = (await publicPage
          .locator(".nx-nav-inner > a")
          .boundingBox())!;
        const actions = (await publicPage
          .locator(".nx-nav-actions")
          .boundingBox())!;
        const nav = publicPage.locator(".nx-desktop-nav a");
        await expect(nav).toHaveCount(7);
        const first = (await nav.first().boundingBox())!;
        const last = (await nav.last().boundingBox())!;
        expect(
          first.x,
          `header brand/navigation overlap ${locale} ${width}`,
        ).toBeGreaterThanOrEqual(brand.x + brand.width);
        expect(
          last.x + last.width,
          `header navigation/actions overlap ${locale} ${width}`,
        ).toBeLessThanOrEqual(actions.x);
      }
      await publicPage.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await publicPage.screenshot({
        path: `${outputDirectory}/news-${locale}-${width}.png`,
        fullPage: true,
      });
      await publicPage.screenshot({
        path: `${outputDirectory}/news-${locale}-${width}-viewport.png`,
      });
    }
  }
  checks.push(
    "real database pagination/filter keyboard and focus; no-English fallback; JA/EN long body and URL at 320/375/768",
  );

  await publicPage.setViewportSize({ width: 1280, height: 900 });
  await publicPage.goto(webOrigin + "/news/" + ids[0]);
  await publicPage.screenshot({
    path: `${outputDirectory}/news-en-1280-viewport.png`,
  });
  const contents = publicPage.locator(".news-contents a");
  await expect(contents).toHaveCount(2);
  const firstAnchor = (await contents.first().getAttribute("href"))!;
  const secondAnchor = (await contents.nth(1).getAttribute("href"))!;
  await contents.first().focus();
  await publicPage.keyboard.press("Enter");
  await expect(publicPage.locator(firstAnchor)).toBeFocused();
  await contents.nth(1).focus();
  await publicPage.keyboard.press("Enter");
  await expect(publicPage.locator(secondAnchor)).toBeFocused();
  await publicPage.goBack();
  await expect(publicPage).toHaveURL(new RegExp(firstAnchor + "$"));
  await anchorClearOfHeader(publicPage, firstAnchor);
  await publicPage.goForward();
  await expect(publicPage).toHaveURL(new RegExp(secondAnchor + "$"));
  await anchorClearOfHeader(publicPage, secondAnchor);
  await publicPage.goto(webOrigin + "/news");
  await publicPage.goto(webOrigin + "/news/" + ids[0] + firstAnchor);
  await expect(publicPage.locator(firstAnchor)).toBeFocused();
  await anchorClearOfHeader(publicPage, firstAnchor);
  await expect
    .poll(async () => (await publicPage.locator(firstAnchor).boundingBox())!.y)
    .toBeGreaterThanOrEqual(0);
  checks.push(
    "article TOC keyboard activation, direct hash visits, and Back/Forward preserve section targets",
  );
  const retainEditAcrossRead = async (
    path: string,
    trigger: () => Promise<void>,
    edit: () => Promise<void>,
  ) => {
    const url = operatorOrigin + path;
    let releaseRead: (() => void) | undefined;
    let acknowledge: (() => void) | undefined;
    const observedRead = new Promise<void>((resolveObserved) => {
      acknowledge = resolveObserved;
    });
    const readGate = new Promise<void>((resolveGate) => {
      releaseRead = resolveGate;
    });
    await page.route(url, async (route) => {
      const response = await route.fetch();
      acknowledge?.();
      await readGate;
      await route.fulfill({ response });
    });
    const completedRead = page.waitForResponse(
      (response) => response.url() === url,
    );
    try {
      await trigger();
      await observedRead;
      await edit();
      releaseRead?.();
      await completedRead;
      await page.evaluate(
        () =>
          new Promise<void>((resolveFrame) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolveFrame()),
            ),
          ),
      );
    } finally {
      releaseRead?.();
      await page.unroute(url);
    }
  };
  await page.locator("[data-tab=publications]").click();
  const selectedOther = page.locator(
    '[data-publication-select="' + ids[0] + '"]',
  );
  await expect(selectedOther).toBeVisible();
  await retainEditAcrossRead(
    "/operator/publications/" + ids[0],
    () => selectedOther.click(),
    () =>
      editor
        .locator('[name="jaTitle"]')
        .fill("SYNTHETIC-DIRTY-EDIT-DURING-READ"),
  );
  await expect(editor.locator('[name="jaTitle"]')).toHaveValue(
    "SYNTHETIC-DIRTY-EDIT-DURING-READ",
  );
  await editor.locator('button[type="submit"]').click();
  await expect
    .poll(async () => (await publications.detail(article.id)).content?.ja.title)
    .toBe("SYNTHETIC-DIRTY-EDIT-DURING-READ");
  await page.locator("[data-tab=legal]").click();
  await expect(page.locator("#legal-settings-form")).toBeVisible();
  await retainEditAcrossRead(
    "/operator/legal",
    () => page.locator("#reload").click(),
    () =>
      page
        .locator('#legal-settings-form [name="legalName"]')
        .fill("SYNTHETIC-DIRTY-OWNER-DURING-READ"),
  );
  await expect(
    page.locator('#legal-settings-form [name="legalName"]'),
  ).toHaveValue("SYNTHETIC-DIRTY-OWNER-DURING-READ");
  checks.push(
    "delayed article selection and legal reload do not overwrite edits made while a GET is in flight",
  );
  const settings = page.locator("#legal-settings-form");
  for (const [name, value] of Object.entries({
    legalName: ownerMarker,
    address: "SYNTHETIC-ADDRESS-NOT-REAL",
    supportEmail: "synthetic-support@example.invalid",
    rightsEmail: "synthetic-rights@example.invalid",
    effectiveDate: "2026-10-09",
    version: "synthetic-review-only",
    other: "Synthetic private field; not a real identity.",
  }))
    await settings.locator(`[name="${name}"]`).fill(value);
  await settings.locator('button[type="submit"]').click();
  await expect.poll(async () => (await publications.legal()).revision).toBe(1);
  await page.locator("#legal-review-document").selectOption("terms");
  await page.locator("#legal-review-load").click();
  await expect(page.locator("#legal-review-content")).toContainText(
    privateMarker,
  );
  await noExecutableMarkdown(page, "#legal-review-content");
  for (const path of [
    "/terms",
    "/privacy",
    "/legal",
    "/legal/beta",
    "/legal/operator",
    "/legal/history",
    "/support",
    "/sitemap.xml",
    "/api/legal",
    "/api/operator/legal",
    "/legal/candidates/terms.ja.md",
    "/legal/candidates/terms.en.md",
  ]) {
    await assertPrivateAbsent(path, [
      privateMarker,
      ownerMarker,
      "synthetic-support@example.invalid",
      "synthetic-rights@example.invalid",
      "SYNTHETIC-ADDRESS-NOT-REAL",
      "[要確定]",
      "[To be confirmed]",
    ]);
  }
  await publicPage.goto(webOrigin + "/support");
  await expect(publicPage.locator("#support-reply-email")).toBeVisible();
  await expect(publicPage.locator("#support-reply-email")).toBeDisabled();
  await expect(
    publicPage.locator(".support-contact-form button"),
  ).toBeDisabled();
  await publicPage.emulateMedia({ media: "print" });
  expect(await publicPage.locator("body").innerText()).not.toContain(
    ownerMarker,
  );
  await publicPage.emulateMedia({ media: "screen" });
  checks.push(
    "legal candidate and entered owner/contact details absent from public SSR, locale fallback, sitemap and print; support has disabled no-send form",
  );

  for (const [locale, width] of [
    ["ja", 375],
    ["en", 768],
  ] as const) {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: webOrigin },
    ]);
    await publicPage.setViewportSize({ width, height: 900 });
    for (const path of ["/terms", "/support"]) {
      await publicPage.goto(webOrigin + path);
      await fits(publicPage);
      await publicPage.screenshot({
        path: `${outputDirectory}/public-${path.slice(1)}-${locale}-${width}-viewport.png`,
      });
    }
  }
  const legal = page.locator("#legal-review-content");
  for (const locale of ["ja", "en"] as const) {
    await page.locator("#locale").selectOption(locale);
    await page.locator("[data-tab=legal]").click();
    await page.locator("#legal-review-document").selectOption("terms");
    await page.locator("#legal-review-locale").selectOption(locale);
    await page.locator("#legal-review-load").click();
    await expect(legal).toContainText(`SYNTHETIC-DOCUMENT-END-terms-${locale}`);
    await expect(legal.locator(".publication-header h2")).toHaveText(
      locale === "ja" ? "利用規約" : "Terms of Service",
    );
    await expect(legal.locator(".publication-header")).toContainText(
      locale === "ja" ? "文書更新日" : "Document updated",
    );
    await expect(legal.locator(".publication-header")).toContainText(
      locale === "ja" ? "未確定" : "Unconfirmed",
    );
    const toc = page.locator('#legal-review-content a[href^="#"]');
    if (await toc.count()) {
      await toc.first().focus();
      const target = decodeURIComponent(
        (await toc.first().getAttribute("href"))!,
      );
      await page.keyboard.press("Enter");
      await expect(page.locator(target!)).toBeFocused();
      expect(
        (await page.locator(target!).boundingBox())!.y,
      ).toBeGreaterThanOrEqual(0);
    } else throw new Error("LEGAL_TOC_MISSING");
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await fits(page);
      await keyboardTable(page, "#legal-review-content");
      await legal.scrollIntoViewIfNeeded();
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: `${outputDirectory}/legal-synthetic-${locale}-${width}.png`,
        fullPage: true,
      });
      await legal.evaluate((element) =>
        element.scrollIntoView({ block: "start" }),
      );
      await page.screenshot({
        path: `${outputDirectory}/legal-synthetic-${locale}-${width}-viewport.png`,
      });
    }
    await page.emulateMedia({ media: "print" });
    await expect(legal).toBeVisible();
    await expect(legal).toContainText(`SYNTHETIC-DOCUMENT-END-terms-${locale}`);
    await expect(page.locator("body > header")).not.toBeVisible();
    await expect(legal.locator("tbody td").last()).toHaveText(
      "Synthetic cell 16",
    );
    await expect(legal.locator("tbody td").last()).toBeVisible();
    await page.pdf({
      path: `${outputDirectory}/legal-synthetic-${locale}.pdf`,
      format: "A4",
      printBackground: true,
    });
    await page.emulateMedia({ media: "screen" });
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await fits(page);
  await page.screenshot({
    path: `${outputDirectory}/legal-synthetic-200percent.png`,
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  checks.push(
    "local synthetic legal layout: JA/EN TOC keyboard focus, 320/375/768, 200% CSS zoom approximation, reduced motion and print full ending",
  );

  // Delay an authenticated response beyond logout. It must never repopulate the
  // hidden private subtree after session invalidation.
  let release: (() => void) | undefined;
  let observed: (() => void) | undefined;
  const intercepted = new Promise<void>((resolveObserved) => {
    observed = resolveObserved;
  });
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  await page.route("**/operator/legal/*/*?revision=*", async (route) => {
    const response = await route.fetch();
    observed?.();
    await gate;
    await route.fulfill({ response });
  });
  const delayedResponse = page.waitForResponse((response) =>
    /\/operator\/legal\/(terms|privacy|beta)\/(ja|en)\?/.test(response.url()),
  );
  await page.locator("#legal-review-load").click();
  await intercepted;
  await page.locator("#logout").click();
  await expect(page.locator("#login")).toBeVisible();
  release?.();
  await delayedResponse;
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolveFrame()),
        ),
      ),
  );
  await expect(page.locator("#legal")).toBeEmpty();
  await expect(page.locator("#publications")).toBeEmpty();
  expect(await page.locator("body").innerHTML()).not.toContain(privateMarker);
  expect(await page.locator("body").innerHTML()).not.toContain(ownerMarker);
  await page.unroute("**/operator/legal/*/*?revision=*");
  await page.locator("#login-form input").fill(password);
  await page.locator("#login-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("[data-tab=legal]").click();
  await expect(
    page.locator('#legal-settings-form [name="legalName"]'),
  ).toHaveValue(ownerMarker);
  await sql`UPDATE operator_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE revoked_at IS NULL`.execute(
    db,
  );
  await page.locator("#reload").click();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#legal")).toBeEmpty();
  await expect(page.locator("#publications")).toBeEmpty();
  const expired = await operator.inject({
    method: "POST",
    url: "/operator/publications",
    headers,
    payload: mutation,
  });
  expect(expired.statusCode).toBe(401);
  await page.locator("#login-form input").fill(password);
  await page.locator("#login-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("#logout").click();
  await expect(page.locator("#login")).toBeVisible();
  checks.push(
    "logout clears private DOM, late response cannot restore it, expired session returns 401 and clears operator content",
  );
  expect(errors).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  await writeFile(
    `${outputDirectory}/result.json`,
    JSON.stringify(
      {
        passed: true,
        checks,
        withdrawalBackNavigation,
        notes: [
          "All article/owner data synthetic and isolated; no external sends.",
          "Legal layout uses injected synthetic text, not canonical legal prose.",
          "CSS zoom approximates 200%; native browser zoom and screen-reader not run.",
        ],
        unexpectedRequests,
        errors,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `PASS official publications UI: ${checks.length} grouped checks; artifacts in ${outputDirectory}\n`,
  );
} catch (error) {
  for (const [contextIndex, context] of (browser?.contexts() ?? []).entries()) {
    for (const [pageIndex, page] of context.pages().entries())
      await page
        .screenshot({
          path: `${outputDirectory}/failure-${contextIndex}-${pageIndex}.png`,
          fullPage: true,
        })
        .catch(() => {});
  }
  await writeFile(
    `${outputDirectory}/result.json`,
    JSON.stringify(
      {
        passed: false,
        completedChecks: checks,
        withdrawalBackNavigation,
        unexpectedRequests,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await stopChild(web);
  await operator?.close();
  await db.destroy();
  await infra.stop();
  await writeFile(`${outputDirectory}/web-server.log`, webOutput);
}
