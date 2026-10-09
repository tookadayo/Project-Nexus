import { test, expect, type BrowserContext } from "@playwright/test";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { navigateDashboard } from "./dashboard-navigation";
const base = `http://127.0.0.1:${process.env.NEXUS_VERIFICATION_WEB_PORT ?? 3150}`,
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
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      createHash("sha256").update("s".repeat(64)).digest(),
      iv,
    ),
    bytes = Buffer.concat([
      cipher.update(
        JSON.stringify({
          userId,
          accessToken: `verification-oauth-${userId}`,
          expiresAt: Date.now() + 600000,
        }),
      ),
      cipher.final(),
    ]);
  await context.addCookies([
    {
      name: "nexus_session",
      value: Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
        "base64url",
      ),
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
    { name: "nexus_locale", value: locale, url: base },
  ]);
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
  const sessionResponse = await request.post("/link/redeem", {
    headers: { origin: base, "sec-fetch-site": "same-origin" },
    data: { code: "invalid" },
  });
  expect(sessionResponse.status()).toBe(401);
});
test("unverified and arbitrary URLs cannot expose dashboard data", async ({
  page,
  context,
}) => {
  await signIn(context);
  for (const guildId of [ids[1], ids[2], "999111111111111112"]) {
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
test("issuer-only redemption, confirmed disconnect and relinking preserve settings", async ({
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
  await expect(page).toHaveURL(new RegExp(`/dashboard/${ids[1]}$`));
  const before = await (
    await request.get(`${fixture}/fixture/data/${ids[1]}`)
  ).json();
  await navigateDashboard(page, "en", 4);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
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
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm disconnect", exact: true })
    .click();
  await expect(page).toHaveURL(/\/servers$/);
  const after = await (
    await request.get(`${fixture}/fixture/data/${ids[1]}`)
  ).json();
  expect(after.settings).toEqual(before.settings);
  expect(after.connection.state).toBe("INSTALLED_NOT_VERIFIED");
  const fresh = await (
    await request.post(`${fixture}/fixture/code`, { data: { guildId: ids[1] } })
  ).json();
  await page.goto("/link");
  await page.getByLabel("Verification code", { exact: true }).fill(fresh.code);
  await page
    .getByRole("button", { name: "Connect server", exact: true })
    .click();
  await page.getByRole("link", { name: "Open Dashboard", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${ids[1]}$`));
});
test("permission loss blocks a verified dashboard on revalidation", async ({
  page,
  context,
  request,
}) => {
  await signIn(context);
  await page.goto(`/dashboard/${ids[0]}`);
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
    expect(statusResponse.headers()["cache-control"]).toBe("no-store");
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
    const headers = { origin: base, "sec-fetch-site": "same-origin" };
    const denied = await page.request.post("/billing/actions", {
      headers,
      data: { action: "redeem", code: "invalid" },
    });
    expect(denied.status()).toBe(403);
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
      expect(await checkout.text()).toContain(
        "BILLING_OFFERING_UNAVAILABLE",
      );
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
    const guildId = locale === "ja" ? ids[1]! : ids[0]!;
    await signIn(context, user, locale);
    await context.addCookies([
      { name: "nexus_guild", value: guildId, url: base },
    ]);
    await page.setViewportSize({ width: 360, height: 800 });
    const headers = { origin: base, "sec-fetch-site": "same-origin" };
    // Reuse the earlier verified connection in the full suite. A filtered run
    // establishes its own connection instead of consuming redundant redemption
    // attempts and tripping the real user-wide verification rate limit.
    if (!(await page.request.get("/operations/data?view=attention")).ok()) {
      const { code } = await (
        await request.post(`${fixture}/fixture/code`, { data: { guildId } })
      ).json();
      expect(
        (
          await page.request.post("/link/redeem", { headers, data: { code } })
        ).ok(),
      ).toBe(true);
    }
    async function tier(plan: string) {
      expect(
        (
          await request.post(`${fixture}/fixture/operations-plan`, {
            data: { guildId, plan },
          })
        ).ok(),
      ).toBe(true);
    }
    async function data(view: string) {
      const response = await page.request.get(`/operations/data?view=${view}`);
      expect(response.status()).toBe(200);
      return response.json();
    }
    await tier("FREE");
    const free = await data("attention");
    expect(free.access.features.basic_attention).toBe(true);
    expect(free.access.features.discord_charts).toBe(true);
    expect(free.access.features.api).toBe(false);
    const chart = await page.request.get("/explore/data");
    expect(chart.status()).toBe(200);
    expect((await chart.json()).spec.evidence.value).toBeNull();
    const png = await page.request.get("/explore/data?format=png");
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    expect((await png.body()).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect((await page.request.get("/explore/data?format=csv")).status()).toBe(
      403,
    );
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
    const csv = await page.request.get("/explore/data?format=csv");
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
    const ics = await page.request.get(
      `/operations/data?format=ics&id=${event.id}`,
    );
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
      (
        await page.request.get(`/operations/data?format=ics&id=${event.id}`)
      ).status(),
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
  const headers = { origin: base, "sec-fetch-site": "same-origin" };
  expect(
    (
      await page.request.post("/operations/data", {
        headers,
        data: { action: "organization", input: { name: "Operations QA" } },
      })
    ).status(),
  ).toBe(200);
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
    expect(
      (
        await reader.request.post("/link/redeem", { headers, data: { code } })
      ).ok(),
    ).toBe(true);
    const model = await reader.request.get("/operations/data?view=reports");
    expect(model.status()).toBe(200);
    expect((await model.json()).access.permissions).toEqual(["READ"]);
    const write = await reader.request.post("/operations/data", {
      headers,
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
