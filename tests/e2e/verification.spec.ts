import { test, expect, type BrowserContext } from "./alpha17-verification-fixture";
import { navigateDashboard } from "./dashboard-navigation";
import type { APIResponse, Page } from "@playwright/test";
const base = process.env.NEXUS_VERIFICATION_WEB_ORIGIN ?? `http://127.0.0.1:${process.env.NEXUS_VERIFICATION_WEB_PORT ?? 3150}`,
  fixture = `http://127.0.0.1:${process.env.NEXUS_VERIFICATION_API_PORT ?? 3151}`;
const ids = [
    "931111111111111111",
    "931111111111111112",
    "931111111111111113",
    "931111111111111114",
  ],
  user = "911111111111111111",
  other = "911111111111111112";
async function signIn(context: BrowserContext, userId = user, locale = "en") {
  const response = await context.request.post(`${fixture}/fixture/session`, {
    data: { userId },
  });
  expect(response.status()).toBe(200);
  const { reference } = (await response.json()) as { reference: string };
  // Check the opaque format without including a session value in assertion logs.
  expect(typeof reference).toBe("string");
  expect(/^[A-Za-z0-9_-]{43}$/.test(reference)).toBe(true);
  await context.addCookies([
    {
      name: "nexus_session",
      value: reference,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
    { name: "nexus_locale", value: locale, url: base },
  ]);
}
// Obtain the real session-bound proof through Next; never synthesize a token or
// install a global header that would bypass the intentional rejection tests.
async function sessionCsrfHeaders(context: BrowserContext, guildId: string) {
  const issued = await context.request.get(base + "/servers", { maxRedirects: 0 });
  expect(issued.status()).toBe(200);
  const token = (await context.cookies(base)).find(cookie => cookie.name === "nexus_csrf")?.value;
  expect(Boolean(token && /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token))).toBe(true);
  if (!token) throw new Error("TEST_SESSION_CSRF_NOT_ISSUED");
  return { origin: base, "sec-fetch-site": "same-origin", "X-Nexus-Guild": guildId, "X-Nexus-CSRF": token };
}
async function confirmSelectedGuild(page: Page, guildId: string) {
  expect(new URL(page.url()).pathname).toBe("/auth/select");
  expect(new URL(page.url()).searchParams.get("guild")).toBe(guildId);
  const confirmed = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/select" && response.request().method() === "POST");
  await page.getByRole("button", { name: /Open$/ }).click();
  expect((await confirmed).status()).toBe(303);
}
async function safeResponseStatus(response: APIResponse) {
  if (response.ok()) return "status=" + response.status();
  const body: unknown = await response.json().catch(() => undefined);
  const value = body && typeof body === "object" && "error" in body ? body.error : undefined;
  const code = typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : "UNCLASSIFIED";
  return "status=" + response.status() + " error=" + code;
}
for (const locale of ["en", "ja"])
  test(`verification pages show four real states and fit mobile (${locale})`, async ({
    page,
    context,
  }) => {
    await signIn(context, user, locale);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/servers");
    for (const state of [
      "VERIFIED",
      "INSTALLED_NOT_VERIFIED",
      "VERIFICATION_PENDING",
      "NOT_INSTALLED",
    ])
      await expect(page.locator(`[data-state="${state}"]`)).toHaveCount(1);
    await expect(
      page.getByText("Unauthorized community", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      caret: "initial",
      path: `test-results/verification-${locale}-servers-mobile.png`,
      fullPage: true,
    });
    await page.goto("/link");
    await expect(
      page.getByLabel(locale === "ja" ? "接続コード" : "Verification code", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      caret: "initial",
      path: `test-results/verification-${locale}-link-mobile.png`,
      fullPage: true,
    });
  });
