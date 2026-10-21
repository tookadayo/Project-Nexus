import { test, expect } from "./alpha17-verification-fixture";
import { observeSetupStatus } from "./alpha17-setup-status-diagnostic";

const base = process.env.NEXUS_VERIFICATION_WEB_ORIGIN ?? "http://127.0.0.1:" + (process.env.NEXUS_VERIFICATION_WEB_PORT ?? "3150");
const fixture = "http://127.0.0.1:" + (process.env.NEXUS_VERIFICATION_API_PORT ?? "3151");
const guild = "931111111111111111";
const otherGuild = "931111111111111112";
type Stored = { settings: { revision: number; timezone: string; setupVersion: number; helperEnabled: boolean; analysisScope: unknown; managerRoleIds: string[] } };

/** Real Next/BFF/createApi + the existing private DB/FakeDiscord fixture.
 * Authentication starts at fixture/session; this is not real OAuth evidence. */
test("alpha17 core setup applies once through BFF and survives dashboard reload within its guild", async ({ page, context, request }) => {
  const diagnostic = observeSetupStatus(page, base);
  try {

  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const session = await request.post(fixture + "/fixture/session", { data: { userId: "911111111111111111" } });
  expect(session.status()).toBe(200);
  const { reference } = await session.json() as { reference: string };
  expect(/^[A-Za-z0-9_-]{43}$/.test(reference)).toBe(true);
  await context.addCookies([
    { name: "nexus_session", value: reference, url: base, httpOnly: true, sameSite: "Lax" },
    { name: "nexus_locale", value: "en", url: base },
  ]);
  const stored = async (id: string): Promise<Stored> => {
    const response = await request.get(fixture + "/fixture/data/" + id);
    expect(response.status()).toBe(200);
    return response.json() as Promise<Stored>;
  };
  const before = await stored(guild);
  const otherBefore = await stored(otherGuild);
  const zone = before.settings.timezone === "Asia/Tokyo" ? "Europe/London" : "Asia/Tokyo";
  await page.goto("/setup?guild=" + guild + "&edit=1");
  await expect(page.getByRole("heading", { name: "Get ready to use NEXUS", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Time zone", exact: true })).toBeVisible();
  const statusPath = "/data/setup/status?guild=" + guild;
  const readStatus = async () => {
    const response = await page.request.get(statusPath, { headers: { "X-Nexus-Guild": guild } });
    expect(response.status()).toBe(200);
    return response.json() as Promise<{ state: string; settingsRevision: number; settings: { timezone: string } }>;
  };
  expect((await readStatus()).settingsRevision).toBe(before.settings.revision);
  await page.getByRole("combobox", { name: "Time zone", exact: true }).fill(zone);
  await page.getByRole("checkbox", { name: "I confirm this region for shared schedules.", exact: true }).check();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("Draft saved");
  expect((await stored(guild)).settings).toEqual(before.settings);
  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error("TEST_VIEWPORT_UNAVAILABLE");
  for (const width of [1280, 761, 760, 360]) {
    await page.setViewportSize({ width, height: originalViewport.height });
    await page.getByRole("button", { name: "4. Review & apply", exact: true }).click({ trial: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize(originalViewport);
  await page.getByRole("button", { name: "4. Review & apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply reviewed settings", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "I reviewed this saved draft and want to apply it to the current settings.", exact: true }).check();
  const appliedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/data/setup/apply" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Apply reviewed settings", exact: true }).dblclick();
  expect((await appliedResponse).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp("/auth/select\\?guild=" + guild + "$"));
  const after = await stored(guild);
  expect(after.settings.revision).toBe(before.settings.revision + 1);
  expect(after.settings.timezone).toBe(zone);
  expect(after.settings.setupVersion).toBe(3);
  for (const key of ["helperEnabled", "analysisScope", "managerRoleIds"] as const)
    expect(after.settings[key]).toEqual(before.settings[key]);
  const status = await readStatus();
  expect(status).toMatchObject({ state: "COMPLETE", settingsRevision: after.settings.revision, settings: { timezone: zone } });
  expect((await stored(otherGuild)).settings).toEqual(otherBefore.settings);
  const mismatched = await page.request.get(statusPath, { headers: { "X-Nexus-Guild": otherGuild } });
  expect(mismatched.status()).toBe(409);
  await page.getByRole("button", { name: /Open$/ }).click();
  await expect(page).toHaveURL(new RegExp("/dashboard/" + guild + "$"));
  await expect(page.locator(".sidebar").getByRole("navigation", { name: "Main navigation", exact: true })).toBeVisible();
  await page.locator(".sidebar").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(base + "/setup?guild=" + guild + "&edit=1");
  await expect(page.getByRole("combobox", { name: "Time zone", exact: true })).toHaveValue(zone);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Time zone", exact: true })).toHaveValue(zone);
  expect((await stored(guild)).settings.revision).toBe(after.settings.revision);
  expect((await stored(otherGuild)).settings).toEqual(otherBefore.settings);
  expect(pageErrors).toEqual([]);
  await test.info().attach("synthetic-core-setup-summary", {
    body: JSON.stringify({ profile: "real-next-api-private-db-fake-discord", oauth: "fixture-session-only", guild, otherGuild, fromRevision: before.settings.revision, toRevision: after.settings.revision, timezone: zone, otherGuildUnchanged: true }),
    contentType: "application/json",
  });
  } finally {
    // Diagnostic failures must never replace the original test outcome.
    try {
      const body = JSON.stringify(diagnostic.stop());
      console.log("ALPHA17_SETUP_STATUS " + body);
      await test.info().attach("alpha17-setup-status-diagnostic", { body, contentType: "application/json" });
    } catch { /* Only safe, best-effort diagnostics; preserve the original assertion. */ }
  }
});