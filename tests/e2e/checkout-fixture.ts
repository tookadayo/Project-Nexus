import { test as base, expect, type BrowserContext } from "@playwright/test";
import { checkoutBrowserUrlAllowed, checkoutContextOptions } from "./checkout-transport.js";

async function localOnly(context: BrowserContext) {
  await context.route("**/*", route => checkoutBrowserUrlAllowed(route.request().url()) ? route.continue() : route.abort("blockedbyclient"));
  return context;
}
// Force the same isolated transport on default and manually opened Owner contexts.
export const test = base.extend({
  browser: async ({ browser }, use) => {
    const isolated = new Proxy(browser, {
      get(target, key) {
        if (key === "newContext") return async (options: Parameters<typeof browser.newContext>[0]) =>
          localOnly(await target.newContext({ ...options, ...checkoutContextOptions }));
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await use(isolated);
  },
  context: async ({ context }, use) => { await localOnly(context); await use(context); },
});
export { expect };