test("logged-out /link returns through OAuth and GET cannot redeem", async ({
  request,
}) => {
  const response = await request.get("/link", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/auth/login?next=%2Flink");
  const login = await request.get("/auth/login?next=/link", {
    maxRedirects: 0,
  });
  expect(login.headers().location).toContain("discord.com/oauth2/authorize");
  expect(login.headers()["set-cookie"]).toContain("nexus_oauth_next");
  // Missing CSRF and missing session are separate rejections. Keep the real
  // anonymous cookie binding issued by the preceding /auth/login GET.
  const csrfRejected = await request.post("/link/redeem", {
    headers: { origin: base, "sec-fetch-site": "same-origin" },
    data: { code: "invalid" },
  });
  expect(csrfRejected.status()).toBe(403);
  expect(await csrfRejected.json()).toEqual({ error: "CSRF_REJECTED" });
  const state = await request.storageState();
  const originCookies = state.cookies.filter(cookie => cookie.domain === new URL(base).hostname && cookie.path === "/");
  expect(originCookies.some(cookie => cookie.name === "nexus_session")).toBe(false);
  const csrf = originCookies.find(cookie => cookie.name === "nexus_csrf")?.value;
  expect(Boolean(csrf && /^[A-Za-z0-9_-]{32}[.][A-Za-z0-9_-]{43}$/.test(csrf))).toBe(true);
  if (!csrf) throw new Error("TEST_ANONYMOUS_CSRF_NOT_ISSUED");
  const sessionResponse = await request.post("/link/redeem", {
    headers: { origin: base, "sec-fetch-site": "same-origin", "X-Nexus-CSRF": csrf },
    data: { code: "invalid" },
  });
  expect(sessionResponse.status()).toBe(401);
  expect(await sessionResponse.json()).toEqual({ error: "SESSION_REQUIRED" });
});
test("unverified and arbitrary URLs cannot expose dashboard data", async ({
  page,
  context,
}) => {
  await signIn(context);
  for (const guildId of [ids[1]!, ids[2]!, "999111111111111112"]) {
    await page.goto(`/dashboard/${guildId}`);
    await confirmSelectedGuild(page, guildId);
    // Selection is a real CSRF-protected POST; it does not authorize an
    // unverified or arbitrary guild to read the dashboard.
    await page.goto(`/dashboard/${guildId}`);
    await expect(page).toHaveURL(/\/servers$/);
  }
  const get = await page.request.get("/link/redeem?code=ignored");
  expect(get.status()).toBe(405);
  const cross = await page.request.post("/link/redeem", {
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    data: { code: "invalid" },
  });
  expect(cross.status()).toBe(403);
});
test("issuer-only redemption and confirmed disconnect preserve settings while Beta deletion prevents renewed access", async ({
  page,
  context,
  request,
  browser,
}) => {
  await signIn(context);
  const issue = await request.post(`${fixture}/fixture/code`, {
      data: { guildId: ids[1] },
    }),
    { code } = (await issue.json()) as { code: string };
  const second = await browser.newContext();
  await signIn(second, other);
  const otherPage = await second.newPage();
  await otherPage.goto(`${base}/link`);
  await otherPage.getByLabel("Verification code", { exact: true }).fill(code);
  await otherPage
    .getByRole("button", { name: "Connect server", exact: true })
    .click();
  await expect(otherPage.locator('p[role="alert"]')).toContainText(
    "This code cannot be used",
  );
  await second.close();
  const capturedUrls: string[] = [];
  page.on("request", (req) => capturedUrls.push(req.url()));
  await page.goto("/link");
  await page.getByLabel("Verification code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Connect server", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
  expect(capturedUrls.every((url) => !url.includes(code))).toBe(true);
  await page.getByRole("link", { name: "Open Dashboard", exact: true }).click();
  await confirmSelectedGuild(page, ids[1]!);
  await expect(page).toHaveURL(base + "/setup?guild=" + ids[1]);
  // The fixture has not completed setup. Selection still requires its real
  // confirmation POST before an explicit Dashboard request is authorized.
  await page.goto(`/dashboard/${ids[1]}`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/${ids[1]}$`));
  const before = await (
    await request.get(`${fixture}/fixture/data/${ids[1]}`)
  ).json();
  await navigateDashboard(page, "en", 4);
  await page
    .getByRole("button", {
      name: "Disconnect (review scope and impact)",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Confirm disconnect" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    caret: "initial",
    path: "test-results/verification-settings-connection.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Disconnect (review scope and impact)",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirm disconnect", exact: true })
    .click();
  await expect(page).toHaveURL(/\/servers$/);
  const after = await (
    await request.get(`${fixture}/fixture/data/${ids[1]}`)
  ).json();
  expect(after.settings).toEqual(before.settings);
  expect(after.connection.state).toBe("INSTALLED_NOT_VERIFIED");
  expect(after.betaState).toBe("DELETING");
  const fresh = await (
    await request.post(`${fixture}/fixture/code`, { data: { guildId: ids[1] } })
  ).json();
  await page.goto("/link");
  await page.getByLabel("Verification code", { exact: true }).fill(fresh.code);
  await page
    .getByRole("button", { name: "Connect server", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
  // Re-verifying Discord ownership cannot cancel an operator lifecycle fence.
  await context.addCookies([
    { name: "nexus_guild", value: ids[1]!, url: base },
  ]);
  const stopped = await page.request.get("/operations/data?view=attention");
  expect(stopped.status()).toBe(403);
  expect(await stopped.text()).toContain("BETA_UNAVAILABLE");
});
test("permission loss blocks a verified dashboard on revalidation", async ({
  page,
  context,
  request,
}) => {
  const completed = await request.post(fixture + "/fixture/setup-complete", { data: { guildId: ids[0] } });
  expect(completed.status()).toBe(200);
  const stored = await request.get(fixture + "/fixture/data/" + ids[0]);
  expect(stored.status()).toBe(200);
  expect((await stored.json()).settings.setupVersion).toBe(3);
  await signIn(context);
  await page.goto(`/dashboard/${ids[0]}`);
  await confirmSelectedGuild(page, ids[0]!);
  await expect(page).toHaveURL(new RegExp(`/dashboard/${ids[0]}$`));
  await request.post(`${fixture}/fixture/permission`, {
    data: { guildId: ids[0], allowed: false },
  });
  try {
    await page.reload();
    await expect(page).toHaveURL(/\/servers$/);
  } finally {
    await request.post(`${fixture}/fixture/permission`, {
      data: { guildId: ids[0], allowed: true },
    });
  }
});
for (const locale of ["en", "ja"])
  test(`billing is private, authorized and truthful (${locale})`, async ({
    page,
    context,
    request,
  }) => {
    await request.post(`${fixture}/fixture/operations-plan`, {
      data: { guildId: ids[0], plan: "FREE" },
    });
    await signIn(context, user, locale);
    await context.addCookies([
      { name: "nexus_guild", value: ids[0]!, url: base },
    ]);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/billing/manage");
    const statusResponse = await page.request.get("/billing/status");
    expect(statusResponse.status()).toBe(200);
    const cacheDirectives = statusResponse.headers()["cache-control"]?.split(",").map(value => value.trim().toLowerCase()) ?? [];
    expect(cacheDirectives).toContain("no-store");
    expect(cacheDirectives.every(value => value === "no-store" || value === "max-age=0")).toBe(true);
    const model = await statusResponse.json();
    expect(model.canManage).toBe(false);
    expect(model.presentation.revision).toBe(1);
    expect(model.presentation.nativeCapability).toBe("DISABLED");
    expect(model.presentation.nativePurchaseUrl).toBeNull();
    expect(model.presentation.availableFeatures).toContain("voice_metrics");
    expect(model.presentation.featureDecisions.scheduled_reports.allowed).toBe(
      false,
    );
    expect(
      (await page.request.get("/billing/history?days=3651")).status(),
    ).toBe(400);
    await expect(
      page.getByText(
        locale === "ja"
          ? "外部決済は準備中です。プラン変更の内容を確認できます。"
          : "External checkout is unconfigured. You can review a plan change preview.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: /Discordで支払い|Manage billing in Discord/,
      }),
    ).toHaveCount(0);
    await page.locator('select[name="plan"]').selectOption("GROWTH");
    await page
      .getByRole("button", {
        name: locale === "ja" ? "変更内容を確認" : "Preview change",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText("GROWTH");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const missingProof = await page.request.post("/billing/actions", {
      headers: { origin: base, "sec-fetch-site": "same-origin" },
      data: { action: "redeem", code: "invalid" },
    });
    expect(missingProof.status()).toBe(403);
    expect(await missingProof.json()).toEqual({ error: "CSRF_REJECTED" });
    const headers = await sessionCsrfHeaders(context, ids[0]!);
    const denied = await page.request.post("/billing/actions", {
      headers,
      data: { action: "redeem", code: "invalid" },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error).toBe("BILLING_AUTHORIZATION_REQUIRED");
    await request.post(`${fixture}/fixture/billing-authority`, {
      data: { guildId: ids[0], enabled: true },
    });
    try {
      const checkout = await page.request.post("/billing/actions", {
        headers,
        data: {
          action: "checkout",
          offeringId: "11111111-1111-4111-8111-111111111111",
          idempotencyKey: "11111111-1111-4111-8111-111111111112",
        },
      });
      expect(checkout.status()).toBe(409);
      expect(await checkout.text()).toContain("BILLING_OFFERING_UNAVAILABLE");
      const portal = await page.request.post("/billing/actions", {
        headers,
        data: {
          action: "portal",
          idempotencyKey: "11111111-1111-4111-8111-111111111113",
        },
      });
      expect(portal.status()).toBe(503);
      expect(await portal.text()).toContain("BILLING_PROVIDER_NOT_CONFIGURED");
      const webhook = await page.request.post("/billing/webhooks/stripe", {
        data: { unverified: true },
      });
      expect(webhook.status()).toBe(503);
      const after = await page.request.get("/billing/status");
      expect((await after.json()).plan).toBe(model.plan);
      const cross = await page.request.post("/billing/actions", {
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        data: {
          action: "preview",
          targetPlan: "GROWTH",
          provider: "EXTERNAL_LEGACY",
        },
      });
      expect(cross.status()).toBe(403);
      const { code } = (await (
        await request.post(`${fixture}/fixture/promotion`, {
          data: { guildId: ids[0] },
        })
      ).json()) as { code: string };
      const urls: string[] = [];
      page.on("request", (req) => urls.push(req.url()));
      await page.goto("/billing/promotions");
      await page
        .getByLabel(
          locale === "ja" ? "プロモーションコード" : "Promotion code",
          { exact: true },
        )
        .fill(code);
      await page
        .getByRole("button", {
          name: locale === "ja" ? "特典を適用" : "Redeem benefit",
          exact: true,
        })
        .click();
      await expect(page.getByRole("status")).toContainText("GROWTH");
      expect(urls.every((url) => !url.includes(code))).toBe(true);
      await expect(page.locator('input[name="code"]')).toHaveValue("");
      await page.reload();
      await expect(page.locator(".badge")).toContainText("GROWTH");
      await page.screenshot({
        caret: "initial",
        path: `test-results/billing-${locale}-mobile.png`,
        fullPage: true,
      });
      // Financial authority is now independent of community roles. Revoke both
      // fixture Owner/Primary and community authority to test a stale request.
      await request.post(`${fixture}/fixture/billing-authority`, {
        data: { guildId: ids[0], enabled: false },
      });
      await request.post(`${fixture}/fixture/permission`, {
        data: { guildId: ids[0], allowed: false },
      });
      const stale = await page.request.post("/billing/actions", {
        headers,
        data: { action: "redeem", code: "invalid" },
      });
      expect(stale.status()).toBe(403);
      expect((await stale.json()).error).toBe("BILLING_AUTHORIZATION_REQUIRED");
      expect((await page.request.get("/billing/status")).status()).toBe(403);
    } finally {
      await request.post(`${fixture}/fixture/permission`, {
        data: { guildId: ids[0], allowed: true },
      });
      await request.post(`${fixture}/fixture/billing-authority`, {
        data: { guildId: ids[0], enabled: false },
      });
    }
  });

for (const locale of ["en", "ja"])
  test(`operations tiers, real exports and editable forms fit 360px (${locale})`, async ({
    page,
    context,
    request,
  }) => {
    const started = performance.now();
    const checkpoint = (phase: string, details: Record<string, string | number> = {}) =>
      console.info(JSON.stringify({ kind: "operations-test-timing", locale, phase, routeClass: new URL(page.url()).pathname === "/auth/select" ? "AUTH_SELECT" : new URL(page.url()).pathname === "/operations" ? "OPERATIONS" : "OTHER", elapsedMs: Math.round(performance.now() - started), ...details }));
    const guildId = locale === "ja" ? ids[2]! : ids[0]!;
    await signIn(context, user, locale);
    await context.addCookies([
      { name: "nexus_guild", value: guildId, url: base },
    ]);
    await page.setViewportSize({ width: 360, height: 800 });
    const headers = await sessionCsrfHeaders(context, guildId);
    const get = async (path: string) => {
      const url = new URL(path, base), view = url.searchParams.get("view") ?? "NONE";
      const route = ["/operations/data", "/explore/data"].includes(url.pathname) ? url.pathname : "OTHER";
      const label = ["attention", "intake", "calendar", "jobs", "reports", "organization", "credentials", "integrations", "NONE"].includes(view) ? view : "OTHER";
      const began = performance.now();
      try {
        const response = await page.request.get(path, { headers: { "X-Nexus-Guild": guildId } });
        checkpoint("READ", { route, view: label, status: response.status(), requestMs: Math.round(performance.now() - began) });
        return response;
      } catch (error) {
        checkpoint("READ_NO_RESPONSE", { route, view: label, requestMs: Math.round(performance.now() - began) });
        throw error;
      }
    };
    // Reuse the earlier verified connection in the full suite. A filtered run
    // establishes its own connection instead of consuming redundant redemption
    // attempts and tripping the real user-wide verification rate limit.
    if (!(await get("/operations/data?view=attention")).ok()) {
      const { code } = await (
        await request.post(`${fixture}/fixture/code`, { data: { guildId } })
      ).json();
      const redeemed = await page.request.post("/link/redeem", { headers, data: { code } });
      expect(redeemed.ok(), await safeResponseStatus(redeemed)).toBe(true);
    }
    async function tier(plan: string) {
      checkpoint("TIER_BEGIN", { plan: ["FREE", "STARTER", "GROWTH", "SCALE"].includes(plan) ? plan : "OTHER" });
      expect(
        (
          await request.post(`${fixture}/fixture/operations-plan`, {
            data: { guildId, plan },
          })
        ).ok(),
      ).toBe(true);
    }
    async function data(view: string) {
      const response = await get(`/operations/data?view=${view}`);
      expect(response.status()).toBe(200);
      return response.json();
    }
    await tier("FREE");
    const free = await data("attention");
    expect(free.access.features.basic_attention).toBe(true);
    expect(free.access.features.discord_charts).toBe(true);
    expect(free.access.features.api).toBe(false);
    const chart = await get("/explore/data");
    expect(chart.status()).toBe(200);
    expect((await chart.json()).spec.evidence.value).toBeNull();
    const png = await get("/explore/data?format=png");
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    expect((await png.body()).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect((await get("/explore/data?format=csv")).status()).toBe(403);
    const denied = await page.request.post("/operations/data", {
      headers,
      data: {
        action: "credential",
        input: {
          name: "Unavailable API",
          scopes: ["guild:read"],
          kind: "PERSONAL",
        },
      },
    });
    expect(denied.status()).toBe(403);
    await page.goto("/operations?view=intake");
    await page
      .getByLabel(locale === "ja" ? "タイトル" : "Panel title", { exact: true })
      .fill(`Free intake ${locale}`);
    await page
      .getByLabel(locale === "ja" ? "相談の分類" : "Request category", {
        exact: true,
      })
      .fill("workflow");
    await page
      .getByRole("button", {
        name: locale === "ja" ? "下書き保存" : "Save draft",
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: locale === "ja" ? "保存しました" : "Saved." }),
    ).toBeVisible();
    const retained = (await data("intake")).intake.panels.find(
      (p: { title: string }) => p.title === `Free intake ${locale}`,
    );
    expect(retained.fields).toHaveLength(2);
    await tier("STARTER");
    await page.goto("/explore");
    await expect(
      page.getByRole("heading", {
        name:
          locale === "ja"
            ? "保存ビューとレポートショートカット"
            : "Saved views and report shortcuts",
      }),
    ).toBeVisible();
    await page
      .getByLabel(locale === "ja" ? "名前" : "Name", { exact: true })
      .fill(`Support ${locale}`);
    await page
      .getByLabel(
        locale === "ja" ? "Discordショートカット" : "Discord shortcut",
        { exact: false },
      )
      .selectOption("support-health");
    await page
      .getByRole("button", {
        name: locale === "ja" ? "ビューを保存" : "Save view",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: `Support ${locale} · 7d`, exact: true }),
    ).toBeVisible();
    const csv = await get("/explore/data?format=csv");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("coverage");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/alpha8-${locale}-explore-360.png`,
      fullPage: true,
    });
    await page.goto("/operations?view=events");
    await page
      .getByLabel(locale === "ja" ? "タイトル" : "Title", { exact: true })
      .fill(`Weekly review ${locale}`);
    await page
      .getByLabel(locale === "ja" ? "現地時刻の開始日時" : "Local start", {
        exact: true,
      })
      .fill("2026-11-02T10:00");
    await page
      .getByLabel(locale === "ja" ? "繰り返し" : "Recurrence", { exact: false })
      .selectOption("WEEKLY");
    await page
      .getByRole("button", {
        name: locale === "ja" ? "イベントを保存" : "Save event",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `Weekly review ${locale}`,
        exact: true,
      }),
    ).toBeVisible();
    const event = (await data("events")).events.find(
      (e: { title: string }) => e.title === `Weekly review ${locale}`,
    );
    const ics = await get(`/operations/data?format=ics&id=${event.id}`);
    expect(ics.status()).toBe(200);
    expect(await ics.text()).toContain("RRULE:FREQ=WEEKLY");
    await page
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", {
          name: `Weekly review ${locale}`,
          exact: true,
        }),
      })
      .getByRole("button")
      .click();
    await expect(
      page.getByLabel(locale === "ja" ? "現地時刻の開始日時" : "Local start", {
        exact: true,
      }),
    ).toHaveValue("2026-11-02T10:00");
    await page
      .getByLabel(locale === "ja" ? "タイトル" : "Title", { exact: true })
      .fill(`Reviewed event ${locale}`);
    await page
      .getByRole("button", {
        name: locale === "ja" ? "イベントを保存" : "Save event",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `Reviewed event ${locale}`,
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await data("events")).events.find(
        (e: { id: string }) => e.id === event.id,
      ).revision,
    ).toBe(event.revision + 1);
    await tier("GROWTH");
    const growth = await data("integrations");
    expect(growth.access.features.api).toBe(true);
    expect(growth.access.features.webhooks).toBe(true);
    expect(growth.access.features.scheduled_reports).toBe(true);
    expect(growth.access.features.multi_guild).toBe(false);
    const credential = await page.request.post("/operations/data", {
      headers,
      data: {
        action: "credential",
        input: {
          name: `Read integration ${locale}`,
          scopes: ["guild:read", "metrics:read"],
          kind: "PERSONAL",
        },
      },
    });
    expect(credential.status()).toBe(200);
    const token = (await credential.json()).token;
    expect(token).toMatch(/^nxs_/);
    expect(JSON.stringify(await data("integrations"))).not.toContain(token);
    await tier("SCALE");
    const scale = await data("organization");
    expect(scale.access.features.multi_guild).toBe(true);
    expect(scale.access.features.automation_sandbox).toBe(true);
    expect(scale.access.features.rbac).toBe(true);
    for (const view of [
      "attention",
      "reports",
      "playbooks",
      "improvements",
      "intake",
      "events",
      "organization",
      "integrations",
    ]) {
      await page.goto(`/operations?view=${view}`);
      checkpoint("SCALE_UI_LOADED", { view: ["attention", "intake", "calendar", "jobs", "reports", "organization", "credentials", "integrations"].includes(view) ? view : "OTHER" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".page-head")).toContainText("SCALE");
      expect(
        (await page.getByRole("heading", { level: 1 }).boundingBox())!.height,
      ).toBeLessThan(120);
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/alpha8-${locale}-${view}-360.png`,
        fullPage: true,
      });
    }
    const cross = await page.request.post("/operations/data", {
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      data: { action: "event", input: {} },
    });
    expect(cross.status()).toBe(403);
    const extra = await page.request.post("/explore/data", {
      headers,
      data: {
        action: "saveView",
        view: { name: "Injected", metric: "reply", memberId: user },
      },
    });
    expect(extra.status()).toBe(400);
    const oversized = await page.request.post("/operations/data", {
      headers,
      data: "x".repeat(180001),
    });
    expect(oversized.status()).toBe(413);
    await tier("FREE");
    const paused = await data("events");
    expect(
      paused.events.find((e: { id: string }) => e.id === event.id).state,
    ).toBe("PAUSED_PLAN_LIMIT");
    expect(
      (await get(`/operations/data?format=ics&id=${event.id}`)).status(),
    ).toBe(403);
    await tier("STARTER");
  });

test("explicit Viewer reads operations but cannot configure despite a Discord manager role", async ({
  page,
  context,
  request,
  browser,
}) => {
  await request.post(`${fixture}/fixture/operations-plan`, {
    data: { guildId: ids[0], plan: "SCALE" },
  });
  await signIn(context);
  await context.addCookies([
    { name: "nexus_guild", value: ids[0]!, url: base },
  ]);
  const headers = await sessionCsrfHeaders(context, ids[0]!);
  const organization = await page.request.post("/operations/data", {
    headers,
    data: { action: "organization", input: { name: "Operations QA" } },
  });
  expect(organization.status(), await safeResponseStatus(organization)).toBe(200);
  expect(
    (
      await page.request.post("/operations/data", {
        headers,
        data: {
          action: "member",
          input: { userId: other, name: "Review observer", role: "VIEWER" },
        },
      })
    ).status(),
  ).toBe(200);
  const reader = await browser.newContext({ baseURL: base });
  try {
    await signIn(reader, other);
    await reader.addCookies([
      { name: "nexus_guild", value: ids[0]!, url: base },
    ]);
    const { code } = await (
      await request.post(`${fixture}/fixture/code`, {
        data: { guildId: ids[0], userId: other },
      })
    ).json();
    const readerHeaders = await sessionCsrfHeaders(reader, ids[0]!);
    const redeemed = await reader.request.post("/link/redeem", { headers: readerHeaders, data: { code } });
    expect(redeemed.ok(), await safeResponseStatus(redeemed)).toBe(true);
    const model = await reader.request.get("/operations/data?view=reports", {
      headers: { "X-Nexus-Guild": ids[0]! },
    });
    expect(model.status()).toBe(200);
    expect((await model.json()).access.permissions).toEqual(["READ"]);
    const write = await reader.request.post("/operations/data", {
      headers: readerHeaders,
      data: {
        action: "intake",
        input: { title: "Should be denied", category: "workflow" },
      },
    });
    expect(write.status()).toBe(403);
    const readonly = await reader.newPage();
    await readonly.goto("/operations?view=intake");
    await expect(readonly.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      readonly.getByRole("button", { name: "Save draft", exact: true }),
    ).toHaveCount(0);
    expect(
      (await reader.request.get("/dashboard", { maxRedirects: 0 })).status(),
    ).toBe(307);
  } finally {
    await reader.close();
  }
});
