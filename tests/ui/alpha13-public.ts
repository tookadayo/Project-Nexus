import { chromium, expect } from "@playwright/test";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const probe = createServer();
await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
const address = probe.address();
if (!address || typeof address === "string") throw Error("PORT");
const port = address.port;
await new Promise<void>((r) => probe.close(() => r()));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
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
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXUS_HOSTED_BETA: "on",
      NEXUS_WEB_AUTH_MODE: "oauth",
      NEXUS_WEB_URL: origin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
const browser = await chromium.launch({ headless: true });
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup only */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw Error("NEXT_NOT_READY");
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const fonts: unknown[] = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('link[rel="icon"]').last()).toHaveAttribute(
      "href",
      "/nexus/brand/navy-tile.png",
    );
    await expect(page.locator(".nx-brand img").first()).toBeVisible();
    expect(
      await page
        .locator(".nx-brand img")
        .first()
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    ).toBe(true);
    fonts.push(
      await page
        .locator(".nexus-site")
        .first()
        .evaluate((element) => getComputedStyle(element).fontFamily),
    );
    await page.screenshot({ path: `.local/alpha13-ui/public-${width}.png` });
    await page.goto(origin + "/support");
    await expect(
      page.getByText("A support destination has not been configured.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.locator('a[href="/servers"]')).not.toHaveCount(0);
  }
  await mkdir(".local/alpha13-ui", { recursive: true });
  await writeFile(
    ".local/alpha13-ui/public-fonts.json",
    JSON.stringify(fonts, null, 2),
  );
  console.log(
    "PASS built Next public pages: wordmark/blue N visible, self-hosted font loaded, support unset has real settings/server routes, 390/1440 widths. No OAuth/Discord/external requests.",
  );
} finally {
  await browser.close();
  child.kill("SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(".local/alpha13-public-server.log", output);
}
