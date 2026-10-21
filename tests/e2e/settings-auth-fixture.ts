import { test as base, expect } from "@playwright/test";

const origin = "https://app.nexus.test:3150";
const fixture = "http://127.0.0.1:3151";
const guildId = "321111111111111111";
const userId = "911111111111111111";

// Only the four explicit positive-path describes opt in. Development and
// anonymous rejection cases retain the ordinary Playwright fixtures.
export const authenticatedSettingsOptions = {
  authenticatedSettings: true,
  baseURL: origin,
  ignoreHTTPSErrors: true,
  httpCredentials: undefined,
  proxy: { server: "http://127.0.0.1:3155" },
  serviceWorkers: "block" as const,
};

export const test = base.extend<{ authenticatedSettings: boolean }>({
  authenticatedSettings: [false, { option: true }],
  page: async ({ page, context, authenticatedSettings, baseURL }, use) => {
    if (authenticatedSettings) {
      if (baseURL !== origin) throw new Error("SETTINGS_AUTH_ORIGIN_NOT_ALLOWED");
      const allowed = new Set([origin, fixture, "http://127.0.0.1:3153"]);
      await context.route("**/*", route =>
        allowed.has(new URL(route.request().url()).origin)
          ? route.continue()
          : route.abort("blockedbyclient"),
      );
      const issued = await context.request.post(fixture + "/fixture/session", {
        data: { userId },
      });
      expect(issued.status()).toBe(200);
      const body: unknown = await issued.json();
      const reference = body && typeof body === "object" && "reference" in body
        ? body.reference : undefined;
      const validReference = typeof reference === "string" && /^[A-Za-z0-9_-]{43}$/.test(reference);
      expect(validReference).toBe(true);
      if (typeof reference !== "string" || !validReference) throw new Error("SETTINGS_AUTH_SESSION_NOT_ISSUED");
      await context.addCookies([
        { name: "nexus_session", value: reference, url: origin, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "nexus_locale", value: "en", url: origin },
      ]);
      // Next issues the session-bound CSRF field. Confirm selection through its
      // actual form, without global proof headers or a synthetic guild cookie.
      await page.goto("/auth/select?guild=" + guildId);
      await expect(page.locator('input[name="_nexus_csrf"]')).toHaveCount(1);
      const [selected] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/auth/select" && response.request().method() === "POST"),
        page.getByRole("button", { name: /Open$/ }).click(),
      ]);
      expect(selected.status()).toBe(303);
      // The unchanged synthetic settings default to setupVersion2. Selection
      // therefore takes the real setup route; each original test then requests
      // its dashboard through the ordinary authentication/authorization guards.
      const selectedTarget = origin + "/setup?guild=" + guildId;
      expect(selected.headers().location).toBe(selectedTarget);
      await expect(page).toHaveURL(selectedTarget);
    }
    await use(page);
  },
});

export { expect };
