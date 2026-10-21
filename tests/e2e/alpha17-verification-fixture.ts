import { test as base, expect, type BrowserContext } from "@playwright/test";

async function localOnly(context: BrowserContext) {
  const api = Number(process.env.NEXUS_VERIFICATION_API_PORT ?? 3151);
  const allowed = new Set([process.env.NEXUS_VERIFICATION_WEB_ORIGIN ?? "http://127.0.0.1:3150", "http://127.0.0.1:" + api, "http://127.0.0.1:" + (api + 2)]);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return allowed.has(url.origin)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  return context;
}

/** All browser contexts, including manually opened secondary users, stay in the
 * isolated fixture. The self-signed TLS exception applies only to these tests. */
export const test = base.extend({
  browser: async ({ browser }, use) => {
    const isolated = new Proxy(browser, {
      get(target, key) {
        if (key === "newContext") return async (options: Parameters<typeof browser.newContext>[0]) =>
          localOnly(await target.newContext({ ...options, ignoreHTTPSErrors: true, serviceWorkers: "block", proxy: { server: "http://127.0.0.1:3155" } }));
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await use(isolated);
  },
  context: async ({ context }, use) => { await localOnly(context); await use(context); },
});
export { expect };
export type { BrowserContext } from "@playwright/test";