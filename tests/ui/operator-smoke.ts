import { chromium, expect } from "@playwright/test";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { isolatedPostgres } from "../fixtures/postgres";
import { connect, migrate } from "../../packages/db/src/index";
import {
  OperatorAuth,
  passwordCredentials,
} from "../../packages/security/src/operator-auth";
import { BetaOperator } from "../../packages/security/src/beta-operator";
import { createOperatorServer } from "../../apps/operator/src/server";
process.env.NEXUS_HOSTED_BETA = "on";
const infra = await isolatedPostgres(),
  db = connect(infra.databaseUrl);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
  app: ReturnType<typeof createOperatorServer> | undefined;
try {
  await migrate(db);
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_PORT_UNAVAILABLE");
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const origin = "http://127.0.0.1:" + address.port,
    credentials = await passwordCredentials(
      "synthetic-browser-password-for-test-only",
    );
  app = createOperatorServer(
    db,
    new OperatorAuth(db, async () => credentials),
    new BetaOperator(db, async (_id) => ({
      name: "テスト用コミュニティ",
      present: true,
      canObserve: true,
      checkedAt: Date.now(),
    })),
    origin,
  );
  await app.listen({ host: "127.0.0.1", port: address.port });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .locator("#login-form input")
    .fill("synthetic-browser-password-for-test-only");
  await page.locator("#login-form button").click();
  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("[data-tab=register]").click();
  await page.locator("#register-form input").fill("899999999999999999");
  await page
    .locator("#register-form textarea")
    .fill("合成データでのローカル試験");
  await page.locator("#register-form button").click();
  await page.locator("#guild-list button").click();
  const apply = async (label: string) => {
    await page
      .locator("#guild-detail")
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(page.locator("#confirm-next")).not.toBeEmpty();
    await page
      .locator("#confirm-form textarea")
      .fill("合成データで状態と影響を確認");
    await page.locator("#confirm-form button[type=submit]").click();
    await expect(page.locator("#confirmation")).not.toBeVisible();
  };
  await apply("有効化（30日）");
  await expect(page.locator("#guild-detail>strong")).toHaveText("有効");
  await expect(page.locator("#overview")).toContainText("1 / 10");
  await apply("一時停止");
  await expect(page.locator("#guild-detail>strong")).toHaveText("一時停止");
  await apply("再開");
  await expect(page.locator("#guild-detail>strong")).toHaveText("有効");
  await page.locator("#guild-detail input[name=monthly]").fill("10");
  await apply("上限を保存");
  await expect(page.locator("#guild-detail input[name=monthly]")).toHaveValue(
    "10",
  );
  await page
    .locator("#guild-detail input[type=datetime-local]")
    .fill(new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 16));
  await apply("期限を変更");
  await mkdir(".local", { recursive: true });
  await page.screenshot({
    path: ".local/alpha12-operator-ja.png",
    fullPage: true,
  });
  const cookies = await context.cookies();
  expect(
    cookies.find((cookie) => cookie.name === "nexus_operator"),
  ).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/operator",
    secure: false,
  });
  await page.locator("[data-tab=audit]").click();
  await expect(page.locator("#audit")).toContainText("有効化（30日）");
  expect(await page.locator("#audit").innerText()).not.toContain("SUCCEEDED");
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("#audit h1")).toHaveText("Operation history");
  await page.locator("[data-tab=guilds]").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#guild-detail>strong")).toHaveText("Active");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/alpha12-operator-en-mobile.png",
    fullPage: true,
  });
  await page.locator("[data-tab=sessions]").click();
  await expect(page.locator("#sessions")).toContainText("Operator sessions");
  await page.locator("#logout").click();
  await expect(page.locator("#login")).toBeVisible();
  expect(errors).toEqual([]);
  process.stdout.write(
    "PASS operator smoke: loopback HTTP login/cookie, candidate/activate/pause/resume/limits/extend, confirmation values, JA/EN audit, sessions/logout, mobile layout; 2 screenshots.\n",
  );
} finally {
  await browser?.close();
  await app?.close();
  await db.destroy();
  await infra.stop();
}
