import { chromium, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { isolatedPostgres } from "../fixtures/postgres";
import { connect, migrate, sql } from "../../packages/db/src/index";
import { liveApprovalVariables } from "../../packages/settings/src/billing/commerce";

// A built Next process and an isolated synthetic DB. The fixture flags exercise
// production rendering only: no actual credentials, Stripe objects or approvals.
// All browser requests outside this loopback origin are blocked.
const output = ".local/stripe-pricing-ui";
await mkdir(output, { recursive: true });
const infra = await isolatedPostgres(),
  db = connect(infra.databaseUrl);
const probe = createServer();
await new Promise<void>((ready) => probe.listen(0, "127.0.0.1", ready));
const address = probe.address();
if (!address || typeof address === "string")
  throw new Error("TEST_PORT_UNAVAILABLE");
const port = address.port,
  origin = `http://127.0.0.1:${port}`;
await new Promise<void>((done) => probe.close(() => done()));
let web: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let webOutput = "";
const checks: string[] = [],
  errors: string[] = [],
  blockedExternalRequests: string[] = [];
async function stopWeb() {
  if (!web || web.exitCode !== null) return;
  const done = new Promise<void>((ready) => web!.once("exit", () => ready()));
  web.kill("SIGTERM");
  await done;
}
async function startWeb(prices: boolean, databaseUrl = infra.databaseUrl) {
  await stopWeb();
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
        DATABASE_URL: databaseUrl,
        NEXUS_HOSTED_BETA: "on",
        NEXUS_WEB_AUTH_MODE: "oauth",
        NEXUS_WEB_URL: origin,
        NEXUS_STRIPE_ENABLED: "true",
        NEXUS_STRIPE_MODE: "LIVE",
        NEXUS_STRIPE_LIVE_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_live_invalid_fixture_not_a_credential",
        STRIPE_WEBHOOK_SECRET: "whsec_invalid_fixture_not_a_credential",
        NEXUS_STRIPE_PUBLIC_SALES_ENABLED: prices ? "true" : "false",
        NEXUS_BILLING_DEVELOPER_COUNTRY: "JP",
        ...Object.fromEntries(
          liveApprovalVariables.map((name) => [name, "true"]),
        ),
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
  await expect
    .poll(
      async () => {
        if (web!.exitCode !== null) throw new Error("TEST_WEB_EXITED");
        try {
          return (await fetch(origin + "/pricing")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
}
try {
  await migrate(db);
  await sql`UPDATE billing_offerings SET enabled=false`.execute(db);
  const starter = randomUUID(),
    growth = randomUUID();
  for (const [id, plan, amount, tax] of [
    [starter, "STARTER", 1587, "EXCLUSIVE"],
    [growth, "GROWTH", 4923, "INCLUSIVE"],
  ] as const)
    await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,currency,final_price_minor,tax_behavior,enabled)
      VALUES(${id}::uuid,${plan},2,'STRIPE',${"prod_synthetic_" + id},${"price_synthetic_" + id},'USD',${amount},${tax},true)`.execute(
      db,
    );
  await startWeb(true);
  browser = await chromium.launch({ headless: true });
  for (const locale of ["ja", "en"] as const) {
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        locale,
      });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin || url.protocol === "data:")
          return route.continue();
        blockedExternalRequests.push(url.origin + url.pathname);
        return route.abort();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/pricing");
      await expect(
        page.getByRole("heading", { name: /Closed Beta 1/ }),
      ).toBeVisible();
      await expect(page.locator(".price-card")).toHaveCount(5);
      await expect(
        page.locator(".price-card").nth(1).locator(".price"),
      ).toContainText(/USD\s15\.87/);
      await expect(
        page.locator(".price-card").nth(2).locator(".price"),
      ).toContainText(/USD\s49\.23/);
      await expect(page.locator(".price-card").nth(1)).toContainText(
        locale === "ja" ? "税別" : "Tax exclusive",
      );
      await expect(page.locator(".price-card").nth(2)).toContainText(
        locale === "ja" ? "税込" : "Tax inclusive",
      );
      await expect(
        page.locator(".price-card a[href^='/checkout?']"),
      ).toHaveCount(2);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      const choose = page.locator(`a[href="/checkout?offering=${starter}"]`);
      await choose.focus();
      await expect(choose).toBeFocused();
      await page.screenshot({
        path: `${output}/pricing-${locale}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", {
          name: locale === "ja" ? "Discordでログイン" : "Sign in with Discord",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.locator('a[href^="/auth/login?offering="]'),
      ).toHaveAttribute("href", `/auth/login?offering=${starter}`);
      checks.push(
        `price/tax/keyboard/Owner-entry/no-overflow ${locale} ${width}`,
      );
      await context.close();
    }
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    locale: "en",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "data:")
      return route.continue();
    blockedExternalRequests.push(url.origin + url.pathname);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const duplicate = randomUUID();
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,currency,final_price_minor,tax_behavior,enabled)
    VALUES(${duplicate}::uuid,'STARTER',2,'STRIPE',${"prod_synthetic_" + duplicate},${"price_synthetic_" + duplicate},'USD',1699,'EXCLUSIVE',true)`.execute(
    db,
  );
  await page.goto(origin + "/pricing");
  await expect(page.locator(".price-card").nth(1).locator(".price")).toHaveText(
    "Price not published",
  );
  await expect(page.locator(".price-card a[href^='/checkout?']")).toHaveCount(
    1,
  );
  checks.push("ambiguous plan hides amount and purchase link");
  await sql`UPDATE billing_offerings SET enabled=false`.execute(db);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("No paid plans");
  await expect(page.locator(".price-card a[href^='/checkout?']")).toHaveCount(
    0,
  );
  checks.push("disabled mappings have no stale prices or purchase links");
  const missing = new URL(infra.databaseUrl);
  missing.pathname = "/synthetic_database_does_not_exist";
  await startWeb(true, missing.toString());
  await page.goto(origin + "/pricing");
  await expect(page.getByRole("status")).toContainText(
    "temporarily unavailable",
  );
  await expect(page.getByRole("link", { name: "Reload prices" })).toBeVisible();
  await expect(page.locator('a[href="/billing/manage"]')).toBeVisible();
  await expect(page.locator(".price-card a[href^='/checkout?']")).toHaveCount(
    0,
  );
  checks.push("DB failure preserves readable comparison and recovery link");
  await startWeb(false);
  await page.goto(origin + "/pricing");
  await expect(
    page.getByText("Paid checkout is being prepared. Prices await approval.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".price-card").first().locator(".price"),
  ).toHaveText("Free");
  await expect(page.locator(".price-card a[href^='/checkout?']")).toHaveCount(
    0,
  );
  await expect(
    page.locator('script[src*="stripe.com"],stripe-pricing-table'),
  ).toHaveCount(0);
  checks.push(
    "Closed Beta 1 remains free with paid sales and embedded Stripe scripts closed",
  );
  await context.close();
  expect(errors).toEqual([]);
  expect(blockedExternalRequests).toEqual([]);
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        blockedExternalRequests,
        notes: [
          "Synthetic isolated database and fake keys only. No Stripe API call, payment, public deployment or real user data.",
          "The production-rendering flags in this harness are fixtures, not launch approvals.",
          "Real Stripe Sandbox payment, iOS/Android devices and screen reader were not exercised.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`PASS Stripe pricing UI: ${checks.length} grouped checks`);
} catch (error) {
  for (const context of browser?.contexts() ?? [])
    for (const page of context.pages())
      await page
        .screenshot({ path: `${output}/failure.png`, fullPage: true })
        .catch(() => {});
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: false,
        checks,
        errors,
        blockedExternalRequests,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await stopWeb();
  await db.destroy();
  await infra.stop();
  await writeFile(`${output}/web-server.log`, webOutput);
}
