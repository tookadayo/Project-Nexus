import { chromium, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { isolatedPostgres } from "../fixtures/postgres";
import { connect, migrate, sql } from "../../packages/db/src/index";
import {
  OperatorAuth,
  passwordCredentials,
} from "../../packages/security/src/operator-auth";
import { BetaOperator } from "../../packages/security/src/beta-operator";
import { createOperatorServer } from "../../apps/operator/src/server";
import { createSyntheticLegalFixture } from "../fixtures/legal-candidates";

const output = ".local/legal-candidates-ui";
const password = "synthetic-legal-source-browser-password";
const fixture = await createSyntheticLegalFixture();
const legalSourceFiles = fixture.manifest.sources;
const previousManifest = process.env.NEXUS_LEGAL_REVIEW_MANIFEST;
const previousContacts = process.env.NEXUS_LEGAL_CONTACTS_PATH;
process.env.NEXUS_LEGAL_REVIEW_MANIFEST = fixture.manifestPath;
process.env.NEXUS_LEGAL_CONTACTS_PATH = fixture.contactsPath;
const markers = [
  "TEST_BODY_JA",
  "TEST_BODY_EN",
  "TEST_SOURCE_INTRO",
  "TEST_EDITORIAL",
  "TEST_INTEGRATION_NOTES",
  "TEST_ANNOUNCEMENT_NOTES",
  ...Object.values(legalSourceFiles).map((spec) => spec.sha256),
];
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
// Independent projection of deliberately synthetic test-only text.
// Every fixture marker, list item and table cell must survive the DOM render.
function expectedText(source: string) {
  return normalize(
    source
      .replaceAll(fixture.editorialMarker, "")
      .replace(/Hosted Beta(?:\s?1)?/g, "Closed Beta 1")
      .split("\n")
      .filter((line) => !/^(?:---|\|[-| ]+\|)\s*$/.test(line))
      .map((line) =>
        /^#+ /.test(line)
          ? line.replace(/^#+ /, "")
          : line.replace(/^\s*(?:-|\d+[.)])\s+/, ""),
      )
      .join("\n")
      .replace(/\|/g, " ")
      .replace(/\*\*/g, ""),
  );
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_PORT_UNAVAILABLE");
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
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
process.env.NEXUS_HOSTED_BETA = "on";
await mkdir(output, { recursive: true });
const infra = await isolatedPostgres(),
  db = connect(infra.databaseUrl);
let operator: ReturnType<typeof createOperatorServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let web: ChildProcess | undefined;
let webLog = "";
const checks: string[] = [],
  requests: string[] = [],
  errors: string[] = [];
let layouts = 0;
try {
  await migrate(db);
  const operatorPort = await freePort(),
    webPort = await freePort();
  const operatorOrigin = "http://127.0.0.1:" + operatorPort,
    webOrigin = "http://127.0.0.1:" + webPort;
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
  ); // Production candidate loader reads the explicitly configured synthetic manifest.
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
    webLog += String(chunk);
  });
  web.stderr?.on("data", (chunk) => {
    webLog += String(chunk);
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (web.exitCode !== null) throw new Error("ISOLATED_NEXT_EXITED");
    try {
      if ((await fetch(webOrigin + "/terms")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* isolated startup */
    }
    await new Promise((yes) => setTimeout(yes, 200));
  }
  if (!ready) throw new Error("ISOLATED_NEXT_NOT_READY");

  for (const path of [
    "/operator/legal",
    "/operator/legal/terms/ja?revision=0",
    "/operator/legal/privacy/en?revision=0",
  ]) {
    const denied = await fetch(operatorOrigin + path);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(denied.headers.get("x-robots-tag")).toContain("noindex");
    const deniedText = await denied.text();
    for (const marker of markers) expect(deniedText).not.toContain(marker);
    const publicSession = await fetch(operatorOrigin + path, {
      headers: { Cookie: "nexus_session=synthetic-public-session" },
    });
    expect(publicSession.status).toBe(401);
    const rejectedHeaders: Record<string, string>[] = [
      { host: "invalid.test:" + operatorPort },
      { origin: "https://invalid.test" },
    ];
    for (const headers of rejectedHeaders) {
      const rejected = await operator.inject({
        method: "GET",
        url: path,
        headers: { host: new URL(operatorOrigin).host, ...headers },
      });
      expect(rejected.statusCode).toBe(403);
    }
  }
  for (const asset of [
    "/",
    "/operator-ui.js",
    "/legal/sources/" + legalSourceFiles.ja.fileName,
  ]) {
    const response = await fetch(operatorOrigin + asset),
      text = await response.text();
    for (const marker of markers) expect(text).not.toContain(marker);
  }
  checks.push(
    "actual loader: unauthenticated and public sessions denied; Host/Origin checks, no-store/noindex, no static-source exposure",
  );

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ([operatorOrigin, webOrigin].includes(url.origin))
      return route.continue();
    requests.push(url.origin + url.pathname);
    return route.abort();
  });
  const page = await context.newPage(),
    publicPage = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  publicPage.on("pageerror", (error) => errors.push(error.message));
  await page.goto(operatorOrigin);
  await page.locator("#login-form input").fill(password);
  await page.locator("#login-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();

  for (const locale of ["ja", "en"] as const) {
    const parts = fixture.bodies[locale];
    await page.locator("#locale").selectOption(locale);
    await page.locator("[data-tab=legal]").click();
    const contacts = page.locator("#legal-confirmed-contacts");
    await expect(contacts).toContainText("support@example.invalid");
    await expect(contacts).toContainText("privacy@example.invalid");
    const settings = page.locator("#legal-settings-form");
    for (const name of [
      "legalName",
      "address",
      "supportEmail",
      "rightsEmail",
      "effectiveDate",
      "version",
    ])
      await expect(settings.locator('[name="' + name + '"]')).toHaveValue("");
    for (const document of ["terms", "privacy", "beta"] as const) {
      await page.locator("#legal-review-document").selectOption(document);
      await page.locator("#legal-review-locale").selectOption(locale);
      const responseWait = page.waitForResponse((response) =>
        response.url().includes("/operator/legal/" + document + "/" + locale),
      );
      await page.locator("#legal-review-load").click();
      const response = await responseWait,
        dto = await response.json();
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(dto.releaseBlocked).toBe(true);
      expect(dto.review.source.sha256).toBe(legalSourceFiles[locale].sha256);
      const root = page.locator("#legal-review-content");
      const body = root.locator(".publication-layout > .publication-body");
      await expect(body).toBeVisible();
      expect(normalize(await body.innerText())).toBe(
        expectedText(parts[document]),
      );
      expect(await body.innerHTML()).not.toMatch(/<script|<iframe|<img|<form/);
      const toc = root.locator(".publication-toc a");
      expect(await toc.count()).toBe(
        document === "terms" ? 13 : document === "privacy" ? 15 : 1,
      );
      for (const link of [toc.first(), toc.last()]) {
        const target = decodeURIComponent((await link.getAttribute("href"))!);
        await link.focus();
        await page.keyboard.press("Enter");
        await expect(page.locator(target)).toBeFocused();
        await expect(page.locator(target)).toBeInViewport();
      }
      await expect(root.locator(".publication-header")).toContainText(
        legalSourceFiles[locale].sha256,
      );
      await expect(root.locator(".publication-header")).toContainText(
        locale === "ja" ? "未確定" : "To be confirmed",
      );
      const appendix = root.locator('[data-note="editorialAppendix"]');
      await appendix.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(appendix.locator(".publication-body")).toBeVisible();
      expect(await appendix.locator(".publication-body").innerText()).toContain(
        "TEST_EDITORIAL_END",
      );
      if (locale === "en")
        await expect(appendix).toContainText(
          "No English translation has been added",
        );
      await appendix.locator("summary").click();
      const ids = await root
        .locator("[id]")
        .evaluateAll((nodes) => nodes.map((node) => node.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await fits(page);
        await body.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: output + "/" + document + "-" + locale + "-" + width + ".png",
        });
        layouts++;
      }
      if (document === "privacy") {
        const table = body.locator(".publication-table-scroll");
        await expect(table.locator("tbody tr")).toHaveCount(5);
        await table.focus();
        await expect(table).toBeFocused();
        await page.setViewportSize({ width: 768, height: 900 });
        await page.evaluate(() => {
          window.document.documentElement.style.zoom = "2";
        });
        await fits(page);
        await page.evaluate(() => {
          window.document.documentElement.style.zoom = "";
        });
      }
      await page.emulateMedia({ media: "print" });
      expect(normalize(await body.innerText())).toBe(
        expectedText(parts[document]),
      );
      await expect(root.locator("#legal-review-notes")).not.toBeVisible();
      await expect(root.locator(".publication-status").first()).toBeVisible();
      await page.emulateMedia({ media: "screen" });
    }
  }
  checks.push(
    "all six synthetic documents: every test-only body marker, table cell and ending matches the external fixture input with documented display changes",
  );
  checks.push(
    "JA/EN Terms 12 / Privacy 14 / Beta, 24 responsive layouts, TOC keyboard focus, appendix disclosure, unique anchors, print and 200% CSS zoom",
  );

  const publicPaths = [
    "/terms",
    "/privacy",
    "/legal",
    "/legal/beta",
    "/legal/operator",
    "/legal/history",
    "/support",
    "/news",
    "/sitemap.xml",
    "/api/legal",
    "/api/operator/legal",
    "/operator/legal/terms/ja?revision=0",
    ...Object.values(legalSourceFiles).map(
      (spec) => "/legal/sources/" + encodeURIComponent(spec.fileName),
    ),
    "/legal/candidates/terms.ja.md",
    "/legal/candidates/terms.en.md",
  ];
  for (const path of publicPaths)
    for (const locale of ["ja", "en"])
      for (const rsc of [false, true]) {
        const url = new URL(path, webOrigin);
        if (rsc) url.searchParams.set("_rsc", "legal-source-review");
        const headers = {
          Cookie: "nexus_locale=" + locale,
          ...(rsc ? { RSC: "1" } : {}),
        };
        let response = await fetch(url, { headers, redirect: "manual" });
        const location = response.headers.get("location");
        if (rsc && response.status === 307 && location) {
          const redirect = new URL(location, url);
          if (
            redirect.origin === webOrigin &&
            redirect.pathname === url.pathname &&
            redirect.searchParams.has("_rsc")
          )
            response = await fetch(redirect, { headers, redirect: "manual" });
        }
        const body = await response.text();
        for (const marker of markers) expect(body).not.toContain(marker);
        if (response.status === 200)
          expect(response.headers.get("cache-control")).toContain("no-store");
      }
  for (const locale of ["ja", "en"]) {
    await context.addCookies([
      { name: "nexus_locale", value: locale, url: webOrigin },
    ]);
    for (const path of ["/terms", "/privacy", "/legal/beta"]) {
      await publicPage.goto(webOrigin + path);
      await expect(publicPage.locator("main")).toContainText(
        locale === "ja"
          ? "公開文書はまだありません"
          : "No published document is available",
      );
      await publicPage.emulateMedia({ media: "print" });
      const text = await publicPage.locator("body").innerText();
      for (const marker of markers) expect(text).not.toContain(marker);
      await publicPage.emulateMedia({ media: "screen" });
    }
  }
  checks.push(
    "public JA/EN SSR, RSC, API, source paths, sitemap and print expose no candidate or editorial content; no-store on successful public reads",
  );

  await sql
    .raw(
      "UPDATE operator_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE revoked_at IS NULL",
    )
    .execute(db);
  await page.locator("#legal-review-load").click();
  await expect(page.locator("#login")).toBeVisible();
  await expect(page.locator("#legal")).toBeEmpty();
  expect(await page.locator("body").innerHTML()).not.toContain(
    fixture.manifest.sources.ja.sha256,
  );
  await page.locator("#login-form input").fill(password);
  await page.locator("#login-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("[data-tab=legal]").click();
  await page.locator("#legal-review-load").click();
  await expect(
    page.locator("#legal-review-content .publication-body").first(),
  ).toBeVisible();
  await page.locator("#logout").click();
  await expect(page.locator("#legal")).toBeEmpty();
  checks.push(
    "session expiration and logout clear candidate bodies, metadata and original editorial notes from the private DOM",
  );
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        passed: true,
        layouts,
        checks,
        errors,
        unexpectedRequests: requests,
        notes: [
          "Only synthetic external review inputs are exercised; no real legal documents, owner details, consent, payments or outgoing messages.",
          "Isolated synthetic credentials and disposable PostgreSQL. Does not verify production Windows operator credential ACL.",
          "CSS zoom approximates 200%; no physical mobile or screen reader test.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS external synthetic legal source UI: " +
      checks.length +
      " groups, " +
      layouts +
      " layouts",
  );
} catch (error) {
  for (const context of browser?.contexts() ?? [])
    for (const [index, page] of context.pages().entries())
      await page
        .screenshot({
          path: output + "/failure-" + index + ".png",
          fullPage: true,
        })
        .catch(() => {});
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        passed: false,
        layouts,
        checks,
        errors,
        unexpectedRequests: requests,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await stop(web);
  await operator?.close();
  await db.destroy();
  await infra.stop();
  await writeFile(output + "/web-server.log", webLog);
  if (previousManifest === undefined)
    delete process.env.NEXUS_LEGAL_REVIEW_MANIFEST;
  else process.env.NEXUS_LEGAL_REVIEW_MANIFEST = previousManifest;
  if (previousContacts === undefined)
    delete process.env.NEXUS_LEGAL_CONTACTS_PATH;
  else process.env.NEXUS_LEGAL_CONTACTS_PATH = previousContacts;
  await fixture.cleanup();
}
