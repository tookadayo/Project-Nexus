import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
const web = Number(process.env.NEXUS_CHECKOUT_WEB_PORT ?? 3160),
  api = Number(process.env.NEXUS_CHECKOUT_API_PORT ?? 3161),
  base = `http://127.0.0.1:${web}`,
  fixture = `http://127.0.0.1:${api}`,
  offering = "11111111-1111-4111-8111-111111111119",
  guild = "931111111111112111",
  user = "911111111111111111",
  other = "911111111111111112";
test("Owner purchase, live negative authorization, Elements responsive UI and signed webhook reconciliation", async ({
  page,
  context,
  request,
  browser,
}) => {
  await context.addCookies([{ name: "nexus_locale", value: "en", url: base }]);
  await page.goto("/pricing");
  await expect(
    page.getByRole("link", { name: "Choose Growth", exact: true }),
  ).toBeVisible();
  await page.goto(`/checkout?offering=${offering}`);
  await expect(
    page.getByRole("heading", { name: "Sign in with Discord" }),
  ).toBeVisible();
  const login = await context.request.get(`/auth/login?offering=${offering}`, {
      maxRedirects: 0,
    }),
    oauth = new URL(login.headers().location!);
  expect(oauth.searchParams.get("scope")).toBe("identify guilds");
  await page.goto(
    `/auth/callback?code=fixture-code&state=${oauth.searchParams.get("state")}`,
  );
  await expect(page).toHaveURL(new RegExp("/checkout\\?offering=" + offering));
  await expect(
    page.getByRole("heading", { name: "Choose a server you own" }),
  ).toBeVisible();
  const managed = page.locator(".checkout-managed");
  await expect(managed.getByRole("link")).toHaveCount(0);
  const install = new URL(
    (await page
      .getByRole("link", { name: "Add NEXUS to this server" })
      .getAttribute("href")) as string,
  );
  expect(install.searchParams.get("guild_id")).toBe("931111111111112112");
  expect(install.searchParams.get("disable_guild_select")).toBe("true");
  for (const g of ["931111111111112113", "931111111111112114"]) {
    const response = await context.request.post("/checkout/actions", {
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
      data: {
        action: "start",
        guildId: g,
        offeringId: offering,
        idempotencyKey: randomUUID(),
      },
    });
    expect(response.status()).toBe(403);
  }
  expect(
    (
      await context.request.post("/checkout/connect", {
        headers: { Origin: "https://evil.example" },
        data: { guildId: guild, confirm: true },
      })
    ).status(),
  ).toBe(403);
  await page.goto(`/checkout/review?offering=${offering}&guild=${guild}`);
  await expect(
    page.getByRole("button", { name: "Connect this server to NEXUS" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect this server to NEXUS" })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue to payment" }),
  ).toBeVisible();
  await request.post(`${fixture}/fixture/owner`, {
    data: { guildId: guild, ownerId: other },
  });
  const stale = await context.request.post("/checkout/actions", {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    data: {
      action: "start",
      guildId: guild,
      offeringId: offering,
      idempotencyKey: randomUUID(),
    },
  });
  expect(stale.status()).toBe(403);
  await request.post(`${fixture}/fixture/owner`, {
    data: { guildId: guild, ownerId: user },
  });
  const tampered = await context.request.post("/checkout/actions", {
    headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    data: {
      action: "start",
      guildId: guild,
      offeringId: offering,
      idempotencyKey: randomUUID(),
      amount: 1,
      priceId: "price_evil",
    },
  });
  expect(tampered.status()).toBe(400);
  // This fixture replaces only Stripe.js in the browser. It verifies NEXUS's
  // official React SDK wiring/layout, not a real Stripe Sandbox card payment.
  await page.addInitScript(
    ({ fixtureUrl }) => {
      function element(kind: string) {
        let frame: HTMLIFrameElement | undefined;
        return {
          on: () => {},
          off: () => {},
          update: () => {},
          destroy: () => frame?.remove(),
          mount: (node: HTMLElement) => {
            frame = document.createElement("iframe");
            frame.title =
              kind === "payment"
                ? "Stripe test payment fixture"
                : "Stripe contact fixture";
            frame.style.cssText = "border:0;width:100%;height:160px";
            frame.srcdoc =
              kind === "payment"
                ? '<label>Card number <input aria-label="Card number" autocomplete="off"></label><p>Stripe test fixture</p>'
                : '<label>Email <input aria-label="Email" type="email"></label>';
            node.append(frame);
          },
        };
      }
      (window as unknown as { Stripe: unknown }).Stripe = () => ({
        elements: () => {},
        createToken: () => {},
        createPaymentMethod: () => {},
        confirmCardPayment: () => {},
        _registerWrapper: () => {},
        registerAppInfo: () => {},
        initCheckoutElementsSdk: (options: { clientSecret: string }) => ({
          on: () => {},
          changeAppearance: () => {},
          loadFonts: () => {},
          createPaymentElement: () => element("payment"),
          createContactDetailsElement: () => element("contact"),
          loadActions: async () => ({
            type: "success",
            actions: {
              getSession: () => ({
                canConfirm: true,
                total: {
                  subtotal: { amount: "$49.00" },
                  discount: { amount: "$0.00" },
                  taxExclusive: { amount: "$0.00" },
                  total: { amount: "$49.00" },
                },
              }),
              confirm: async () => {
                await fetch(fixtureUrl + "/fixture/payment", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ clientSecret: options.clientSecret }),
                });
                return { type: "success" };
              },
            },
          }),
        }),
      });
    },
    { fixtureUrl: fixture },
  );
  const started = page.waitForResponse((r) =>
    r.url().endsWith("/checkout/actions"),
  );
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const startResponse = await started;
  if (!startResponse.ok())
    throw new Error("CHECKOUT_START " + (await startResponse.json()).error);
  await expect(page).toHaveURL(/\/checkout\/payment\?receipt=/);
  await expect(
    page.getByRole("button", { name: "Start GROWTH" }),
  ).toBeVisible();
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByText("Owner community with a long descriptive server name", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".checkout-total")).toContainText("$49.00");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .frameLocator('iframe[title="Stripe test payment fixture"]')
      .getByLabel("Card number")
      .fill("4242424242424242");
    await page
      .getByRole("button", { name: "Start GROWTH" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/checkout-${width}.png`,
      fullPage: true,
    });
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Start GROWTH" }),
  ).toBeVisible();
  expect(
    (await (await request.get(`${fixture}/fixture/count`)).json())
      .checkoutCalls,
  ).toBe(1);
  await page.getByRole("button", { name: "Start GROWTH" }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation/);
  await expect(page.getByText("CONFIRMING", { exact: true })).toBeVisible();
  const receipt = new URL(page.url()).searchParams.get("receipt")!,
    status = await context.request.get(
      "/checkout/status?receipt=" + encodeURIComponent(receipt),
    );
  expect((await status.json()).state).toBe("CONFIRMING");
  expect(
    (
      await context.request.post("/billing/webhooks/stripe", {
        headers: { "Stripe-Signature": "invalid" },
        data: { invalid: true },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await (await request.post(`${fixture}/fixture/webhook`)).json()).status,
  ).toBe(200);
  expect(
    (
      await (
        await context.request.get(
          "/checkout/status?receipt=" + encodeURIComponent(receipt),
        )
      ).json()
    ).state,
  ).toBe("CONFIRMING");
  await request.post(`${fixture}/fixture/webhook`);
  await request.post(`${fixture}/fixture/reconcile`);
  await expect
    .poll(
      async () =>
        (
          await (
            await context.request.get(
              "/checkout/status?receipt=" + encodeURIComponent(receipt),
            )
          ).json()
        ).state,
    )
    .toBe("ACTIVE");
  await page.reload();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await request.post(`${fixture}/fixture/owner`, {
    data: { guildId: guild, ownerId: other },
  });
  expect(
    (
      await context.request.post("/billing/actions", {
        headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
        data: { action: "portal", idempotencyKey: randomUUID() },
      })
    ).status(),
  ).toBe(200); // Principal A retains financial authority after transfer.
  const nextOwner = await browser.newContext();
  try {
    await nextOwner.addCookies([
      { name: "nexus_locale", value: "en", url: base },
      { name: "nexus_guild", value: guild, url: base },
    ]);
    const loginB = await nextOwner.request.get("/auth/login", {
        maxRedirects: 0,
      }),
      stateB = new URL(loginB.headers().location!).searchParams.get("state");
    expect(
      (
        await nextOwner.request.get(
          `/auth/callback?code=other-user&state=${stateB}`,
          { maxRedirects: 0 },
        )
      ).status(),
    ).toBe(307);
    const portalB = await nextOwner.request.post("/billing/actions", {
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
      data: { action: "portal", idempotencyKey: randomUUID() },
    });
    expect(portalB.status()).toBe(403);
    expect((await portalB.json()).error).toBe("BILLING_PRINCIPAL_REQUIRED");
    const receiptB = await nextOwner.request.get(
      "/checkout/status?receipt=" + encodeURIComponent(receipt),
    );
    expect(receiptB.status()).toBe(403);
    const management = await nextOwner.newPage();
    await management.goto(base + "/billing/manage");
    await expect(
      management.getByText(/current Discord Owner differs/),
    ).toBeVisible();
    expect(
      (
        await (
          await context.request.get(
            "/checkout/status?receipt=" + encodeURIComponent(receipt),
          )
        ).json()
      ).state,
    ).toBe("ACTIVE");
  } finally {
    await nextOwner.close();
  }
});
